/**
 * System Verifier Panel — on-demand health check for all workstation subsystems.
 *
 * Triggered by the VERIFY toolbar button. Calls system:verify IPC with the
 * current security stage and displays the structured report.
 *
 * Privacy-aware: network diagnostics (public IP, DNS) only appear at
 * security stage 3. Lower stages show "gated" entries.
 */

import { useState, useEffect } from 'react'

interface CheckResult {
  name: string
  category: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  detail: string
  value?: number
}

interface VerifyReport {
  timestamp: number
  durationMs: number
  securityStage: number
  checks: CheckResult[]
  summary: { ok: number; warn: number; fail: number; skip: number; total: number }
}

interface VerifyProgress {
  completed: number
  total: number
  currentCategory: string
  lastCheck: string | null
}

interface Props {
  securityLevel: number
  onClose: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  live: 'LIVE FEEDS',
  climate: 'CLIMATE / ERDDAP',
  ai: 'AI SERVICES',
  native: 'NATIVE ADDONS',
  system: 'SYSTEM HEALTH',
  privacy: 'PRIVACY / SECURITY',
}

const CATEGORY_ORDER = ['live', 'climate', 'ai', 'native', 'system', 'privacy']

const STATUS_COLORS: Record<string, string> = {
  ok: '#4aff8a',
  warn: '#ffea4a',
  fail: '#ff4a4a',
  skip: '#6b7d92',
}

const STATUS_ICONS: Record<string, string> = {
  ok: '✓',
  warn: '⚠',
  fail: '✗',
  skip: '⊘',
}

export default function SystemVerifierPanel({ securityLevel, onClose }: Props) {
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<VerifyProgress | null>(null)

  // Subscribe to progress events during verification
  useEffect(() => {
    if (!running) return
    const off = (window.api as any).on?.('system:verify:progress', (p: VerifyProgress) => {
      setProgress(p)
    })
    return () => { off?.() }
  }, [running])

  async function runVerify() {
    setRunning(true)
    setError(null)
    setProgress({ completed: 0, total: 22, currentCategory: 'live', lastCheck: null })
    try {
      const result = await window.api.invoke('system:verify', { securityStage: securityLevel }) as VerifyReport
      setReport(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  // Group checks by category
  const grouped: Record<string, CheckResult[]> = {}
  if (report) {
    for (const c of report.checks) {
      if (!grouped[c.category]) grouped[c.category] = []
      grouped[c.category].push(c)
    }
  }

  const s = report?.summary
  const overallStatus = !s ? 'skip' : s.fail > 0 ? 'fail' : s.warn > 0 ? 'warn' : 'ok'
  const overallColor = STATUS_COLORS[overallStatus]
  const overallLabel = !s ? '—' : overallStatus === 'ok' ? 'ALL NOMINAL' : overallStatus === 'warn' ? 'DEGRADED' : 'FAILURES'

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>SYSTEM VERIFY</span>
        <span style={{ ...panelStyle.badge, color: overallColor, borderColor: overallColor }}>
          {overallLabel}
        </span>
        <button style={panelStyle.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div style={panelStyle.summaryRow}>
        {s ? (
          <>
            <span style={{ color: STATUS_COLORS.ok }}>{s.ok} ok</span>
            <span style={{ color: STATUS_COLORS.warn }}>{s.warn} warn</span>
            <span style={{ color: STATUS_COLORS.fail }}>{s.fail} fail</span>
            <span style={{ color: STATUS_COLORS.skip }}>{s.skip} skip</span>
            <span style={{ color: '#6b7d92' }}>{s.total} total</span>
            <span style={{ color: '#6b7d92', marginLeft: 'auto' }}>{report!.durationMs}ms</span>
          </>
        ) : (
          <span style={{ color: '#6b7d92' }}>Click RUN to verify all subsystems</span>
        )}
      </div>

      <button
        style={{ ...panelStyle.runBtn, opacity: running ? 0.5 : 1 }}
        onClick={runVerify}
        disabled={running}
      >
        {running ? 'RUNNING…' : '▶ RUN VERIFICATION'}
      </button>

      {error && (
        <div style={panelStyle.error}>{error}</div>
      )}

      <div style={panelStyle.checksContainer}>
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat]
          if (!items || items.length === 0) return null
          return (
            <div key={cat} style={panelStyle.category}>
              <div style={panelStyle.categoryHeader}>{CATEGORY_LABELS[cat] ?? cat.toUpperCase()}</div>
              {items.map((c, i) => (
                <div key={i} style={panelStyle.checkRow}>
                  <span style={{ color: STATUS_COLORS[c.status], width: 16, textAlign: 'center', flexShrink: 0 }}>
                    {STATUS_ICONS[c.status]}
                  </span>
                  <span style={panelStyle.checkName}>{c.name}</span>
                  <span style={panelStyle.checkDetail}>{c.detail}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const panelStyle = {
  container: {
    background: 'rgba(11, 15, 20, 0.95)',
    backdropFilter: 'blur(8px)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    fontFamily: 'monospace' as const,
    fontSize: 11,
    color: '#c5d3e0',
    maxHeight: '70vh',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderBottom: '1px solid #1e2a3a',
    background: 'rgba(11, 15, 20, 0.95)',
    flexShrink: 0,
  },
  title: {
    color: '#4a9eff',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 'bold' as const,
  },
  badge: {
    fontSize: 9,
    padding: '2px 6px',
    border: '1px solid',
    borderRadius: 2,
    fontWeight: 'bold' as const,
    letterSpacing: 1,
  },
  closeBtn: {
    marginLeft: 'auto',
    background: 'transparent',
    color: '#6b7d92',
    border: 'none',
    fontSize: 12,
    cursor: 'pointer',
  },
  summaryRow: {
    display: 'flex',
    gap: 12,
    padding: '6px 10px',
    borderBottom: '1px solid #1e2a3a',
    fontSize: 10,
    flexShrink: 0,
  },
  runBtn: {
    margin: '8px 10px',
    padding: '6px 12px',
    background: 'rgba(74, 158, 255, 0.12)',
    color: '#4a9eff',
    border: '1px solid #4a9eff',
    borderRadius: 3,
    fontFamily: 'monospace' as const,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    flexShrink: 0,
  },
  error: {
    margin: '0 10px 6px',
    padding: '6px 8px',
    background: 'rgba(255, 74, 74, 0.1)',
    border: '1px solid #ff4a4a',
    borderRadius: 2,
    color: '#ff4a4a',
    fontSize: 10,
  },
  checksContainer: {
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  category: {
    marginBottom: 6,
  },
  categoryHeader: {
    padding: '4px 10px 2px',
    color: '#6b7d92',
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: 'bold' as const,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    padding: '2px 10px',
    fontSize: 10,
    lineHeight: '14px',
  },
  checkName: {
    color: '#c5d3e0',
    minWidth: 140,
    flexShrink: 0,
  },
  checkDetail: {
    color: '#6b7d92',
    flex: 1,
    wordBreak: 'break-word' as const,
  },
}
