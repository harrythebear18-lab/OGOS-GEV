/**
 * InspectorPanel — Right-side analysis panel.
 *
 * Shows details about the currently selected plugin, scene context,
 * and active analysis. Updates in real-time from plugin stats.
 */

import { useState, useEffect, memo } from 'react'
import type { EarthEnginePlugin, PluginStats } from './plugins'

interface InspectorPanelProps {
  plugins: EarthEnginePlugin[]
  activePlugins: Set<string>
}

interface SelectedInfo {
  plugin: EarthEnginePlugin
  stats: PluginStats | null
}

function InspectorPanel({ plugins, activePlugins }: InspectorPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stats, setStats] = useState<PluginStats | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Auto-select first active plugin
  useEffect(() => {
    if (selectedId && activePlugins.has(selectedId)) return
    const firstActive = plugins.find((p) => activePlugins.has(p.id))
    if (firstActive) setSelectedId(firstActive.id)
    else if (!activePlugins.size) setSelectedId(null)
  }, [plugins, activePlugins, selectedId])

  // Poll stats for selected plugin
  useEffect(() => {
    if (!selectedId || !autoRefresh) return
    const plugin = plugins.find((p) => p.id === selectedId)
    if (!plugin) return

    const fetchStats = () => setStats(plugin.getStats?.() ?? null)
    fetchStats()
    const interval = setInterval(fetchStats, 1000)
    return () => clearInterval(interval)
  }, [selectedId, plugins, autoRefresh])

  const activePluginList = plugins.filter((p) => activePlugins.has(p.id))
  const selectedPlugin = plugins.find((p) => p.id === selectedId)

  return (
    <div style={inspStyle.container}>
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
                <span style={inspStyle.pluginDot(statusColor(stats?.status))} />
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected plugin details */}
      {selectedPlugin && (
        <div style={inspStyle.section}>
          <div style={inspStyle.sectionHeader}>MODULE DETAILS</div>
          <div style={inspStyle.detailGrid}>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>NAME</span>
              <span style={inspStyle.detailValue}>{selectedPlugin.name}</span>
            </div>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>ID</span>
              <span style={inspStyle.detailValue}>{selectedPlugin.id}</span>
            </div>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>CATEGORY</span>
              <span style={inspStyle.detailValue}>{selectedPlugin.category.toUpperCase()}</span>
            </div>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>STATUS</span>
              <span style={{ ...inspStyle.detailValue, color: statusColor(stats?.status ?? 'disabled') }}>
                {statusLabel(stats?.status ?? 'disabled')}
              </span>
            </div>
            <div style={inspStyle.detailRow}>
              <span style={inspStyle.detailLabel}>ENTITIES</span>
              <span style={inspStyle.detailValue}>{stats?.count ?? 0}</span>
            </div>
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
}
