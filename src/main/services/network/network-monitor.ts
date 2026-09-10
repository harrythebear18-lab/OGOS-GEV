/* NetworkMonitor — ported from OGOS, adapted to OSINT Sentinel IPC contracts.
 *
 * Polls every 3 seconds using PowerShell (Get-NetTCPConnection / Get-NetUDPEndpoint).
 * Deduplicates connections, detects new external + inbound connections (with cooldowns),
 * does GeoIP batch lookups for new public IPs, and broadcasts via IPC channels:
 *   NET_UPDATE  → NetworkUpdate
 *   NET_TRAFFIC → TrafficDataPoint
 *   NET_ALERT   → ConnectionAlert
 *   NET_HEALTH  → NetworkHealth
 *   NET_OUTAGE  → OutageEvent
 *
 * Callback-based (like OGOS) — callbacks default to broadcasting via broadcastToWindows. */
import { exec } from 'child_process'
import * as https from 'https'
import { IPC } from '@shared/ipc'
import type { NetworkConnection, NetworkStats, NetworkUpdate, NetworkHealth, GeoLocation } from '@shared/types'
import { broadcastToWindows } from '../../windows'
import { GeoIPService } from './geoip'
import { FaultDetector } from './fault-detector'
import { BandwidthMonitor } from './bandwidth-monitor'
import { QualityMonitor } from './quality-monitor'
import type { ConnectionAlert, TrafficDataPoint, OutageEvent } from './types'

// --- Windows PowerShell scripts ---
const PS_SCRIPT = `
$conns = @()
$tcpConns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -ne '0.0.0.0' -and $_.RemoteAddress -ne '::' -and $_.RemoteAddress -ne '::1' }
foreach ($conn in $tcpConns) {
    $proc = $null
    try { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue } catch {}
    $conns += [PSCustomObject]@{
        Protocol = 'TCP'
        LocalAddress = $conn.LocalAddress
        LocalPort = $conn.LocalPort
        RemoteAddress = $conn.RemoteAddress
        RemotePort = $conn.RemotePort
        State = $conn.State
        ProcessId = $conn.OwningProcess
        ProcessName = if ($proc) { $proc.ProcessName } else { 'Unknown' }
    }
}
$udpConns = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -ne '0.0.0.0' -and $_.RemoteAddress -ne '::' }
foreach ($conn in $udpConns) {
    $proc = $null
    try { $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue } catch {}
    $conns += [PSCustomObject]@{
        Protocol = 'UDP'
        LocalAddress = $conn.LocalAddress
        LocalPort = $conn.LocalPort
        RemoteAddress = $conn.RemoteAddress
        RemotePort = 0
        State = 'UDP'
        ProcessId = $conn.OwningProcess
        ProcessName = if ($proc) { $proc.ProcessName } else { 'Unknown' }
    }
}
if ($conns.Count -eq 0) { Write-Output '[]' } else { $conns | ConvertTo-Json -Compress -Depth 2 }
`

const PS_LISTEN_SCRIPT = `
$ports = @()
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
foreach ($l in $listeners) {
    $ports += [PSCustomObject]@{ Port = $l.LocalPort; Protocol = 'TCP' }
}
$udpListeners = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -ne '::1' -and $_.LocalAddress -ne '127.0.0.1' }
foreach ($u in $udpListeners) {
    $ports += [PSCustomObject]@{ Port = $u.LocalPort; Protocol = 'UDP' }
}
if ($ports.Count -eq 0) { Write-Output '[]' } else { $ports | ConvertTo-Json -Compress -Depth 2 }
`

export interface NetworkMonitorCallbacks {
  onUpdate?: (connections: NetworkConnection[]) => void
  onTrafficUpdate?: (data: TrafficDataPoint) => void
  onAlert?: (alert: ConnectionAlert) => void
  onHealthUpdate?: (health: NetworkHealth) => void
  onOutage?: (outage: OutageEvent) => void
}

export class NetworkMonitor {
  private geoIP: GeoIPService
  private faultDetector: FaultDetector
  private bandwidthMonitor: BandwidthMonitor
  private qualityMonitor: QualityMonitor
  private connections = new Map<string, NetworkConnection>()
  private interval: NodeJS.Timeout | null = null
  private isRunning = false
  private trafficHistory: TrafficDataPoint[] = []
  private readonly maxHistoryPoints = 60
  private knownConnectionIds = new Set<string>()
  private alertCooldowns = new Map<string, number>()
  private inboundAlertCooldowns = new Map<string, number>()
  private whitelistedProcesses = new Set<string>([
    'Toolkit', 'OneDrive', 'OneDriveStandaloneUpdater', 'OneDrive.Sync.Service',
    'electron', 'Devin', 'msedge', 'msedgewebview2', 'Idle', 'svchost',
    'language_server_windows_x64', 'opera', 'nordvpn-service', 'pwsh',
    'remoting_host', 'MpDefenderCoreService', 'SpotifyLauncher',
    'gamingservices', 'NordUpdateService',
  ])
  private snoozedUntil = 0
  private listeningPorts = new Set<string>()
  private userLocation: GeoLocation | null = null
  private cb: NetworkMonitorCallbacks

  constructor(geoIP: GeoIPService, callbacks: NetworkMonitorCallbacks = {}) {
    this.geoIP = geoIP
    this.cb = callbacks

    // Default callbacks broadcast via IPC
    this.faultDetector = new FaultDetector(
      (health) => {
        broadcastToWindows(IPC.NET_HEALTH, health)
        this.cb.onHealthUpdate?.(health)
      },
      (outage) => {
        broadcastToWindows(IPC.NET_OUTAGE, outage)
        this.cb.onOutage?.(outage)
      },
    )
    this.bandwidthMonitor = new BandwidthMonitor()
    this.qualityMonitor = new QualityMonitor()
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[network/network-monitor] start()')
    this.poll()
    this.interval = setInterval(() => this.poll(), 3000)
    this.faultDetector.start()
  }

  stop(): void {
    this.isRunning = false
    if (this.interval) { clearInterval(this.interval); this.interval = null }
    this.faultDetector.stop()
    console.log('[network/network-monitor] stop()')
  }

  private async poll(): Promise<void> {
    try {
      const rawConnections = await this.getConnectionsInternal()
      const now = Date.now()

      // Refresh listening ports periodically
      if (this.listeningPorts.size === 0 || now % 10000 < 3000) {
        await this.refreshListeningPorts()
      }

      // Update or add connections
      const newIPs = new Set<string>()
      const newConnections: NetworkConnection[] = []
      for (const conn of rawConnections) {
        const id = `${conn.protocol}-${conn.localAddress}:${conn.localPort}-${conn.remoteAddress}:${conn.remotePort}`
        const existing = this.connections.get(id)

        if (existing) {
          existing.lastSeen = now
          existing.state = conn.state
          existing.processName = conn.processName
          this.bandwidthMonitor.updateProcessBandwidth(conn.processName, conn.processId, 0, 0)
        } else {
          const newConn: NetworkConnection = { ...conn, id, firstSeen: now, lastSeen: now }
          this.connections.set(id, newConn)
          if (!isPrivateIP(conn.remoteAddress)) newIPs.add(conn.remoteAddress)
          newConnections.push(newConn)
          this.bandwidthMonitor.updateProcessBandwidth(conn.processName, conn.processId, 0, 0)
        }
      }

      // Generate alerts for new connections (after first scan completes)
      if (this.knownConnectionIds.size > 0 && now > this.snoozedUntil) {
        for (const conn of newConnections) {
          if (isPrivateIP(conn.remoteAddress)) continue
          if (this.whitelistedProcesses.has(conn.processName)) continue

          // Check if this is an inbound connection
          const listenKey = `${conn.localPort}-${conn.protocol}`
          const isInbound = this.listeningPorts.has(listenKey) && conn.state === 'Established'

          if (isInbound) {
            const inboundKey = `inbound-${conn.remoteAddress}-${conn.localPort}`
            const lastInboundAlert = this.inboundAlertCooldowns.get(inboundKey) || 0
            if (now - lastInboundAlert > 60000) {
              this.inboundAlertCooldowns.set(inboundKey, now)
              const alert: ConnectionAlert = {
                id: `${now}-inbound-${inboundKey}`, timestamp: now, type: 'suspicious',
                processName: conn.processName, remoteAddress: conn.remoteAddress,
                remotePort: conn.remotePort, protocol: conn.protocol, geo: conn.geo,
                message: `INBOUND: ${conn.remoteAddress} connected to your port ${conn.localPort} (${conn.processName})`,
              }
              broadcastToWindows(IPC.NET_ALERT, alert)
              this.cb.onAlert?.(alert)
              continue
            }
          }

          const alertKey = `${conn.processName}-${conn.remoteAddress}`
          const lastAlert = this.alertCooldowns.get(alertKey) || 0
          if (now - lastAlert > 30000) {
            this.alertCooldowns.set(alertKey, now)
            const alert: ConnectionAlert = {
              id: `${now}-${alertKey}`, timestamp: now, type: 'new_connection',
              processName: conn.processName, remoteAddress: conn.remoteAddress,
              remotePort: conn.remotePort, protocol: conn.protocol, geo: conn.geo,
              message: `${conn.processName} connected to ${conn.remoteAddress}:${conn.remotePort}`,
            }
            broadcastToWindows(IPC.NET_ALERT, alert)
            this.cb.onAlert?.(alert)
          }
        }
      }

      // Mark all current connections as known
      for (const id of this.connections.keys()) this.knownConnectionIds.add(id)

      // Remove stale connections (not seen in last 15 seconds)
      const staleThreshold = now - 15000
      for (const [id, conn] of this.connections.entries()) {
        if (conn.lastSeen < staleThreshold) this.connections.delete(id)
      }

      // Lookup GeoIP for new IPs in batch
      if (newIPs.size > 0) {
        const geoResults = await this.geoIP.lookupBatch(Array.from(newIPs))
        for (const [ip, geo] of geoResults.entries()) {
          if (geo) {
            for (const conn of this.connections.values()) {
              if (conn.remoteAddress === ip && !conn.geo) conn.geo = geo
            }
          }
        }
      }

      // Detect user location from first connection geo (or lookup public IP)
      if (!this.userLocation) {
        this.userLocation = await this.detectUserLocation()
      }

      // Record traffic data point
      const established = Array.from(this.connections.values()).filter((c) => c.state === 'Established').length
      const dataPoint: TrafficDataPoint = {
        timestamp: now,
        totalConnections: this.connections.size,
        activeConnections: established,
        newConnections: newConnections.length,
      }
      this.trafficHistory.push(dataPoint)
      if (this.trafficHistory.length > this.maxHistoryPoints) this.trafficHistory.shift()
      broadcastToWindows(IPC.NET_TRAFFIC, dataPoint)
      this.cb.onTrafficUpdate?.(dataPoint)

      // Build and broadcast NetworkUpdate
      const allConnections = Array.from(this.connections.values())
      const stats = this.getStats(allConnections)
      const update: NetworkUpdate = {
        connections: allConnections,
        stats,
        userLocation: this.userLocation,
        timestamp: now,
      }
      broadcastToWindows(IPC.NET_UPDATE, update)
      this.cb.onUpdate?.(allConnections)
    } catch (e) {
      console.error('[network/network-monitor] poll error:', e)
    }
  }

  private async detectUserLocation(): Promise<GeoLocation | null> {
    // Try to find user location from a connection geo first
    for (const conn of this.connections.values()) {
      if (conn.geo && !isPrivateIP(conn.localAddress)) return conn.geo
    }
    // Fallback: lookup public IP via ipify + GeoIP
    try {
      const publicIP = await this.getPublicIP()
      if (publicIP) return await this.geoIP.lookup(publicIP)
    } catch { /* ignore */ }
    return null
  }

  private getPublicIP(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = https.get('https://api.ipify.org?format=json', { timeout: 5000 }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => (data += chunk))
        res.on('end', () => { try { resolve(JSON.parse(data).ip || null) } catch { resolve(null) } })
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => { req.destroy(); resolve(null) })
    })
  }

  getTrafficHistory(): TrafficDataPoint[] { return [...this.trafficHistory] }

  private refreshListeningPorts(): Promise<void> {
    return new Promise((resolve) => {
      const encoded = Buffer.from(PS_LISTEN_SCRIPT, 'utf16le').toString('base64')
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error || !stdout.trim()) { resolve(); return }
        try {
          const ports: { Port: number; Protocol: string }[] = JSON.parse(stdout.trim())
          this.listeningPorts.clear()
          for (const p of ports) this.listeningPorts.add(`${p.Port}-${p.Protocol}`)
        } catch { /* ignore */ }
        resolve()
      })
    })
  }

  whitelistProcess(processName: string): void { this.whitelistedProcesses.add(processName) }
  unwhitelistProcess(processName: string): void { this.whitelistedProcesses.delete(processName) }
  getWhitelistedProcesses(): string[] { return Array.from(this.whitelistedProcesses) }

  setSnooze(durationMs: number): void { this.snoozedUntil = durationMs > 0 ? Date.now() + durationMs : 0 }
  isSnoozed(): boolean { return Date.now() < this.snoozedUntil }

  getConnections(): NetworkConnection[] { return Array.from(this.connections.values()) }
  getFaultDetector(): FaultDetector { return this.faultDetector }
  getHealth(): NetworkHealth { return this.faultDetector.getCurrentHealth() }
  getBandwidthMonitor(): BandwidthMonitor { return this.bandwidthMonitor }
  getQualityMonitor(): QualityMonitor { return this.qualityMonitor }

  private getConnectionsInternal(): Promise<Omit<NetworkConnection, 'id' | 'firstSeen' | 'lastSeen'>[]> {
    return new Promise((resolve) => {
      const encodedScript = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`, { maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        if (error || !stdout.trim()) { resolve([]); return }
        try {
          const data = stdout.trim()
          if (data === '') { resolve([]); return }
          const parsed = JSON.parse(data)
          const arr = Array.isArray(parsed) ? parsed : [parsed]
          const connections = arr.map((c: any) => ({
            protocol: c.Protocol as 'TCP' | 'UDP',
            localAddress: c.LocalAddress,
            localPort: c.LocalPort,
            remoteAddress: c.RemoteAddress,
            remotePort: c.RemotePort,
            state: c.State,
            processId: c.ProcessId,
            processName: c.ProcessName,
          }))
          resolve(connections)
        } catch { resolve([]) }
      })
    })
  }

  getStats(connections: NetworkConnection[]): NetworkStats {
    const countries = new Set<string>()
    const ips = new Set<string>()
    const processCounts = new Map<string, number>()
    const countryCounts = new Map<string, number>()

    for (const conn of connections) {
      if (conn.geo) {
        countries.add(conn.geo.country)
        countryCounts.set(conn.geo.country, (countryCounts.get(conn.geo.country) || 0) + 1)
      }
      ips.add(conn.remoteAddress)
      processCounts.set(conn.processName, (processCounts.get(conn.processName) || 0) + 1)
    }

    const topProcesses = Array.from(processCounts.entries())
      .map(([name, connections]) => ({ name, connections }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 10)

    const topCountries = Array.from(countryCounts.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      totalConnections: connections.length,
      activeConnections: connections.filter((c) => c.state === 'Established').length,
      uniqueCountries: countries.size,
      uniqueIPs: ips.size,
      totalBytesSent: 0,
      totalBytesReceived: 0,
      topProcesses,
      topCountries,
    }
  }

  getNetworkHealth(): NetworkHealth { return this.faultDetector.getCurrentHealth() }
  getOutageHistory(): OutageEvent[] { return this.faultDetector.getOutageHistory() }
  getActiveOutage(): OutageEvent | null { return this.faultDetector.getActiveOutage() }
  getUserLocation(): GeoLocation | null { return this.userLocation }
}

function isPrivateIP(ip: string | null | undefined): boolean {
  if (!ip || typeof ip !== 'string') return true
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true
  if (ip.startsWith('127.')) return true
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('169.254.')) return true
  if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return true
  if (ip.startsWith('fe80:')) return true
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true
  if (ip.includes(':') && !ip.includes('.')) return true
  return false
}

// Singleton export — matches the live-data.ts pattern
export const networkMonitor = new NetworkMonitor(new GeoIPService())
