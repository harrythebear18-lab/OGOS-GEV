/**
 * StatusBar — Bottom status bar.
 *
 * Shows: active plugin count, system health, FPS, viewport summary.
 * Always visible at the bottom of the cockpit.
 */

import { useState, useEffect, memo } from 'react'
import type { EarthEnginePlugin, PluginStats } from './plugins'

interface StatusBarProps {
  plugins: EarthEnginePlugin[]
  activePlugins: Set<string>
  viewport: unknown
}

interface HealthSummary {
  nominal: number
  loading: number
  error: number
  stale: number
  total: number
}

function StatusBar({ plugins, activePlugins, viewport }: StatusBarProps) {
  const [health, setHealth] = useState<HealthSummary>({ nominal: 0, loading: 0, error: 0, stale: 0, total: 0 })
  const [fps, setFps] = useState(0)

  // Poll plugin health
  useEffect(() => {
    const poll = () => {
      let nominal = 0, loading = 0, error = 0, stale = 0
      for (const id of activePlugins) {
        const plugin = plugins.find((p) => p.id === id)
        if (!plugin) continue
        const stats = plugin.getStats?.()
        if (!stats) continue
        switch (stats.status) {
          case 'nominal': nominal++; break
          case 'loading': loading++; break
          case 'error':   error++; break
          case 'stale':   stale++; break
        }
      }
      setHealth({ nominal, loading, error, stale, total: activePlugins.size })
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [plugins, activePlugins])

  // FPS counter
  useEffect(() => {
    let frames = 0
    let lastTime = performance.now()
    let raf = 0

    const tick = () => {
      frames++
      const now = performance.now()
      if (now - lastTime >= 1000) {
        setFps(Math.round((frames * 1000) / (now - lastTime)))
        frames = 0
        lastTime = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const vp = viewport as {
    center?: { lng: number; lat: number }
    height?: number
  } | null

  const lat = vp?.center?.lat ?? 0
  const lng = vp?.center?.lng ?? 0
  const height = vp?.height ?? 0
  const altStr = height > 1000 ? `${(height / 1000).toFixed(1)}km` : `${height.toFixed(0)}m`

  const healthColor = health.error > 0 ? '#ff4a4a'
    : health.stale > 0 ? '#ff8a4a'
    : health.loading > 0 ? '#ffea4a'
    : health.nominal > 0 ? '#4aff8a'
    : '#6b7d92'

  return (
    <div style={barStyle.container}>
      {/* Left: system status */}
      <div style={barStyle.group}>
        <span style={barStyle.dot(healthColor)} />
        <span style={barStyle.label}>SYSTEM</span>
        <span style={{ ...barStyle.value, color: healthColor }}>
          {health.error > 0 ? `${health.error} ERR` :
           health.stale > 0 ? `${health.stale} STALE` :
           health.loading > 0 ? `${health.loading} LOAD` :
           health.nominal > 0 ? 'NOMINAL' : 'IDLE'}
        </span>
      </div>

      <span style={barStyle.sep} />

      {/* Plugins summary */}
      <div style={barStyle.group}>
        <span style={barStyle.label}>MODULES</span>
        <span style={barStyle.value}>{health.total}/{plugins.length}</span>
      </div>

      <span style={barStyle.sep} />

      {/* Health breakdown */}
      {health.nominal > 0 && (
        <>
          <div style={barStyle.group}>
            <span style={barStyle.miniDot('#4aff8a')} />
            <span style={{ ...barStyle.value, color: '#4aff8a' }}>{health.nominal}</span>
          </div>
        </>
      )}
      {health.loading > 0 && (
        <div style={barStyle.group}>
          <span style={barStyle.miniDot('#ffea4a')} />
          <span style={{ ...barStyle.value, color: '#ffea4a' }}>{health.loading}</span>
        </div>
      )}
      {health.error > 0 && (
        <div style={barStyle.group}>
          <span style={barStyle.miniDot('#ff4a4a')} />
          <span style={{ ...barStyle.value, color: '#ff4a4a' }}>{health.error}</span>
        </div>
      )}

      {/* Center spacer */}
      <div style={{ flex: 1 }} />

      {/* Right: viewport + FPS */}
      <div style={barStyle.group}>
        <span style={barStyle.label}>POS</span>
        <span style={barStyle.value}>
          {Math.abs(lat).toFixed(2)}{lat >= 0 ? 'N' : 'S'} {Math.abs(lng).toFixed(2)}{lng >= 0 ? 'E' : 'W'}
        </span>
      </div>

      <span style={barStyle.sep} />

      <div style={barStyle.group}>
        <span style={barStyle.label}>ALT</span>
        <span style={barStyle.value}>{altStr}</span>
      </div>

      <span style={barStyle.sep} />

      <div style={barStyle.group}>
        <span style={barStyle.label}>FPS</span>
        <span style={{ ...barStyle.value, color: fps >= 50 ? '#4aff8a' : fps >= 30 ? '#ffea4a' : '#ff4a4a' }}>
          {fps}
        </span>
      </div>
    </div>
  )
}

export default memo(StatusBar)

// ── Styles ──

const barStyle = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: '100%',
    padding: '0 12px',
    background: 'rgba(11, 15, 20, 0.95)',
    borderTop: '1px solid #1e2a3a',
    fontFamily: 'monospace' as const,
    fontSize: 10,
    color: '#8b9dad',
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: '#6b7d92',
    fontSize: 8,
    letterSpacing: 1,
  },
  value: {
    color: '#c0c8d0',
    fontSize: 10,
  },
  sep: {
    color: '#3a4a5a',
    fontSize: 10,
  },
  dot: (color: string) => ({
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    boxShadow: `0 0 6px ${color}88`,
  }),
  miniDot: (color: string) => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: color,
  }),
}
