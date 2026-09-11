/**
 * NetworkGridPanel — operational UI for network and power grid monitoring.
 *
 * Ported from OGOS useNetworkData + useGridData hooks, adapted as a
 * single floating panel for the Sentinel workstation. Exposes:
 *
 * Network:
 *   - Active connections summary
 *   - Health (latency, packet loss)
 *   - VPN status + refresh
 *   - User location (GeoIP)
 *   - Speed test (run + results)
 *   - DNS test (run + results)
 *   - Recent alerts + outages
 *
 * Grid:
 *   - Asset count + integrity
 *   - Cross-domain influence toggle
 *   - Alert snooze
 *   - Whitelist management
 *   - Recent alerts
 */

import { useState, useEffect, useCallback } from 'react'

interface NetStats {
  totalConnections?: number
  activeConnections?: number
  uniqueCountries?: number
  uniqueIPs?: number
  topProcesses?: { name: string; connections: number }[]
  topCountries?: { country: string; count: number }[]
}

interface NetUpdate {
  connections?: { protocol?: string; state?: string }[]
  stats?: NetStats
  userLocation?: UserLocation
  timestamp?: number
}

interface NetHealth {
  status?: string
  connectivityScore?: number
  latency?: number
  packetLoss?: number
  timestamp?: number
}

interface NetVpn {
  isActive?: boolean
  publicIP?: string
  vpnProvider?: string | null
  dnsLeakDetected?: boolean
  killSwitchActive?: boolean
}

interface UserLocation {
  ip?: string
  city?: string
  region?: string
  country?: string
  countryCode?: string
  lat?: number
  lon?: number
  isp?: string
  org?: string
  timezone?: string
}

interface SpeedTestResult {
  downloadMbps?: number
  uploadMbps?: number
  latencyMs?: number
  jitterMs?: number
}

interface DnsTestResult {
  server?: string
  latencyMs?: number
  success?: boolean
}

interface GridUpdate {
  assets?: unknown[]
  measurements?: unknown[]
  interconnects?: unknown[]
  timestamp?: number
}

interface Alert {
  id?: string
  timestamp?: number
  severity?: string
  message?: string
  source?: string
}

export default function NetworkGridPanel() {
  // Network state
  const [netUpdate, setNetUpdate] = useState<NetUpdate | null>(null)
  const [netHealth, setNetHealth] = useState<NetHealth | null>(null)
  const [netVpn, setNetVpn] = useState<NetVpn | null>(null)
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [netAlerts, setNetAlerts] = useState<Alert[]>([])
  const [speedTest, setSpeedTest] = useState<SpeedTestResult | null>(null)
  const [speedTestRunning, setSpeedTestRunning] = useState(false)
  const [dnsTest, setDnsTest] = useState<DnsTestResult | null>(null)
  const [dnsTestRunning, setDnsTestRunning] = useState(false)

  // Grid state
  const [gridUpdate, setGridUpdate] = useState<GridUpdate | null>(null)
  const [gridAlerts, setGridAlerts] = useState<Alert[]>([])
  const [crossDomain, setCrossDomain] = useState<boolean>(false)
  const [gridSnoozed, setGridSnoozed] = useState<boolean>(false)

  // Subscribe to network events
  useEffect(() => {
    const api = window.api as any
    if (!api.network) {
      console.warn('[NetworkGridPanel] window.api.network not available')
      return
    }

    const cleanups: (() => void)[] = []

    const wrap = (setter: (v: any) => void) => {
      return (v: any) => setter(v)
    }

    // Push subscriptions
    api.network.onUpdate(wrap(setNetUpdate))
    api.network.onHealth(wrap(setNetHealth))
    api.network.onVpn(wrap(setNetVpn))
    api.network.onUserLocation(wrap(setUserLocation))
    api.network.onAlert((a: Alert) => {
      setNetAlerts((prev) => [...prev.slice(-19), a])
    })
    api.network.onOutage((o: any) => {
      setNetAlerts((prev) => [...prev.slice(-19), { ...o, severity: 'critical' }])
    })

    return () => {
      cleanups.forEach((fn) => fn && fn())
    }
  }, [])

  // Subscribe to grid events
  useEffect(() => {
    const api = window.api as any
    if (!api.grid) {
      console.warn('[NetworkGridPanel] window.api.grid not available')
      return
    }

    api.grid.onUpdate(wrap(setGridUpdate))
    api.grid.onAlert((a: Alert) => {
      setGridAlerts((prev) => [...prev.slice(-19), a])
    })

    // Load initial cross-domain state
    api.grid.getCrossDomain().then((enabled: boolean) => {
      setCrossDomain(enabled)
    }).catch(() => {})

    api.grid.isSnoozed().then((s: boolean) => {
      setGridSnoozed(s)
    }).catch(() => {})
  }, [])

  const wrap = <T,>(setter: (v: T) => void) => (v: T) => setter(v)

  const runSpeedTest = useCallback(async () => {
    const api = window.api as any
    if (!api.network) return
    setSpeedTestRunning(true)
    setSpeedTest(null)
    try {
      const result = await api.network.speedTest()
      setSpeedTest(result)
    } catch (e) {
      console.warn('[NetworkGridPanel] speed test failed:', e)
    } finally {
      setSpeedTestRunning(false)
    }
  }, [])

  const runDnsTest = useCallback(async () => {
    const api = window.api as any
    if (!api.network) return
    setDnsTestRunning(true)
    setDnsTest(null)
    try {
      const result = await api.network.dnsTest()
      setDnsTest(result)
    } catch (e) {
      console.warn('[NetworkGridPanel] DNS test failed:', e)
    } finally {
      setDnsTestRunning(false)
    }
  }, [])

  const refreshVpn = useCallback(async () => {
    const api = window.api as any
    if (!api.network) return
    try {
      await api.network.refreshVpn()
    } catch (e) {
      console.warn('[NetworkGridPanel] VPN refresh failed:', e)
    }
  }, [])

  const toggleCrossDomain = useCallback(async () => {
    const api = window.api as any
    if (!api.grid) return
    const next = !crossDomain
    setCrossDomain(next)
    try {
      await api.grid.setCrossDomain(next)
    } catch (e) {
      console.warn('[NetworkGridPanel] cross-domain toggle failed:', e)
      setCrossDomain(!next)
    }
  }, [crossDomain])

  const snoozeGrid = useCallback(async (minutes: number) => {
    const api = window.api as any
    if (!api.grid) return
    try {
      await api.grid.snooze(minutes)
      setGridSnoozed(true)
    } catch (e) {
      console.warn('[NetworkGridPanel] grid snooze failed:', e)
    }
  }, [])

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>NETWORK & GRID</span>
      </div>

      {/* ── Network Section ── */}
      <div style={panelStyle.sectionHeader}>NETWORK</div>

      {/* Connection summary */}
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Connections</span>
        <span style={panelStyle.value}>
          {netUpdate?.stats?.activeConnections ?? '—'} active / {netUpdate?.stats?.totalConnections ?? '—'} total
        </span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>TCP / UDP</span>
        <span style={panelStyle.value}>
          {netUpdate?.connections?.filter((c) => c.protocol === 'TCP').length ?? '—'} / {netUpdate?.connections?.filter((c) => c.protocol === 'UDP').length ?? '—'}
        </span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Unique IPs</span>
        <span style={panelStyle.value}>{netUpdate?.stats?.uniqueIPs ?? '—'}</span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Countries</span>
        <span style={panelStyle.value}>{netUpdate?.stats?.uniqueCountries ?? '—'}</span>
      </div>

      {/* Health */}
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Status</span>
        <span style={
          netHealth?.status === 'healthy' ? panelStyle.valueActive
          : netHealth?.status === 'degraded' ? panelStyle.valueWarn
          : netHealth?.status === 'critical' ? panelStyle.valueDanger
          : panelStyle.valueMuted
        }>
          {netHealth?.status?.toUpperCase() ?? '—'}
        </span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Latency</span>
        <span style={panelStyle.value}>
          {netHealth?.latency !== undefined ? `${netHealth.latency.toFixed(0)}ms` : '—'}
        </span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Packet Loss</span>
        <span style={panelStyle.value}>
          {netHealth?.packetLoss !== undefined ? `${(netHealth.packetLoss * 100).toFixed(1)}%` : '—'}
        </span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Score</span>
        <span style={panelStyle.value}>
          {netHealth?.connectivityScore !== undefined ? `${netHealth.connectivityScore.toFixed(0)}/100` : '—'}
        </span>
      </div>

      {/* VPN */}
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>VPN</span>
        <span style={netVpn?.isActive ? panelStyle.valueActive : panelStyle.valueMuted}>
          {netVpn?.isActive ? `ACTIVE (${netVpn.vpnProvider ?? 'unknown'})` : 'INACTIVE'}
        </span>
        <button style={panelStyle.miniBtn} onClick={refreshVpn}>↻</button>
      </div>
      {netVpn?.publicIP && (
        <div style={panelStyle.row}>
          <span style={panelStyle.label}>Public IP</span>
          <span style={panelStyle.valueSmall}>{netVpn.publicIP}</span>
        </div>
      )}
      {netVpn?.dnsLeakDetected && (
        <div style={panelStyle.row}>
          <span style={panelStyle.label}>DNS Leak</span>
          <span style={panelStyle.valueDanger}>DETECTED</span>
        </div>
      )}

      {/* User location */}
      {userLocation && (
        <>
          <div style={panelStyle.row}>
            <span style={panelStyle.label}>Location</span>
            <span style={panelStyle.valueSmall}>
              {userLocation.city ?? '—'}, {userLocation.country ?? '—'}
            </span>
          </div>
          {userLocation.isp && (
            <div style={panelStyle.row}>
              <span style={panelStyle.label}>ISP</span>
              <span style={panelStyle.valueSmall}>{userLocation.isp}</span>
            </div>
          )}
        </>
      )}

      {/* Speed test */}
      <div style={panelStyle.actionRow}>
        <button
          style={panelStyle.actionBtn}
          onClick={runSpeedTest}
          disabled={speedTestRunning}
        >
          {speedTestRunning ? 'RUNNING...' : 'SPEED TEST'}
        </button>
        {speedTest && (
          <div style={panelStyle.resultBox}>
            <span>↓{speedTest.downloadMbps?.toFixed(1) ?? '?'} Mbps</span>
            <span>↑{speedTest.uploadMbps?.toFixed(1) ?? '?'} Mbps</span>
            <span>{speedTest.latencyMs?.toFixed(0) ?? '?'}ms</span>
          </div>
        )}
      </div>

      {/* DNS test */}
      <div style={panelStyle.actionRow}>
        <button
          style={panelStyle.actionBtn}
          onClick={runDnsTest}
          disabled={dnsTestRunning}
        >
          {dnsTestRunning ? 'RUNNING...' : 'DNS TEST'}
        </button>
        {dnsTest && (
          <div style={panelStyle.resultBox}>
            <span>{dnsTest.server ?? '?'}</span>
            <span>{dnsTest.latencyMs?.toFixed(0) ?? '?'}ms</span>
            <span style={{ color: dnsTest.success ? '#4aff8a' : '#ff4a4a' }}>
              {dnsTest.success ? 'OK' : 'FAIL'}
            </span>
          </div>
        )}
      </div>

      {/* Network alerts */}
      {netAlerts.length > 0 && (
        <>
          <div style={panelStyle.sectionHeader}>NET ALERTS ({netAlerts.length})</div>
          <div style={panelStyle.alertList}>
            {netAlerts.slice(-5).map((a, i) => (
              <div key={i} style={panelStyle.alertRow}>
                <span style={panelStyle.alertDot(a.severity)} />
                <span style={panelStyle.alertText}>{a.message ?? 'alert'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Grid Section ── */}
      <div style={panelStyle.sectionHeader}>POWER GRID</div>

      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Assets</span>
        <span style={panelStyle.value}>{gridUpdate?.assets?.length ?? '—'}</span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Measurements</span>
        <span style={panelStyle.value}>{gridUpdate?.measurements?.length ?? '—'}</span>
      </div>
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Interconnects</span>
        <span style={panelStyle.value}>{gridUpdate?.interconnects?.length ?? '—'}</span>
      </div>

      {/* Cross-domain influence */}
      <div style={panelStyle.row}>
        <span style={panelStyle.label}>Cross-Domain</span>
        <button
          style={crossDomain ? panelStyle.toggleOn : panelStyle.toggleOff}
          onClick={toggleCrossDomain}
        >
          {crossDomain ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Snooze */}
      <div style={panelStyle.actionRow}>
        <button
          style={panelStyle.actionBtn}
          onClick={() => snoozeGrid(30)}
          disabled={gridSnoozed}
        >
          {gridSnoozed ? 'SNOOZED' : 'SNOOZE 30M'}
        </button>
      </div>

      {/* Grid alerts */}
      {gridAlerts.length > 0 && (
        <>
          <div style={panelStyle.sectionHeader}>GRID ALERTS ({gridAlerts.length})</div>
          <div style={panelStyle.alertList}>
            {gridAlerts.slice(-5).map((a, i) => (
              <div key={i} style={panelStyle.alertRow}>
                <span style={panelStyle.alertDot(a.severity)} />
                <span style={panelStyle.alertText}>{a.message ?? 'alert'}</span>
              </div>
            ))}
          </div>
        </>
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
    width: 280,
  },
  header: {
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: '1px solid #1e2a3a',
  },
  title: {
    color: '#4a9eff',
    fontSize: 11,
    fontWeight: 'bold' as const,
    letterSpacing: 2,
  },
  sectionHeader: {
    fontSize: 9,
    color: '#4a9eff',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottom: '1px solid rgba(74, 158, 255, 0.15)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 0',
  },
  label: {
    fontSize: 9,
    color: '#6b7d92',
    flex: 1,
  },
  value: {
    fontSize: 10,
    color: '#c0c8d0',
    fontWeight: 'bold' as const,
  },
  valueSmall: {
    fontSize: 9,
    color: '#c0c8d0',
  },
  valueActive: {
    fontSize: 10,
    color: '#4aff8a',
    fontWeight: 'bold' as const,
    flex: 1,
  },
  valueWarn: {
    fontSize: 10,
    color: '#ffea4a',
    fontWeight: 'bold' as const,
    flex: 1,
  },
  valueDanger: {
    fontSize: 10,
    color: '#ff4a4a',
    fontWeight: 'bold' as const,
    flex: 1,
  },
  valueMuted: {
    fontSize: 10,
    color: '#6b7d92',
    flex: 1,
  },
  miniBtn: {
    background: 'rgba(74, 158, 255, 0.1)',
    border: '1px solid rgba(74, 158, 255, 0.3)',
    color: '#4a9eff',
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '4px 0',
  },
  actionBtn: {
    background: 'rgba(74, 158, 255, 0.1)',
    border: '1px solid rgba(74, 158, 255, 0.3)',
    color: '#4a9eff',
    fontSize: 9,
    padding: '4px 8px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
    letterSpacing: 1,
  },
  resultBox: {
    display: 'flex',
    gap: 6,
    fontSize: 9,
    color: '#4aff8a',
    padding: '2px 4px',
    background: 'rgba(74, 255, 138, 0.05)',
    borderRadius: 2,
    flex: 1,
  },
  toggleOn: {
    background: 'rgba(74, 255, 138, 0.15)',
    border: '1px solid rgba(74, 255, 138, 0.4)',
    color: '#4aff8a',
    fontSize: 9,
    padding: '2px 8px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
    fontWeight: 'bold' as const,
  },
  toggleOff: {
    background: 'rgba(107, 125, 146, 0.1)',
    border: '1px solid rgba(107, 125, 146, 0.3)',
    color: '#6b7d92',
    fontSize: 9,
    padding: '2px 8px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace' as const,
  },
  alertList: {
    maxHeight: 100,
    overflowY: 'auto' as const,
  },
  alertRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 0',
  },
  alertDot: (severity?: string) => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background:
      severity === 'critical' ? '#ff4a4a'
      : severity === 'warning' ? '#ffea4a'
      : severity === 'info' ? '#4a9eff'
      : '#6b7d92',
    flexShrink: 0,
  }),
  alertText: {
    fontSize: 8,
    color: '#c0c8d0',
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
}
