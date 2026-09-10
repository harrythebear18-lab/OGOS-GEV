/**
 * InspectorPanel — Right-side analysis panel.
 *
 * Shows details about the currently selected plugin, scene context,
 * and active analysis. Updates in real-time from plugin stats.
 * Renders per-plugin controls (buttons, sliders, toggles, etc.).
 */

import { useState, useEffect, memo, useCallback } from 'react'
import type { EarthEnginePlugin, PluginStats, PluginControlSpec } from './plugins'
import type { Selection, LngLat } from '@shared/types'
import { selectionToBBox } from '@shared/types'

interface InspectorPanelProps {
  plugins: EarthEnginePlugin[]
  activePlugins: Set<string>
  selection: Selection | null
  lkp: LngLat | null
}

function InspectorPanel({ plugins, activePlugins, selection, lkp }: InspectorPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stats, setStats] = useState<PluginStats | null>(null)
  const [allStats, setAllStats] = useState<Record<string, PluginStats | null>>({})
  const [controls, setControls] = useState<PluginControlSpec[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Auto-select first active plugin
  useEffect(() => {
    if (selectedId && activePlugins.has(selectedId)) return
    const firstActive = plugins.find((p) => activePlugins.has(p.id))
    if (firstActive) setSelectedId(firstActive.id)
    else if (!activePlugins.size) setSelectedId(null)
  }, [plugins, activePlugins, selectedId])

  // Poll stats for all active plugins + selected plugin + controls
  useEffect(() => {
    if (!autoRefresh) return
    const fetchAll = () => {
      const newAllStats: Record<string, PluginStats | null> = {}
      for (const p of plugins) {
        if (activePlugins.has(p.id)) {
          newAllStats[p.id] = p.getStats?.() ?? null
        }
      }
      setAllStats(newAllStats)
      if (selectedId) {
        const plugin = plugins.find((p) => p.id === selectedId)
        setStats(plugin?.getStats?.() ?? null)
        setControls(plugin?.getControls?.() ?? [])
      } else {
        setControls([])
      }
    }
    fetchAll()
    const interval = setInterval(fetchAll, 500)
    return () => clearInterval(interval)
  }, [plugins, activePlugins, selectedId, autoRefresh])

  const handleControl = useCallback((spec: PluginControlSpec, value?: unknown) => {
    if (!selectedId) return
    const plugin = plugins.find((p) => p.id === selectedId)
    if (!plugin?.onControl) return
    if (spec.type === 'button') {
      plugin.onControl(spec.id)
    } else {
      plugin.onControl(spec.id, value)
    }
    // Immediately refresh controls after action
    setControls(plugin.getControls?.() ?? [])
    setStats(plugin.getStats?.() ?? null)
  }, [selectedId, plugins])

  const activePluginList = plugins.filter((p) => activePlugins.has(p.id))
  const selectedPlugin = plugins.find((p) => p.id === selectedId)

  const selBbox = selection ? selectionToBBox(selection) : null

  return (
    <div style={inspStyle.container}>
      {/* Selection / Area of Interest */}
      <div style={inspStyle.section}>
        <div style={inspStyle.sectionHeader}>AREA OF INTEREST</div>
        {selection ? (
          <div style={inspStyle.detailGrid}>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>TYPE</span>
              <span style={{ ...inspStyle.detailValue, color: '#4a9eff' }}>
                {selection.type.toUpperCase()}
              </span>
            </div>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>VERTICES</span>
              <span style={inspStyle.detailValue}>{selection.coords.length}</span>
            </div>
            {selBbox && (
              <>
                <div style={inspStyle.detailRow}>
                  <span style={inspStyle.detailLabel}>WEST</span>
                  <span style={inspStyle.detailValue}>{selBbox.west.toFixed(3)}°</span>
                </div>
                <div style={inspStyle.detailRow}>
                  <span style={inspStyle.detailLabel}>EAST</span>
                  <span style={inspStyle.detailValue}>{selBbox.east.toFixed(3)}°</span>
                </div>
                <div style={inspStyle.detailRow}>
                  <span style={inspStyle.detailLabel}>SOUTH</span>
                  <span style={inspStyle.detailValue}>{selBbox.south.toFixed(3)}°</span>
                </div>
                <div style={inspStyle.detailRow}>
                  <span style={inspStyle.detailLabel}>NORTH</span>
                  <span style={inspStyle.detailValue}>{selBbox.north.toFixed(3)}°</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={inspStyle.empty}>
            No area drawn. Use the toolbar above the globe to draw a bounding box or polygon.
          </div>
        )}
        {lkp && (
          <div style={inspStyle.lkpBox}>
            <span style={inspStyle.lkpLabel}>LKP PIN</span>
            <span style={inspStyle.lkpValue}>
              {lkp.lng.toFixed(4)}°, {lkp.lat.toFixed(4)}°
            </span>
          </div>
        )}
      </div>

      {/* Active plugins selector */}
      <div style={inspStyle.section}>
        <div style={inspStyle.sectionHeader}>ACTIVE MODULES</div>
        {activePluginList.length === 0 ? (
          <div style={inspStyle.empty}>No modules active. Enable plugins from the left panel.</div>
        ) : (
          <div style={inspStyle.pluginList}>
            {activePluginList.map((p) => (
              <button
                key={p.id}
                style={inspStyle.pluginBtn(selectedId === p.id)}
                onClick={() => setSelectedId(p.id)}
              >
                <span style={inspStyle.pluginDot(statusColor(allStats[p.id]?.status))} />
                {p.name}
                {allStats[p.id]?.count !== undefined && allStats[p.id]!.count > 0 && (
                  <span style={inspStyle.pluginCount}>{allStats[p.id]!.count}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected plugin controls */}
      {selectedPlugin && controls.length > 0 && (
        <div style={inspStyle.section}>
          <div style={inspStyle.sectionHeader}>{selectedPlugin.name.toUpperCase()}</div>
          <div style={inspStyle.controlsGrid}>
            {controls.map((spec) => (
              <ControlRenderer key={spec.id} spec={spec} onInteract={handleControl} />
            ))}
          </div>
          {stats?.error && (
            <div style={inspStyle.errorBox}>
              <div style={inspStyle.errorTitle}>⚠ ERROR</div>
              <div style={inspStyle.errorText}>{stats.error}</div>
            </div>
          )}
        </div>
      )}

      {/* Scene context summary */}
      <div style={inspStyle.section}>
        <div style={inspStyle.sectionHeader}>SCENE CONTEXT</div>
        <div style={inspStyle.detailGrid}>
          <div style={inspStyle.detailRow}>
            <span style={inspStyle.detailLabel}>VIEWPORT</span>
            <span style={inspStyle.detailValue}>—</span>
          </div>
          <div style={inspStyle.detailRow}>
            <span style={inspStyle.detailLabel}>TIME RANGE</span>
            <span style={inspStyle.detailValue}>real-time</span>
          </div>
          <div style={inspStyle.detailRow}>
            <span style={inspStyle.detailLabel}>ACTIVE LAYERS</span>
            <span style={inspStyle.detailValue}>{activePlugins.size}</span>
          </div>
        </div>
      </div>

      {/* Auto-refresh toggle */}
      <div style={inspStyle.footer}>
        <label style={inspStyle.autoRefreshLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={inspStyle.checkbox}
          />
          <span style={{ fontSize: 9, color: '#6b7d92' }}>Auto-refresh (1s)</span>
        </label>
      </div>
    </div>
  )
}

/* ── Control renderer ── */

function ControlRenderer({ spec, onInteract }: {
  spec: PluginControlSpec
  onInteract: (spec: PluginControlSpec, value?: unknown) => void
}) {
  switch (spec.type) {
    case 'button':
      return (
        <button
          style={inspStyle.ctrlButton(spec.variant ?? 'default', spec.disabled)}
          onClick={() => onInteract(spec)}
          disabled={spec.disabled}
        >
          {spec.label}
        </button>
      )
    case 'toggle':
      return (
        <label style={inspStyle.ctrlToggleRow}>
          <input
            type="checkbox"
            checked={spec.value}
            onChange={(e) => onInteract(spec, e.target.checked)}
            style={inspStyle.checkbox}
          />
          <span style={inspStyle.ctrlToggleLabel}>{spec.label}</span>
        </label>
      )
    case 'slider':
      return (
        <div style={inspStyle.ctrlSliderRow}>
          <div style={inspStyle.ctrlSliderHeader}>
            <span style={inspStyle.detailLabel}>{spec.label}</span>
            <span style={inspStyle.ctrlSliderValue}>
              {spec.value}{spec.unit ?? ''}
            </span>
          </div>
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={spec.value}
            onChange={(e) => onInteract(spec, parseFloat(e.target.value))}
            style={inspStyle.ctrlSlider}
          />
        </div>
      )
    case 'select':
      return (
        <div style={inspStyle.ctrlSelectRow}>
          <span style={inspStyle.detailLabel}>{spec.label}</span>
          <select
            value={spec.value}
            onChange={(e) => onInteract(spec, e.target.value)}
            style={inspStyle.ctrlSelect}
          >
            {spec.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )
    case 'input':
      return (
        <div style={inspStyle.ctrlInputRow}>
          <span style={inspStyle.detailLabel}>{spec.label}</span>
          <input
            type="text"
            value={spec.value}
            placeholder={spec.placeholder}
            onChange={(e) => onInteract(spec, e.target.value)}
            style={inspStyle.ctrlInput}
          />
        </div>
      )
    case 'display':
      return (
        <div style={inspStyle.detailRow}>
          <span style={inspStyle.detailLabel}>{spec.label}</span>
          <span style={{ ...inspStyle.detailValue, color: spec.color ?? '#c0c8d0' }}>
            {spec.value}
          </span>
        </div>
      )
    case 'separator':
      return spec.label ? (
        <div style={inspStyle.ctrlSeparatorWithLabel}>{spec.label}</div>
      ) : (
        <div style={inspStyle.ctrlSeparator} />
      )
  }
}

function statusColor(status?: string): string {
  switch (status) {
    case 'nominal':  return '#4aff8a'
    case 'loading':  return '#ffea4a'
    case 'error':    return '#ff4a4a'
    case 'stale':    return '#ff8a4a'
    case 'degraded': return '#ff8a4a'
    default:         return '#6b7d92'
  }
}

function statusLabel(status?: string): string {
  switch (status) {
    case 'nominal':  return 'NOMINAL'
    case 'loading':  return 'LOADING'
    case 'error':    return 'ERROR'
    case 'stale':    return 'STALE'
    case 'degraded': return 'DEGRADED'
    case 'disabled': return 'OFFLINE'
    default:         return 'IDLE'
  }
}

export default memo(InspectorPanel)

// ── Styles ──

const inspStyle = {
  container: {
    color: '#c0c8d0',
    fontFamily: 'monospace' as const,
    fontSize: 11,
  },
  section: {
    borderBottom: '1px solid #1e2a3a',
    padding: '8px 10px',
  },
  sectionHeader: {
    color: '#4a9eff',
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    marginBottom: 6,
  },
  empty: {
    fontSize: 9,
    color: '#6b7d92',
    fontStyle: 'italic' as const,
    padding: '4px 0',
  },
  pluginList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  pluginBtn: (selected: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: selected ? 'rgba(74, 158, 255, 0.12)' : 'transparent',
    color: selected ? '#4a9eff' : '#c0c8d0',
    border: 'none',
    borderRadius: 2,
    fontSize: 10,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'monospace' as const,
  }),
  pluginDot: (color: string) => ({
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
    boxShadow: `0 0 4px ${color}66`,
  }),
  pluginCount: {
    marginLeft: 'auto',
    fontSize: 8,
    color: '#4aff8a',
    flexShrink: 0,
  },
  detailGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '2px 0',
  },
  detailLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 10,
    color: '#c0c8d0',
  },
  errorBox: {
    marginTop: 6,
    padding: '6px 8px',
    background: 'rgba(255, 74, 74, 0.08)',
    border: '1px solid rgba(255, 74, 74, 0.2)',
    borderRadius: 3,
  },
  errorTitle: {
    color: '#ff4a4a',
    fontSize: 9,
    fontWeight: 'bold' as const,
    marginBottom: 2,
  },
  errorText: {
    color: '#ff8a8a',
    fontSize: 9,
    lineHeight: 1.4,
  },
  lkpBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    padding: '4px 8px',
    background: 'rgba(255, 74, 74, 0.08)',
    border: '1px solid rgba(255, 74, 74, 0.2)',
    borderRadius: 3,
  },
  lkpLabel: {
    fontSize: 8,
    color: '#ff4a4a',
    letterSpacing: 1,
    fontWeight: 'bold' as const,
  },
  lkpValue: {
    fontSize: 9,
    color: '#ff8a8a',
  },
  footer: {
    padding: '8px 10px',
  },
  autoRefreshLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: '#4a9eff',
  },

  // ── Control styles ──
  controlsGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  ctrlButton: (variant: string, disabled?: boolean) => ({
    padding: '4px 10px',
    background: disabled ? 'rgba(58, 74, 90, 0.3)' :
      variant === 'primary' ? 'rgba(74, 158, 255, 0.15)' :
      variant === 'danger' ? 'rgba(255, 74, 74, 0.15)' :
      'rgba(58, 74, 90, 0.2)',
    color: disabled ? '#3a4a5a' :
      variant === 'primary' ? '#4a9eff' :
      variant === 'danger' ? '#ff4a4a' :
      '#c0c8d0',
    border: `1px solid ${disabled ? '#1e2a3a' :
      variant === 'primary' ? 'rgba(74, 158, 255, 0.4)' :
      variant === 'danger' ? 'rgba(255, 74, 74, 0.4)' :
      '#2a3a4a'}`,
    borderRadius: 3,
    fontSize: 9,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'monospace' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    fontWeight: 'bold' as const,
    transition: 'all 0.15s',
  }),
  ctrlToggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    padding: '2px 0',
  },
  ctrlToggleLabel: {
    fontSize: 9,
    color: '#c0c8d0',
  },
  ctrlSliderRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '2px 0',
  },
  ctrlSliderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ctrlSliderValue: {
    fontSize: 9,
    color: '#4a9eff',
    fontWeight: 'bold' as const,
  },
  ctrlSlider: {
    width: '100%',
    accentColor: '#4a9eff',
    height: 4,
  },
  ctrlSelectRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '2px 0',
  },
  ctrlSelect: {
    background: 'rgba(11, 15, 20, 0.9)',
    color: '#c0c8d0',
    border: '1px solid #2a3a4a',
    borderRadius: 2,
    fontSize: 9,
    fontFamily: 'monospace' as const,
    padding: '2px 4px',
    cursor: 'pointer',
  },
  ctrlInputRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '2px 0',
  },
  ctrlInput: {
    background: 'rgba(11, 15, 20, 0.9)',
    color: '#c0c8d0',
    border: '1px solid #2a3a4a',
    borderRadius: 2,
    fontSize: 9,
    fontFamily: 'monospace' as const,
    padding: '3px 6px',
    outline: 'none',
  },
  ctrlSeparator: {
    height: 1,
    background: '#1e2a3a',
    margin: '4px 0',
  },
  ctrlSeparatorWithLabel: {
    fontSize: 7,
    color: '#3a4a5a',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    margin: '4px 0 2px',
    borderTop: '1px solid #1e2a3a',
    paddingTop: 4,
  },
}
