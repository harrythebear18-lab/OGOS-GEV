/**
 * CockpitShell — Dockable panel windowing system.
 *
 * Manages left/right/bottom dock panels with:
 * - Collapsible sections
 * - Resizable widths (drag handle)
 * - Show/hide toggles
 * - Persistent layout state
 *
 * Panels:
 *   Left:   Layers + Plugins (tabbed)
 *   Right:  Inspector / Analysis
 *   Bottom: Status bar (always visible)
 */

import { useState, useCallback, useRef, useEffect, memo, ReactNode } from 'react'

export interface DockConfig {
  leftWidth: number
  rightWidth: number
  leftVisible: boolean
  rightVisible: boolean
  activeLeftTab: 'layers' | 'plugins'
  activeRightTab: 'inspector' | 'ai'
}

interface CockpitShellProps {
  config: DockConfig
  onConfigChange: (cfg: DockConfig) => void
  leftLayers: ReactNode
  leftPlugins: ReactNode
  rightPanel: ReactNode
  aiPanel: ReactNode
  statusBar: ReactNode
  children: ReactNode  // globe canvas
}

const MIN_WIDTH = 200
const MAX_WIDTH = 500

function CockpitShell({
  config,
  onConfigChange,
  leftLayers,
  leftPlugins,
  rightPanel,
  aiPanel,
  statusBar,
  children,
}: CockpitShellProps) {
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  const startDrag = useCallback((side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(side)
  }, [])

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent) => {
      if (!shellRef.current) return
      const rect = shellRef.current.getBoundingClientRect()

      if (dragging === 'left') {
        const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, e.clientX - rect.left))
        onConfigChange({ ...config, leftWidth: w })
      } else if (dragging === 'right') {
        const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, rect.right - e.clientX))
        onConfigChange({ ...config, rightWidth: w })
      }
    }

    const onUp = () => setDragging(null)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, config, onConfigChange])

  return (
    <div ref={shellRef} style={shellStyle.container}>
      {/* Globe canvas (full background) */}
      <div style={shellStyle.globe}>{children}</div>

      {/* Left dock */}
      {config.leftVisible && (
        <>
          <div style={{ ...shellStyle.leftDock, width: config.leftWidth }}>
            {/* Tab bar */}
            <div style={shellStyle.tabBar}>
              <button
                style={shellStyle.tab(config.activeLeftTab === 'layers')}
                onClick={() => onConfigChange({ ...config, activeLeftTab: 'layers' })}
              >
                LAYERS
              </button>
              <button
                style={shellStyle.tab(config.activeLeftTab === 'plugins')}
                onClick={() => onConfigChange({ ...config, activeLeftTab: 'plugins' })}
              >
                PLUGINS
              </button>
              <button
                style={shellStyle.closeBtn}
                onClick={() => onConfigChange({ ...config, leftVisible: false })}
                title="Hide panel"
              >
                ✕
              </button>
            </div>
            {/* Tab content */}
            <div style={shellStyle.tabContent}>
              {config.activeLeftTab === 'layers' ? leftLayers : leftPlugins}
            </div>
          </div>
          {/* Resize handle */}
          <div
            style={{ ...shellStyle.resizeHandle('left'), left: config.leftWidth }}
            onMouseDown={startDrag('left')}
          />
        </>
      )}

      {/* Right dock */}
      {config.rightVisible && (
        <>
          <div style={{ ...shellStyle.rightDock, width: config.rightWidth }}>
            <div style={shellStyle.tabBar}>
              <button
                style={shellStyle.tab(config.activeRightTab === 'inspector')}
                onClick={() => onConfigChange({ ...config, activeRightTab: 'inspector' })}
              >
                INSPECTOR
              </button>
              <button
                style={shellStyle.tab(config.activeRightTab === 'ai')}
                onClick={() => onConfigChange({ ...config, activeRightTab: 'ai' })}
              >
                AI CHAT
              </button>
              <button
                style={shellStyle.closeBtn}
                onClick={() => onConfigChange({ ...config, rightVisible: false })}
                title="Hide panel"
              >
                ✕
              </button>
            </div>
            <div style={shellStyle.tabContent}>
              {config.activeRightTab === 'inspector' ? rightPanel : aiPanel}
            </div>
          </div>
          <div
            style={{ ...shellStyle.resizeHandle('right'), right: config.rightWidth }}
            onMouseDown={startDrag('right')}
          />
        </>
      )}

      {/* Edge toggle buttons (when panels hidden) */}
      {!config.leftVisible && (
        <button
          style={shellStyle.edgeToggle('left')}
          onClick={() => onConfigChange({ ...config, leftVisible: true })}
          title="Show left panel"
        >
          ▶
        </button>
      )}
      {!config.rightVisible && (
        <button
          style={shellStyle.edgeToggle('right')}
          onClick={() => onConfigChange({ ...config, rightVisible: true })}
          title="Show right panel"
        >
          ◀
        </button>
      )}

      {/* Bottom status bar */}
      <div style={shellStyle.statusBar}>{statusBar}</div>
    </div>
  )
}

export default memo(CockpitShell)

// ── Styles ──

const shellStyle = {
  container: {
    position: 'relative' as const,
    width: '100vw',
    height: '100vh',
    overflow: 'hidden' as const,
    background: '#0b0f14',
  },
  globe: {
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, bottom: 28,
    zIndex: 1,
  },
  leftDock: {
    position: 'absolute' as const,
    top: 42,
    left: 0,
    bottom: 28,
    zIndex: 15,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'rgba(11, 15, 20, 0.85)',
    backdropFilter: 'blur(8px)',
    borderRight: '1px solid #1e2a3a',
  },
  rightDock: {
    position: 'absolute' as const,
    top: 42,
    right: 0,
    bottom: 28,
    zIndex: 15,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'rgba(11, 15, 20, 0.85)',
    backdropFilter: 'blur(8px)',
    borderLeft: '1px solid #1e2a3a',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    borderBottom: '1px solid #1e2a3a',
    background: 'rgba(11, 15, 20, 0.95)',
    flexShrink: 0,
  },
  tab: (active: boolean) => ({
    padding: '8px 14px',
    background: active ? 'rgba(74, 158, 255, 0.12)' : 'transparent',
    color: active ? '#4a9eff' : '#6b7d92',
    border: 'none',
    borderBottom: active ? '2px solid #4a9eff' : '2px solid transparent',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
  }),
  tabTitle: {
    flex: 1,
    padding: '8px 14px',
    color: '#4a9eff',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: 'bold' as const,
    fontFamily: 'monospace' as const,
  },
  closeBtn: {
    padding: '4px 10px',
    background: 'transparent',
    color: '#6b7d92',
    border: 'none',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
  },
  tabContent: {
    flex: 1,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    padding: 6,
  },
  resizeHandle: (side: 'left' | 'right') => ({
    position: 'absolute' as const,
    top: 42,
    bottom: 28,
    width: 3,
    zIndex: 16,
    cursor: 'col-resize',
    background: 'rgba(74, 158, 255, 0.08)',
    transition: 'background 0.15s',
  }),
  edgeToggle: (side: 'left' | 'right') => ({
    position: 'absolute' as const,
    top: '50%',
    [side === 'left' ? 'left' : 'right']: 0,
    transform: 'translateY(-50%)',
    zIndex: 14,
    padding: '12px 4px',
    background: 'rgba(11, 15, 20, 0.9)',
    color: '#6b7d92',
    border: `1px solid #1e2a3a`,
    [side === 'left' ? 'borderRight' : 'borderLeft']: 'none',
    borderRadius: side === 'left' ? '0 3px 3px 0' : '3px 0 0 3px',
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
  }),
  statusBar: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
    zIndex: 20,
  },
}
