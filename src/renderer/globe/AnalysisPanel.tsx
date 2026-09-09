import { useState, type Dispatch, type SetStateAction } from 'react'
import * as Cesium from 'cesium'
import type { LngLat } from '@shared/types'

interface AnalysisPanelProps {
  viewer: Cesium.Viewer
  viewport: unknown
  onSlopeBands: Dispatch<SetStateAction<{ id: string; coords: LngLat[]; slopeDeg: number; class: string }[]>>
  onAnomalyZones: Dispatch<SetStateAction<{ id: string; coords: LngLat[]; strength: number; type: string }[]>>
  onSearchZones: Dispatch<SetStateAction<{ id: string; radius: number; coords: LngLat[]; probability: number }[]>>
  onRestPoints: Dispatch<SetStateAction<{ id: string; lng: number; lat: number; score: number; reasons: string[] }[]>>
  onWaterFeatures: Dispatch<SetStateAction<{ id: string; type: string; coords: LngLat[]; name?: string }[]>>
  onBehaviorPaths: Dispatch<SetStateAction<LngLat[][]>>
  onFallRiskZones: Dispatch<SetStateAction<{ id: string; coords: LngLat[]; risk: string }[]>>
  onRunoffPaths: Dispatch<SetStateAction<LngLat[][]>>
}

type AnalysisType =
  | 'slope' | 'anomaly' | 'search' | 'rest' | 'water' | 'behavior' | 'fall-risk' | 'runoff'

const ANALYSIS_OPTIONS: { id: AnalysisType; label: string; desc: string }[] = [
  { id: 'slope', label: 'Slope Analysis', desc: 'Horn\'s method slope bands' },
  { id: 'anomaly', label: 'Anomaly Detection', desc: 'Terrain depressions & prominences' },
  { id: 'search', label: 'Search Zones', desc: 'Probability rings around LKP' },
  { id: 'rest', label: 'Rest Points', desc: 'Likely rest areas (slope/water/shelter)' },
  { id: 'water', label: 'Water Features', desc: 'OSM water via Overpass' },
  { id: 'behavior', label: 'Behavior Engine', desc: 'Simulated movement paths' },
  { id: 'fall-risk', label: 'Fall Risk', desc: 'High-slope fall risk zones' },
  { id: 'runoff', label: 'Runoff / Hydrology', desc: 'D8 flow paths & flood zones' },
]

export default function AnalysisPanel(props: AnalysisPanelProps) {
  const [selected, setSelected] = useState<AnalysisType | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const vp = props.viewport as {
    bbox?: { west: number; south: number; east: number; north: number }
    center?: { lng: number; lat: number }
  } | null

  const bbox = vp?.bbox
  const center = vp?.center

  const runAnalysis = async () => {
    if (!selected) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const bounds: [LngLat, LngLat] | null = bbox
        ? [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }]
        : null

      const lkp = center ? { lng: center.lng, lat: center.lat } : null

      switch (selected) {
        case 'slope': {
          if (!bounds) throw new Error('No viewport bounds')
          const res = await window.api.terrain.slopeAnalysis({ bounds, profile: 'hiking' })
          props.onSlopeBands(res.bands)
          setResult(`${res.bands.length} slope bands detected`)
          break
        }
        case 'anomaly': {
          if (!bounds) throw new Error('No viewport bounds')
          const res = await window.api.terrain.anomalyAnalysis({ bounds })
          props.onAnomalyZones(res.zones)
          setResult(`${res.zones.length} anomaly zones found`)
          break
        }
        case 'search': {
          if (!lkp) throw new Error('No camera center for LKP')
          const res = await window.api.terrain.searchZones({ lkp })
          props.onSearchZones(res.zones)
          setResult(`${res.zones.length} search zones generated`)
          break
        }
        case 'rest': {
          if (!lkp) throw new Error('No camera center for LKP')
          const res = await window.api.terrain.restPoints({ lkp, bounds: bounds ?? undefined })
          props.onRestPoints(res.points)
          setResult(`${res.points.length} rest points found`)
          break
        }
        case 'water': {
          if (!bounds) throw new Error('No viewport bounds')
          const res = await window.api.terrain.water(bounds)
          props.onWaterFeatures(res.features)
          setResult(`${res.features.length} water features`)
          break
        }
        case 'behavior': {
          if (!lkp) throw new Error('No camera center for LKP')
          const res = await window.api.terrain.behavior({ lkp, hours: 4, bounds: bounds ?? undefined })
          props.onBehaviorPaths(res.paths)
          setResult(`${res.paths.length} simulated paths`)
          break
        }
        case 'fall-risk': {
          if (!bounds) throw new Error('No viewport bounds')
          const res = await window.api.terrain.fallRisk({ bounds })
          props.onFallRiskZones(res.zones)
          setResult(`${res.zones.length} fall risk zones`)
          break
        }
        case 'runoff': {
          if (!bounds) throw new Error('No viewport bounds')
          const res = await window.api.terrain.runoff({ bounds })
          props.onRunoffPaths(res.flowPaths)
          setResult(`${res.flowPaths.length} flow paths, ${res.pools.length} pools`)
          break
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.title}>TERRAIN ANALYSIS</div>

      <div style={panelStyle.grid}>
        {ANALYSIS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            style={panelStyle.optBtn(selected === opt.id)}
            onClick={() => setSelected(opt.id)}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        style={panelStyle.runBtn(loading)}
        onClick={runAnalysis}
        disabled={!selected || loading}
      >
        {loading ? 'RUNNING...' : 'RUN ANALYSIS'}
      </button>

      {error && <div style={panelStyle.error}>{error}</div>}
      {result && <div style={panelStyle.result}>{result}</div>}

      {!bbox && (
        <div style={panelStyle.warn}>Move camera to set viewport bounds</div>
      )}
    </div>
  )
}

const panelStyle = {
  container: {
    background: 'rgba(11, 15, 20, 0.85)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    padding: 10,
    width: 240,
    color: '#c0c8d0',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  title: {
    fontSize: 10,
    color: '#6b7d92',
    letterSpacing: 1,
    marginBottom: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
    marginBottom: 8,
  },
  optBtn: (active: boolean) => ({
    padding: '5px 4px',
    background: active ? '#1e3a5a' : '#0b0f14',
    color: active ? '#4a9eff' : '#8b9dad',
    border: `1px solid ${active ? '#4a9eff' : '#1e2a3a'}`,
    borderRadius: 2,
    fontSize: 10,
    cursor: 'pointer',
    textAlign: 'left' as const,
  }),
  runBtn: (loading: boolean) => ({
    width: '100%',
    padding: '8px',
    background: loading ? '#1a2a3a' : '#1e4a2a',
    color: loading ? '#6b7d92' : '#4aff8a',
    border: '1px solid #2a5a3a',
    borderRadius: 2,
    fontSize: 11,
    letterSpacing: 1,
    cursor: loading ? 'wait' : 'pointer',
    fontWeight: 'bold' as const,
  }),
  error: {
    color: '#ff4a4a',
    fontSize: 10,
    marginTop: 6,
    padding: 4,
    background: 'rgba(255, 74, 74, 0.1)',
    borderRadius: 2,
  },
  result: {
    color: '#4aff8a',
    fontSize: 10,
    marginTop: 6,
    padding: 4,
    background: 'rgba(74, 255, 138, 0.1)',
    borderRadius: 2,
  },
  warn: {
    color: '#e8c547',
    fontSize: 9,
    marginTop: 6,
    fontStyle: 'italic' as const,
  },
}
