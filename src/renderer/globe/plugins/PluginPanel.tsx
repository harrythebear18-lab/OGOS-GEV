/**
 * PluginPanel — Cockpit-style plugin manager.
 *
 * Replaces the flat checkbox list with categorized, expandable cards.
 * Each plugin shows: toggle, status dot, stats, category badge, error text.
 * Plugins are grouped by Tier (category) with colored headers.
 */

import { useState, useEffect, memo } from 'react'
import type { EarthEnginePlugin, PluginStats } from './plugin-manager'

interface PluginPanelProps {
  plugins: EarthEnginePlugin[]
  activePlugins: Set<string>
  onToggle: (id: string) => void
}

interface CategoryMeta {
  key: string
  label: string
  color: string
  icon: string
}

const CATEGORIES: CategoryMeta[] = [
  { key: 'globe',    label: 'TIER 1 — WORLD INTELLIGENCE', color: '#4a9eff', icon: '🌍' },
  { key: 'analysis', label: 'TIER 2 — MOVEMENT & BEHAVIOUR', color: '#4aff8a', icon: '🧭' },
  { key: 'live',     label: 'TIER 3 — LIVE FEEDS',          color: '#ff8a4a', icon: '📡' },
  { key: 'ai',       label: 'TIER 4 — AI & VISION',         color: '#a04aff', icon: '🧠' },
  { key: 'export',   label: 'TIER 5 — MISSION LOGIC',       color: '#ffea4a', icon: '📋' },
  { key: 'vr',       label: 'VR / OPENXR',                  color: '#ff4a8a', icon: '🥽' },
]

function statusColor(status: string): string {
  switch (status) {
    case 'nominal':  return '#4aff8a'
    case 'loading':  return '#ffea4a'
    case 'error':    return '#ff4a4a'
    case 'stale':    return '#ff8a4a'
    case 'degraded': return '#ff8a4a'
    case 'disabled': return '#6b7d92'
    default:         return '#6b7d92'
  }
}

function statusLabel(status: string): string {
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

function PluginCard({ plugin, active, onToggle }: {
  plugin: EarthEnginePlugin
  active: boolean
  onToggle: () => void
}) {
  const [stats, setStats] = useState<PluginStats | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!active) {
      setStats(null)
      return
    }
    const fetchStats = () => setStats(plugin.getStats?.() ?? null)
    fetchStats()
    const interval = setInterval(fetchStats, 2000)
    return () => clearInterval(interval)
  }, [active, plugin])

  const color = statusColor(stats?.status ?? 'disabled')
  const label = statusLabel(stats?.status ?? 'disabled')

  return (
    <div style={cardStyle.container(active)}>
      {/* Header row */}
      <div style={cardStyle.header} onClick={() => setExpanded(!expanded)}>
        {/* Toggle switch */}
        <button
          style={cardStyle.toggle(active)}
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          title={active ? 'Deactivate' : 'Activate'}
        >
          <span style={cardStyle.toggleKnob(active)} />
        </button>

        {/* Status dot */}
        <span style={cardStyle.dot(color, active)} />

        {/* Name */}
        <span style={cardStyle.name(active)}>{plugin.name}</span>

        {/* Status badge */}
        {active && (
          <span style={cardStyle.badge(color)}>{label}</span>
        )}

        {/* Count */}
        {active && stats && stats.count > 0 && (
          <span style={cardStyle.count}>{stats.count}</span>
        )}

        {/* Expand arrow */}
        <span style={cardStyle.arrow}>{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded details */}
      {expanded && active && (
        <div style={cardStyle.body}>
          {stats?.error && (
            <div style={cardStyle.errorRow}>
              <span style={cardStyle.errorIcon}>⚠</span>
              <span style={cardStyle.errorText}>{stats.error}</span>
            </div>
          )}
          <div style={cardStyle.detailRow}>
            <span style={cardStyle.detailLabel}>ID</span>
            <span style={cardStyle.detailValue}>{plugin.id}</span>
          </div>
          <div style={cardStyle.detailRow}>
            <span style={cardStyle.detailLabel}>STATUS</span>
            <span style={{ ...cardStyle.detailValue, color }}>{label}</span>
          </div>
          <div style={cardStyle.detailRow}>
            <span style={cardStyle.detailLabel}>ENTITIES</span>
            <span style={cardStyle.detailValue}>{stats?.count ?? 0}</span>
          </div>
        </div>
      )}

      {/* Collapsed inactive hint */}
      {expanded && !active && (
        <div style={cardStyle.body}>
          <div style={cardStyle.inactiveHint}>Click toggle to activate</div>
        </div>
      )}
    </div>
  )
}

function PluginPanel({ plugins, activePlugins, onToggle }: PluginPanelProps) {
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())

  const toggleCat = (key: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const activeCount = activePlugins.size
  const totalCount = plugins.length

  return (
    <div style={panelStyle.container}>
      {/* Panel header */}
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>PLUGINS</span>
        <span style={panelStyle.counter}>
          {activeCount}/{totalCount} ACTIVE
        </span>
      </div>

      {/* Category sections */}
      {CATEGORIES.map((cat) => {
        const catPlugins = plugins.filter((p) => p.category === cat.key)
        if (catPlugins.length === 0) return null

        const collapsed = collapsedCats.has(cat.key)
        const catActive = catPlugins.filter((p) => activePlugins.has(p.id)).length

        return (
          <div key={cat.key} style={panelStyle.category}>
            <button
              style={panelStyle.catHeader(cat.color, collapsed)}
              onClick={() => toggleCat(cat.key)}
            >
              <span style={panelStyle.catIcon}>{cat.icon}</span>
              <span style={panelStyle.catLabel}>{cat.label}</span>
              <span style={panelStyle.catCount(catActive > 0)}>
                {catActive}/{catPlugins.length}
              </span>
              <span style={panelStyle.catArrow}>{collapsed ? '▶' : '▼'}</span>
            </button>
            {!collapsed && (
              <div style={panelStyle.catBody}>
                {catPlugins.map((p) => (
                  <PluginCard
                    key={p.id}
                    plugin={p}
                    active={activePlugins.has(p.id)}
                    onToggle={() => onToggle(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default memo(PluginPanel)

// ── Styles ──

const panelStyle = {
  container: {
    background: 'rgba(11, 15, 20, 0.92)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    color: '#c0c8d0',
    fontFamily: 'monospace' as const,
    fontSize: 11,
    backdropFilter: 'blur(8px)',
    maxHeight: '100%',
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #1e2a3a',
    background: 'rgba(74, 158, 255, 0.08)',
  },
  title: {
    color: '#4a9eff',
    fontSize: 11,
    fontWeight: 'bold' as const,
    letterSpacing: 2,
  },
  counter: {
    color: '#6b7d92',
    fontSize: 9,
    letterSpacing: 1,
  },
  category: {
    borderBottom: '1px solid #1e2a3a',
  },
  catHeader: (color: string, collapsed: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '6px 10px',
    background: collapsed ? 'transparent' : `rgba(${color.slice(1, 3) === '4a' ? '74, 158, 255' : '0,0,0'}, 0.05)`,
    color: color,
    border: 'none',
    fontSize: 9,
    letterSpacing: 1,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontWeight: 'bold' as const,
    fontFamily: 'monospace' as const,
  }),
  catIcon: { fontSize: 11 },
  catLabel: { flex: 1 },
  catCount: (has: boolean) => ({
    fontSize: 8,
    color: has ? '#4aff8a' : '#6b7d92',
  }),
  catArrow: { fontSize: 8, color: '#6b7d92' },
  catBody: { padding: '4px 6px 6px' },
}

const cardStyle = {
  container: (active: boolean) => ({
    background: active ? 'rgba(74, 158, 255, 0.06)' : 'transparent',
    border: active ? '1px solid rgba(74, 158, 255, 0.2)' : '1px solid transparent',
    borderRadius: 3,
    marginBottom: 2,
    transition: 'background 0.15s',
  }),
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    cursor: 'pointer',
  },
  toggle: (active: boolean) => ({
    position: 'relative' as const,
    width: 28,
    height: 14,
    background: active ? '#4a9eff' : '#1e2a3a',
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'background 0.2s',
  }),
  toggleKnob: (active: boolean) => ({
    position: 'absolute' as const,
    top: 2,
    left: active ? 16 : 2,
    width: 10,
    height: 10,
    background: '#fff',
    borderRadius: '50%',
    transition: 'left 0.2s',
  }),
  dot: (color: string, active: boolean) => ({
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: active ? color : '#3a4a5a',
    flexShrink: 0,
    boxShadow: active ? `0 0 6px ${color}88` : 'none',
  }),
  name: (active: boolean) => ({
    flex: 1,
    fontSize: 10,
    color: active ? '#c0c8d0' : '#6b7d92',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  }),
  badge: (color: string) => ({
    fontSize: 7,
    letterSpacing: 0.5,
    color,
    padding: '1px 4px',
    border: `1px solid ${color}44`,
    borderRadius: 2,
    flexShrink: 0,
  }),
  count: {
    fontSize: 8,
    color: '#4aff8a',
    minWidth: 16,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  arrow: {
    fontSize: 8,
    color: '#6b7d92',
    flexShrink: 0,
  },
  body: {
    padding: '4px 12px 8px',
    borderTop: '1px solid rgba(74, 158, 255, 0.1)',
  },
  errorRow: {
    display: 'flex',
    gap: 4,
    padding: '3px 0',
    marginBottom: 4,
  },
  errorIcon: { color: '#ff4a4a', fontSize: 10 },
  errorText: { color: '#ff8a8a', fontSize: 9, lineHeight: 1.4 },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1px 0',
  },
  detailLabel: {
    fontSize: 8,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 9,
    color: '#c0c8d0',
  },
  inactiveHint: {
    fontSize: 9,
    color: '#6b7d92',
    fontStyle: 'italic' as const,
  },
}
