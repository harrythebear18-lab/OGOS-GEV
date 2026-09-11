/**
 * Elevation Profile Chart — SVG elevation profile along a drawn line.
 *
 * When the user draws a line on the globe, this component fetches the
 * DEM elevation profile via IPC and renders an SVG chart showing
 * elevation vs distance, with ascent/descent/slope stats.
 *
 * Ported from OSINT-Global-OS elevation profile concept, adapted
 * for Cesium 3D globe and the workstation's IPC architecture.
 */

import { useEffect, useState, useCallback } from 'react'
import type { DemProfileResponse, LngLat } from '@shared/types'

interface ElevationProfileProps {
  /** The drawn line selection. When type === 'line', fetch and display. */
  lineCoords: LngLat[] | null
  /** Called when the user closes the profile panel. */
  onClose: () => void
}

const CHART_W = 600
const CHART_H = 160
const PADDING = { top: 16, right: 16, bottom: 28, left: 48 }

export default function ElevationProfile({ lineCoords, onClose }: ElevationProfileProps) {
  const [data, setData] = useState<DemProfileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async (coords: LngLat[]) => {
    setLoading(true)
    setError(null)
    try {
      const result = (await window.api.terrain.demProfile(coords)) as DemProfileResponse
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (lineCoords && lineCoords.length >= 2) {
      fetchProfile(lineCoords)
    } else {
      setData(null)
    }
  }, [lineCoords, fetchProfile])

  if (!lineCoords || lineCoords.length < 2) return null

  const points = data?.points ?? []
  const hasData = points.length > 0 && points.some((p) => p.elevation != null)

  // Compute SVG path
  const elevs = points.map((p) => p.elevation).filter((e): e is number => e != null)
  const minElev = elevs.length > 0 ? Math.min(...elevs) : 0
  const maxElev = elevs.length > 0 ? Math.max(...elevs) : 100
  const elevRange = maxElev - minElev || 100
  const maxDist = points.length > 0 ? points[points.length - 1].distance : 1

  const chartW = CHART_W - PADDING.left - PADDING.right
  const chartH = CHART_H - PADDING.top - PADDING.bottom

  const xScale = (dist: number) => PADDING.left + (dist / maxDist) * chartW
  const yScale = (elev: number) =>
    PADDING.top + chartH - ((elev - minElev) / elevRange) * chartH

  let pathD = ''
  let areaD = ''
  if (hasData) {
    const validPoints = points.filter((p) => p.elevation != null)
    pathD = validPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.distance).toFixed(1)} ${yScale(p.elevation!).toFixed(1)}`)
      .join(' ')
    areaD = pathD + ` L ${xScale(maxDist).toFixed(1)} ${PADDING.top + chartH} L ${xScale(0).toFixed(1)} ${PADDING.top + chartH} Z`
  }

  // Y-axis labels (elevation)
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: PADDING.top + chartH - t * chartH,
    val: minElev + t * elevRange,
  }))

  // X-axis labels (distance)
  const xLabels = [0, 0.5, 1].map((t) => ({
    x: PADDING.left + t * chartW,
    val: t * maxDist,
  }))

  const fmtDist = (m: number) => {
    if (m < 1000) return `${m.toFixed(0)} m`
    return `${(m / 1000).toFixed(2)} km`
  }

  const fmtElev = (m: number) => `${m.toFixed(0)} m`

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>Elevation Profile</span>
        <button style={panelStyle.closeBtn} onClick={onClose} title="Close profile">
          ✕
        </button>
      </div>

      {loading && <div style={panelStyle.loading}>Sampling DEM elevations…</div>}
      {error && <div style={panelStyle.error}>Error: {error}</div>}

      {hasData && !loading && (
        <>
          <svg width={CHART_W} height={CHART_H} style={panelStyle.svg}>
            {/* Area fill */}
            <path d={areaD} fill="url(#elevGradient)" opacity={0.3} />
            {/* Line */}
            <path d={pathD} fill="none" stroke="#4a9eff" strokeWidth={1.5} />
            {/* Gradient definition */}
            <defs>
              <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4a9eff" />
                <stop offset="100%" stopColor="#1a2a3a" />
              </linearGradient>
            </defs>
            {/* Y-axis grid + labels */}
            {yLabels.map((l, i) => (
              <g key={i}>
                <line
                  x1={PADDING.left} y1={l.y} x2={CHART_W - PADDING.right} y2={l.y}
                  stroke="#2a3a4a" strokeWidth={0.5} strokeDasharray="2 2"
                />
                <text x={PADDING.left - 6} y={l.y + 3} fill="#7a8a9a" fontSize={9} textAnchor="end">
                  {fmtElev(l.val)}
                </text>
              </g>
            ))}
            {/* X-axis labels */}
            {xLabels.map((l, i) => (
              <text key={i} x={l.x} y={CHART_H - 8} fill="#7a8a9a" fontSize={9} textAnchor="middle">
                {fmtDist(l.val)}
              </text>
            ))}
            {/* Axis lines */}
            <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={PADDING.top + chartH} stroke="#3a4a5a" strokeWidth={1} />
            <line x1={PADDING.left} y1={PADDING.top + chartH} x2={CHART_W - PADDING.right} y2={PADDING.top + chartH} stroke="#3a4a5a" strokeWidth={1} />
          </svg>

          {/* Stats */}
          <div style={panelStyle.stats}>
            <div style={panelStyle.stat}>
              <span style={panelStyle.statLabel}>Ascent</span>
              <span style={{ ...panelStyle.statVal, color: '#4aff8a' }}>
                {data!.totalAscent > 0 ? '+' : ''}{data!.totalAscent.toFixed(0)} m
              </span>
            </div>
            <div style={panelStyle.stat}>
              <span style={panelStyle.statLabel}>Descent</span>
              <span style={{ ...panelStyle.statVal, color: '#ff8a4a' }}>
                {data!.totalDescent > 0 ? '-' : ''}{data!.totalDescent.toFixed(0)} m
              </span>
            </div>
            <div style={panelStyle.stat}>
              <span style={panelStyle.statLabel}>Max Slope</span>
              <span style={panelStyle.statVal}>{data!.maxSlopeDeg.toFixed(1)}°</span>
            </div>
            <div style={panelStyle.stat}>
              <span style={panelStyle.statLabel}>Distance</span>
              <span style={panelStyle.statVal}>{fmtDist(maxDist)}</span>
            </div>
          </div>
        </>
      )}

      {!hasData && !loading && !error && (
        <div style={panelStyle.loading}>No elevation data available for this path</div>
      )}
    </div>
  )
}

const panelStyle: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 12,
    left: '50%',
    transform: 'translateX(-50%)',
    width: CHART_W + 24,
    background: 'rgba(10, 18, 28, 0.95)',
    border: '1px solid #2a3a4a',
    borderRadius: 8,
    padding: 12,
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    zIndex: 100,
    backdropFilter: 'blur(8px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: '#cfd8e3',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8a9a',
    cursor: 'pointer',
    fontSize: 14,
    padding: '2px 6px',
    borderRadius: 4,
  },
  svg: {
    display: 'block',
    width: '100%',
    maxWidth: CHART_W,
  },
  stats: {
    display: 'flex',
    justifyContent: 'space-around',
    marginTop: 8,
    gap: 8,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 9,
    color: '#7a8a9a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statVal: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cfd8e3',
    fontFamily: 'monospace',
  },
  loading: {
    padding: 20,
    textAlign: 'center' as const,
    color: '#7a8a9a',
    fontSize: 12,
  },
  error: {
    padding: 12,
    textAlign: 'center' as const,
    color: '#ff6a4a',
    fontSize: 12,
  },
}
