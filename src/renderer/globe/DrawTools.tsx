/**
 * DrawTools — Floating toolbar for area/line selection on the Cesium globe.
 *
 * Modes:
 *   ▢ bbox     — Click-drag to draw a bounding box (analysis area)
 *   ⬡ polygon  — Click to add vertices, double-click to close
 *   ∕ line     — Click to add points, double-click to finish (elevation profile)
 *   📌 point   — Click to place LKP / pin
 *   ✕ clear   — Clear the current selection
 *
 * Ported from OGOS DrawTools.tsx, adapted for Cesium.
 */

import { memo } from 'react'
import type { DrawMode } from '@shared/types'

interface DrawToolsProps {
  mode: DrawMode
  onModeChange: (mode: DrawMode) => void
  onClear: () => void
  hasSelection: boolean
}

interface ToolButton {
  mode: DrawMode
  label: string
  title: string
}

const TOOLS: ToolButton[] = [
  { mode: 'bbox',    label: '▢',  title: 'Draw bounding box (analysis area)' },
  { mode: 'polygon', label: '⬡',  title: 'Draw polygon (irregular area)' },
  { mode: 'line',    label: '∕',  title: 'Draw line (elevation profile)' },
  { mode: 'point',   label: '📌', title: 'Place LKP pin (Last Known Point)' },
]

function DrawTools({ mode, onModeChange, onClear, hasSelection }: DrawToolsProps) {
  return (
    <div style={toolsStyle.container}>
      {TOOLS.map((tool) => (
        <button
          key={tool.mode}
          style={toolsStyle.btn(mode === tool.mode)}
          onClick={() => onModeChange(mode === tool.mode ? 'none' : tool.mode)}
          title={tool.title}
        >
          {tool.label}
        </button>
      ))}
      <div style={toolsStyle.divider} />
      <button
        style={toolsStyle.clearBtn(hasSelection)}
        onClick={onClear}
        title="Clear selection"
        disabled={!hasSelection}
      >
        ✕
      </button>
    </div>
  )
}

export default memo(DrawTools)

// ── Styles ──

const toolsStyle = {
  container: {
    position: 'absolute' as const,
    top: 48,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 18,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '4px 6px',
    background: 'rgba(11, 15, 20, 0.92)',
    backdropFilter: 'blur(8px)',
    border: '1px solid #1e2a3a',
    borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  btn: (active: boolean) => ({
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
    color: active ? '#4a9eff' : '#8b9dad',
    border: active ? '1px solid rgba(74, 158, 255, 0.4)' : '1px solid transparent',
    borderRadius: 4,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
    transition: 'all 0.15s',
  }),
  clearBtn: (has: boolean) => ({
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: has ? '#ff4a4a' : '#3a4a5a',
    border: '1px solid transparent',
    borderRadius: 4,
    fontSize: 12,
    cursor: has ? 'pointer' : 'default',
    fontFamily: 'monospace' as const,
    opacity: has ? 1 : 0.4,
  }),
  divider: {
    width: 1,
    height: 22,
    background: '#1e2a3a',
    margin: '0 2px',
  },
}
