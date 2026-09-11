/**
 * IncidentPanel — Fall → Flow → Find pipeline.
 *
 * Ported from OGOS IncidentPanel.tsx, adapted for the Cesium-based
 * Sentinel workstation. Orchestrates the three-step missing-person
 * search workflow:
 *   1. Plan Route — terrain-aware path from LKP to end point
 *   2. Fall Risk Map — zones where a fall is likely along the route
 *   3. Remains Corridor — downhill flow paths from a fall point
 *
 * All analysis is constrained to the drawn bounding area. Points
 * placed outside the area are flagged and analysis is blocked.
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  LngLat,
  Selection,
  TripParams,
  RoutePlanResponse,
  FallRiskResponse,
  RemainsCorridorResponse,
} from '@shared/types'
import { selectionToBBox, isWithinBounds } from '@shared/types'

interface IncidentPanelProps {
  selection: Selection | null
  lkp: LngLat | null
  /** Center of the current viewport (fallback for start/end points). */
  viewportCenter: LngLat | null
  tripParams: TripParams
  /** Called when a fall point is set (via route click). */
  onFallPointSet?: (point: LngLat) => void
  /** Called to fly the camera to a coordinate. */
  onFlyTo?: (lng: number, lat: number) => void
}

type Stage = 'route' | 'fall-risk' | 'corridor'

interface StageState<T> {
  loading: boolean
  result: T | null
  error: string | null
}

function computeBounds(sel: Selection | null): [LngLat, LngLat] | null {
  if (!sel || sel.coords.length < 2) return null
  const bbox = selectionToBBox(sel)
  if (!bbox) return null
  return [
    { lng: bbox.west, lat: bbox.south },
    { lng: bbox.east, lat: bbox.north },
  ]
}

export default function IncidentPanel({
  selection,
  lkp,
  viewportCenter,
  tripParams,
  onFallPointSet,
  onFlyTo,
}: IncidentPanelProps) {
  const [fallPoint, setFallPoint] = useState<LngLat | null>(null)
  const [activeStage, setActiveStage] = useState<Stage | null>(null)

  const [routeState, setRouteState] = useState<StageState<RoutePlanResponse>>({
    loading: false, result: null, error: null,
  })
  const [fallRiskState, setFallRiskState] = useState<StageState<FallRiskResponse>>({
    loading: false, result: null, error: null,
  })
  const [corridorState, setCorridorState] = useState<StageState<RemainsCorridorResponse>>({
    loading: false, result: null, error: null,
  })

  const bounds = computeBounds(selection)
  const hasArea =
    (selection?.type === 'bbox' || selection?.type === 'polygon') &&
    (selection?.coords.length ?? 0) >= 3

  // Tolerance for edge clicks
  const tolerance = 0.01
  const expandedBounds: [LngLat, LngLat] | null = bounds
    ? [
        { lng: bounds[0].lng - tolerance, lat: bounds[0].lat - tolerance },
        { lng: bounds[1].lng + tolerance, lat: bounds[1].lat + tolerance },
      ]
    : null

  const startInBounds = lkp && expandedBounds ? isWithinBounds(lkp, expandedBounds) : false
  const fallInBounds =
    fallPoint && expandedBounds ? isWithinBounds(fallPoint, expandedBounds) : false

  const getStart = useCallback((): LngLat => {
    if (lkp) return lkp
    if (viewportCenter) return viewportCenter
    return { lng: 0, lat: 0 }
  }, [lkp, viewportCenter])

  const getEnd = useCallback((): LngLat => {
    // For now, end = viewport center if no explicit end set
    if (viewportCenter) return viewportCenter
    return getStart()
  }, [viewportCenter, getStart])

  const runRoute = useCallback(async () => {
    if (!bounds) return
    setActiveStage('route')
    setRouteState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = (await window.api.terrain.routePlan({
        start: getStart(),
        end: getEnd(),
        bounds,
      } as any)) as RoutePlanResponse
      setRouteState({ loading: false, result: res, error: null })
    } catch (e: any) {
      setRouteState({ loading: false, result: null, error: e?.message ?? String(e) })
    }
  }, [bounds, getStart, getEnd])

  const runFallRisk = useCallback(async () => {
    if (!bounds) return
    setActiveStage('fall-risk')
    setFallRiskState((s) => ({ ...s, loading: true, error: null }))
    try {
      const route = routeState.result
      const res = (await window.api.terrain.fallRisk({
        route: route?.primary,
        bounds,
      } as any)) as FallRiskResponse
      setFallRiskState({ loading: false, result: res, error: null })
    } catch (e: any) {
      setFallRiskState({ loading: false, result: null, error: e?.message ?? String(e) })
    }
  }, [bounds, routeState.result])

  const runCorridor = useCallback(async () => {
    if (!bounds) return
    setActiveStage('corridor')
    setCorridorState((s) => ({ ...s, loading: true, error: null }))
    try {
      const fp = fallPoint ?? getStart()
      const res = (await window.api.terrain.remainsCorridor({
        fallPoint: fp,
        bounds,
        rainfallMm: 0,
      } as any)) as RemainsCorridorResponse
      setCorridorState({ loading: false, result: res, error: null })
    } catch (e: any) {
      setCorridorState({ loading: false, result: null, error: e?.message ?? String(e) })
    }
  }, [bounds, fallPoint, getStart])

  const clearRoute = () => {
    setRouteState({ loading: false, result: null, error: null })
    if (activeStage === 'route') setActiveStage(null)
  }
  const clearFallRisk = () => {
    setFallRiskState({ loading: false, result: null, error: null })
    if (activeStage === 'fall-risk') setActiveStage(null)
  }
  const clearCorridor = () => {
    setCorridorState({ loading: false, result: null, error: null })
    if (activeStage === 'corridor') setActiveStage(null)
  }

  const clearAll = () => {
    clearRoute()
    clearFallRisk()
    clearCorridor()
    setFallPoint(null)
    setActiveStage(null)
  }

  // Clear all when selection is cleared
  useEffect(() => {
    if (!selection) clearAll()
  }, [selection])

  const canRunRoute = hasArea && (!!startInBounds || !lkp)
  const canRunCorridor = hasArea && (!!fallInBounds || !fallPoint) && (!!startInBounds || !lkp || !!fallPoint)

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>INCIDENT ANALYSIS</span>
        <button style={panelStyle.clearBtn} onClick={clearAll} title="Clear all analysis">
          ✕ CLEAR
        </button>
      </div>
      <div style={panelStyle.tagline}>Fall → Flow → Find pipeline</div>

      {/* Analysis area status */}
      <div style={hasArea ? panelStyle.areaActive : panelStyle.areaWarning}>
        {hasArea
          ? `Analysis area set (${selection?.type})`
          : 'Draw a bounding box or polygon first'}
      </div>

      {/* Points status */}
      <div style={panelStyle.points}>
        <div style={panelStyle.pointRow}>
          <span style={panelStyle.pointLabel}>Start (LKP):</span>
          <span
            style={
              lkp
                ? startInBounds
                  ? panelStyle.pointActive
                  : panelStyle.pointWarn
                : panelStyle.pointMuted
            }
          >
            {lkp
              ? startInBounds
                ? `${lkp.lng.toFixed(4)}, ${lkp.lat.toFixed(4)}`
                : 'outside area!'
              : 'right-click to set'}
          </span>
        </div>
        <div style={panelStyle.pointRow}>
          <span style={panelStyle.pointLabel}>Fall point:</span>
          <span
            style={
              fallPoint
                ? fallInBounds
                  ? panelStyle.pointDanger
                  : panelStyle.pointWarn
                : panelStyle.pointMuted
            }
          >
            {fallPoint
              ? fallInBounds
                ? `${fallPoint.lng.toFixed(4)}, ${fallPoint.lat.toFixed(4)}`
                : 'outside area!'
              : 'auto from LKP'}
          </span>
        </div>
      </div>

      {/* Stage 1: Route Planning */}
      <div style={panelStyle.stage}>
        <div style={panelStyle.stageHeader}>
          <span style={canRunRoute ? panelStyle.stageLabel : panelStyle.stageLabelMuted}>
            1. Plan Route
          </span>
          <button
            style={panelStyle.runBtn}
            onClick={runRoute}
            disabled={!canRunRoute || routeState.loading}
          >
            {routeState.loading ? '...' : 'RUN'}
          </button>
          {routeState.result && (
            <button style={panelStyle.clearLayerBtn} onClick={clearRoute}>✕</button>
          )}
        </div>
        <div style={panelStyle.stageHint}>Terrain-aware path within analysis area</div>
        {lkp && !startInBounds && (
          <div style={panelStyle.stageWarn}>Start point is outside the drawn area</div>
        )}
        {routeState.error && (
          <div style={panelStyle.stageError}>{routeState.error}</div>
        )}
        {routeState.result && (
          <div style={panelStyle.stageStats}>
            <span>{(routeState.result.distanceM / 1000).toFixed(1)} km</span>
            <span>↑{routeState.result.ascentM.toFixed(0)}m</span>
            <span>↓{routeState.result.descentM.toFixed(0)}m</span>
            <span>{routeState.result.alternatives.length} alt</span>
          </div>
        )}
      </div>

      {/* Stage 2: Fall Risk Map */}
      <div style={panelStyle.stage}>
        <div style={panelStyle.stageHeader}>
          <span style={hasArea ? panelStyle.stageLabel : panelStyle.stageLabelMuted}>
            2. Fall Risk Map
          </span>
          <button
            style={panelStyle.runBtn}
            onClick={runFallRisk}
            disabled={!hasArea || fallRiskState.loading}
          >
            {fallRiskState.loading ? '...' : 'RUN'}
          </button>
          {fallRiskState.result && (
            <button style={panelStyle.clearLayerBtn} onClick={clearFallRisk}>✕</button>
          )}
        </div>
        <div style={panelStyle.stageHint}>Analyzes terrain within drawn area only</div>
        {fallRiskState.error && (
          <div style={panelStyle.stageError}>{fallRiskState.error}</div>
        )}
        {fallRiskState.result && (
          <div style={panelStyle.stageStats}>
            <span>{fallRiskState.result.zones.length} risk zones</span>
          </div>
        )}
      </div>

      {/* Stage 3: Remains Corridor */}
      <div style={panelStyle.stage}>
        <div style={panelStyle.stageHeader}>
          <span style={canRunCorridor ? panelStyle.stageLabel : panelStyle.stageLabelMuted}>
            3. Remains Corridor
          </span>
          <button
            style={panelStyle.runBtn}
            onClick={runCorridor}
            disabled={!canRunCorridor || corridorState.loading}
          >
            {corridorState.loading ? '...' : 'RUN'}
          </button>
          {corridorState.result && (
            <button style={panelStyle.clearLayerBtn} onClick={clearCorridor}>✕</button>
          )}
        </div>
        <div style={panelStyle.stageHint}>
          {fallPoint
            ? `Traces downhill from fall point`
            : `Traces downhill from ${lkp ? 'LKP' : 'map center'}`}
        </div>
        {fallPoint && !fallInBounds && (
          <div style={panelStyle.stageWarn}>Fall point is outside the drawn area</div>
        )}
        {corridorState.error && (
          <div style={panelStyle.stageError}>{corridorState.error}</div>
        )}
        {corridorState.result && (
          <div style={panelStyle.stageStats}>
            <span>{corridorState.result.paths.length} paths</span>
            <span>{corridorState.result.depositionZones.length} deposition</span>
            <span>{corridorState.result.chokePoints.length} choke</span>
          </div>
        )}
      </div>

      {/* Fly-to buttons for results */}
      {(routeState.result || corridorState.result) && (
        <div style={panelStyle.flySection}>
          <div style={panelStyle.sectionHeader}>FLY TO</div>
          {routeState.result?.primary?.[0] && (
            <button
              style={panelStyle.flyBtn}
              onClick={() => {
                const p = routeState.result!.primary[0]
                onFlyTo?.(p.lng, p.lat)
              }}
            >
              → Route Start
            </button>
          )}
          {corridorState.result?.paths?.[0]?.coords?.[0] && (
            <button
              style={panelStyle.flyBtn}
              onClick={() => {
                const p = corridorState.result!.paths[0].coords[0]
                onFlyTo?.(p.lng, p.lat)
              }}
            >
              → Corridor Start
            </button>
          )}
          {corridorState.result?.depositionZones?.[0]?.coords?.[0] && (
            <button
              style={panelStyle.flyBtn}
              onClick={() => {
                const p = corridorState.result!.depositionZones[0].coords[0]
                onFlyTo?.(p.lng, p.lat)
              }}
            >
              → Deposition Zone
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const panelStyle = {
  container: {
    background: 'rgba(11, 15, 20, 0.92)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    color: '#c0c8d0',
    fontFamily: 'monospace' as const,
    fontSize: 11,
    padding: 8,
    backdropFilter: 'blur(8px)',
    maxHeight: '70vh',
    overflowY: 'auto' as const,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#4a9eff',
    fontSize: 11,
    fontWeight: 'bold' as const,
    letterSpacing: 2,
  },
  clearBtn: {
    background: 'rgba(255, 74, 74, 0.1)',
    border: '1px solid rgba(255, 74, 74, 0.3)',
    color: '#ff8a8a',
    fontSize: 8,
    padding: '2px 6px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
  },
  tagline: {
    fontSize: 9,
    color: '#6b7d92',
    marginBottom: 8,
    fontStyle: 'italic' as const,
  },
  areaActive: {
    fontSize: 9,
    color: '#4aff8a',
    padding: '4px 6px',
    background: 'rgba(74, 255, 138, 0.08)',
    borderRadius: 2,
    marginBottom: 6,
  },
  areaWarning: {
    fontSize: 9,
    color: '#ffea4a',
    padding: '4px 6px',
    background: 'rgba(255, 234, 74, 0.08)',
    borderRadius: 2,
    marginBottom: 6,
  },
  points: {
    marginBottom: 8,
    padding: '4px 6px',
    background: 'rgba(30, 42, 58, 0.4)',
    borderRadius: 2,
  },
  pointRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
  },
  pointLabel: {
    fontSize: 9,
    color: '#6b7d92',
  },
  pointActive: {
    fontSize: 9,
    color: '#4aff8a',
  },
  pointWarn: {
    fontSize: 9,
    color: '#ffea4a',
  },
  pointDanger: {
    fontSize: 9,
    color: '#ff4a4a',
  },
  pointMuted: {
    fontSize: 9,
    color: '#6b7d92',
    fontStyle: 'italic' as const,
  },
  stage: {
    marginBottom: 6,
    padding: '6px 8px',
    background: 'rgba(30, 42, 58, 0.3)',
    borderRadius: 3,
    border: '1px solid rgba(74, 158, 255, 0.1)',
  },
  stageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  stageLabel: {
    flex: 1,
    fontSize: 10,
    color: '#c0c8d0',
    fontWeight: 'bold' as const,
  },
  stageLabelMuted: {
    flex: 1,
    fontSize: 10,
    color: '#6b7d92',
    fontWeight: 'bold' as const,
  },
  runBtn: {
    background: 'rgba(74, 158, 255, 0.15)',
    border: '1px solid rgba(74, 158, 255, 0.4)',
    color: '#4a9eff',
    fontSize: 8,
    padding: '2px 8px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
    letterSpacing: 1,
  },
  clearLayerBtn: {
    background: 'none',
    border: '1px solid rgba(255, 74, 74, 0.3)',
    color: '#ff8a8a',
    fontSize: 8,
    width: 16,
    height: 16,
    borderRadius: 2,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'monospace' as const,
  },
  stageHint: {
    fontSize: 8,
    color: '#6b7d92',
    marginBottom: 3,
  },
  stageWarn: {
    fontSize: 8,
    color: '#ffea4a',
    marginBottom: 3,
  },
  stageError: {
    fontSize: 8,
    color: '#ff4a4a',
    marginBottom: 3,
  },
  stageStats: {
    display: 'flex',
    gap: 8,
    fontSize: 9,
    color: '#4aff8a',
    padding: '2px 0',
  },
  flySection: {
    marginTop: 8,
    paddingTop: 6,
    borderTop: '1px solid #1e2a3a',
  },
  sectionHeader: {
    fontSize: 9,
    color: '#4a9eff',
    letterSpacing: 1,
    marginBottom: 4,
  },
  flyBtn: {
    display: 'block',
    width: '100%',
    padding: '4px 8px',
    margin: '2px 0',
    fontSize: 9,
    fontFamily: 'monospace' as const,
    background: 'rgba(74, 158, 255, 0.08)',
    border: '1px solid rgba(74, 158, 255, 0.2)',
    color: '#4a9eff',
    borderRadius: 2,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
}
