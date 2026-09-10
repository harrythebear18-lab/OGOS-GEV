/* Continuous health checks — ported from OGOS.
 * Measures latency, packet loss, DNS. Emits NetworkHealth (shared) and OutageEvent.
 * Adapts OGOS extended health to our simpler shared NetworkHealth shape. */
import { exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app, Notification } from 'electron'
import type { NetworkHealth } from '@shared/types'
import type {
  OutageEvent, FaultDetectionConfig, NetworkMedium, MediumThresholds,
  DetectionMethod, MediumDetection, TracerouteHop, NetworkHealthExtended,
} from './types'

class RateLimiter {
  private lastCall = 0
  private minInterval: number
  constructor(minIntervalMs: number) { this.minInterval = minIntervalMs }
  async throttle(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastCall
    if (elapsed < this.minInterval) await new Promise((r) => setTimeout(r, this.minInterval - elapsed))
    this.lastCall = Date.now()
  }
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn() } catch (error) {
      lastError = error as Error
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)))
    }
  }
  throw lastError ?? new Error('retryWithBackoff: all attempts failed')
}

const DEFAULT_CONFIG: FaultDetectionConfig = {
  checkInterval: 5000,
  latencyThreshold: 100,
  packetLossThreshold: 5,
  consecutiveFailures: 3,
  testHosts: ['8.8.8.8', '1.1.1.1', 'google.com', 'cloudflare.com'],
  dnsServers: ['8.8.8.8', '1.1.1.1'],
}

const MEDIUM_THRESHOLDS: Record<NetworkMedium, MediumThresholds> = {
  fiber: { latencyThreshold: 30, packetLossThreshold: 2, expectedLatencyRange: { min: 1, max: 20 } },
  copper: { latencyThreshold: 100, packetLossThreshold: 5, expectedLatencyRange: { min: 5, max: 50 } },
  wireless: { latencyThreshold: 150, packetLossThreshold: 8, expectedLatencyRange: { min: 10, max: 100 } },
  unknown: { latencyThreshold: 100, packetLossThreshold: 5, expectedLatencyRange: { min: 1, max: 100 } },
}

export class FaultDetector {
  private config: FaultDetectionConfig
  private interval: NodeJS.Timeout | null = null
  private isRunning = false
  private onHealthUpdate: (health: NetworkHealth) => void
  private onOutage: (outage: OutageEvent) => void
  private currentHealth: NetworkHealthExtended
  private consecutiveFailures = 0
  private activeOutage: OutageEvent | null = null
  private outageHistory: OutageEvent[] = []
  private latencyHistory: number[] = []
  private readonly outageHistoryPath: string
  private readonly maxLatencyHistory = 30
  private inferredMedium: NetworkMedium = 'unknown'
  private mediumConfidence = 0
  private readonly minSamplesForInference = 15
  private healthHistory: NetworkHealthExtended[] = []
  private readonly maxHealthHistoryPoints = 10080
  private detectionMethod: DetectionMethod = 'hybrid'
  private adapterInfo: { name: string; speed: number; mediaType?: string } | null = null
  private ispInfo: { name: string; asn: string } | null = null
  private lastTraceroute: string | null = null
  private lastAdapterCheck = 0
  private readonly adapterCheckInterval = 30000
  private apiRateLimiter = new RateLimiter(1000)

  constructor(
    onHealthUpdate: (health: NetworkHealth) => void,
    onOutage: (outage: OutageEvent) => void,
    config?: Partial<FaultDetectionConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onHealthUpdate = onHealthUpdate
    this.onOutage = onOutage
    this.currentHealth = this.getInitialHealth()
    try {
      this.outageHistoryPath = path.join(app.getPath('userData'), 'outage-history.json')
    } catch {
      this.outageHistoryPath = ''
    }
    this.loadOutageHistory()
  }

  getConfig(): FaultDetectionConfig { return { ...this.config } }

  private getInitialHealth(): NetworkHealthExtended {
    return {
      status: 'offline',
      connectivityScore: 0,
      latency: 0,
      packetLoss: 0,
      timestamp: Date.now(),
      dnsResolution: false,
      internetAccess: false,
      localNetwork: false,
    }
  }

  private loadOutageHistory(): void {
    try {
      if (this.outageHistoryPath && fs.existsSync(this.outageHistoryPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.outageHistoryPath, 'utf-8'))
        if (Array.isArray(parsed)) this.outageHistory = parsed
      }
    } catch { /* ignore */ }
  }

  private saveOutageHistory(): void {
    try {
      if (this.outageHistoryPath) fs.writeFileSync(this.outageHistoryPath, JSON.stringify(this.outageHistory, null, 2), 'utf-8')
    } catch { /* ignore */ }
  }

  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[network/fault-detector] start()')
    this.check()
    this.interval = setInterval(() => this.check(), this.config.checkInterval)
    this.detectAdapterInfo()
    this.detectISPInfo()
  }

  stop(): void {
    this.isRunning = false
    if (this.interval) { clearInterval(this.interval); this.interval = null }
  }

  private async detectAdapterInfo(): Promise<void> {
    const PS_SCRIPT = `
    $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    if ($adapter) {
      [PSCustomObject]@{ Name = $adapter.Name; Description = $adapter.InterfaceDescription; Speed = $adapter.LinkSpeed; MediaType = $adapter.MediaType }
    }`
    await retryWithBackoff(() => new Promise<void>((resolve) => {
      const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { windowsHide: true }, (error, stdout) => {
        if (error || !stdout.trim()) { resolve(); return }
        try {
          const data = JSON.parse(stdout.trim())
          if (data) this.adapterInfo = { name: data.Name, speed: this.parseSpeed(data.Speed), mediaType: data.MediaType }
        } catch { /* ignore */ }
        resolve()
      })
    }), 2, 500).catch(() => {})
  }

  private parseSpeed(speedStr: string): number {
    const match = speedStr?.match(/(\d+)\s*(G|M)?bps/i)
    if (!match) return 0
    const value = parseInt(match[1], 10)
    return match[2]?.toUpperCase() === 'G' ? value * 1000 : value
  }

  private async detectISPInfo(): Promise<void> {
    await this.apiRateLimiter.throttle()
    return new Promise<void>((resolve) => {
      exec(
        `powershell -NoProfile -NonInteractive -Command "(Invoke-RestMethod -Uri 'https://ip-api.com/json/').isp, (Invoke-RestMethod -Uri 'https://ip-api.com/json/').as"`,
        { windowsHide: true, timeout: 10000 },
        (error, stdout) => {
          if (error || !stdout.trim()) { resolve(); return }
          try {
            const parts = stdout.trim().split('\n')
            if (parts.length >= 2) this.ispInfo = { name: parts[0].trim(), asn: parts[1].trim() }
          } catch { /* ignore */ }
          resolve()
        },
      )
    })
  }

  private async performTraceroute(): Promise<string> {
    const PS_SCRIPT = `Test-NetConnection -ComputerName 8.8.8.8 -TraceRoute -Hops 10 | Select-Object -ExpandProperty TraceRoute | Select-Object -First 10`
    return new Promise((resolve) => {
      const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error || !stdout.trim()) { resolve('unknown'); return }
        const hops = stdout.trim().split('\n').filter((l) => l.trim())
        const lastHop = hops[hops.length - 1]?.trim() || 'unknown'
        this.lastTraceroute = lastHop
        resolve(lastHop)
      })
    })
  }

  async performDetailedTraceroute(): Promise<TracerouteHop[]> {
    const hops: TracerouteHop[] = []
    const target = '8.8.8.8'
    const maxHops = 10
    const attemptsPerHop = 3
    for (let hop = 1; hop <= maxHops; hop++) {
      const hopResults: number[] = []
      for (let attempt = 0; attempt < attemptsPerHop; attempt++) {
        const latency = await this.pingHop(target, hop)
        if (latency > 0) hopResults.push(latency)
      }
      if (hopResults.length > 0) {
        const avgLatency = hopResults.reduce((a, b) => a + b, 0) / hopResults.length
        const packetLoss = ((attemptsPerHop - hopResults.length) / attemptsPerHop) * 100
        hops.push({ hopNumber: hop, ipAddress: `hop-${hop}`, latency: Math.round(avgLatency), packetLoss: Math.round(packetLoss * 10) / 10, attempts: attemptsPerHop })
      } else {
        hops.push({ hopNumber: hop, ipAddress: '*', latency: 0, packetLoss: 100, attempts: attemptsPerHop })
      }
    }
    return hops
  }

  private async pingHop(target: string, ttl: number): Promise<number> {
    return new Promise((resolve) => {
      exec(`ping -n 1 -i ${ttl} ${target}`, { windowsHide: true, timeout: 2000 }, (error, stdout) => {
        if (error) { resolve(0); return }
        const match = stdout.match(/time[=<](\d+\.?\d*)\s*ms/i)
        resolve(match ? Math.round(parseFloat(match[1])) : 0)
      })
    })
  }

  private async checkForAdapterChanges(): Promise<void> {
    const PS_SCRIPT = `
    $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1
    if ($adapter) {
      [PSCustomObject]@{ Name = $adapter.Name; Description = $adapter.InterfaceDescription; Speed = $adapter.LinkSpeed; MediaType = $adapter.MediaType }
    }`
    return new Promise<void>((resolve) => {
      const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { windowsHide: true }, (error, stdout) => {
        if (error || !stdout.trim()) { resolve(); return }
        try {
          const data = JSON.parse(stdout.trim())
          if (data) {
            const newAdapter = { name: data.Name, speed: this.parseSpeed(data.Speed), mediaType: data.MediaType }
            if (!this.adapterInfo || this.adapterInfo.name !== newAdapter.name || this.adapterInfo.speed !== newAdapter.speed) {
              console.log('[network/fault-detector] adapter changed, re-detecting')
              this.adapterInfo = newAdapter
              this.inferredMedium = 'unknown'
              this.mediumConfidence = 0
              this.latencyHistory = []
              this.detectISPInfo()
            }
          }
        } catch { /* ignore */ }
        resolve()
      })
    })
  }

  private async check(): Promise<void> {
    try {
      const now = Date.now()
      if (now - this.lastAdapterCheck > this.adapterCheckInterval) {
        await this.checkForAdapterChanges()
        this.lastAdapterCheck = now
      }

      const results = await Promise.allSettled([
        this.checkLocalNetwork(),
        this.checkDNS(),
        this.checkInternetConnectivity(),
        this.measureLatency(),
      ])

      const localNetwork = results[0].status === 'fulfilled' ? results[0].value : false
      const dnsResolution = results[1].status === 'fulfilled' ? results[1].value : false
      const internetAccess = results[2].status === 'fulfilled' ? results[2].value : false
      const latency = results[3].status === 'fulfilled' ? results[3].value : 0

      this.latencyHistory.push(latency)
      if (this.latencyHistory.length > this.maxLatencyHistory) this.latencyHistory.shift()

      const avgLatency = this.averageLatency()
      const packetLoss = this.estimatePacketLoss()
      const latencyVariance = this.calculateLatencyVariance()
      const inferredMedium = this.inferNetworkMedium(avgLatency, latencyVariance)

      const extHealth: NetworkHealthExtended = {
        status: this.determineStatus(localNetwork, dnsResolution, internetAccess, avgLatency, packetLoss),
        connectivityScore: this.calculateConnectivityScore(localNetwork, dnsResolution, internetAccess, avgLatency, packetLoss),
        latency: avgLatency,
        packetLoss,
        timestamp: now,
        dnsResolution,
        internetAccess,
        localNetwork,
        inferredMedium,
        latencyVariance,
        detectionMethod: this.detectionMethod,
        detectionConfidence: this.mediumConfidence,
      }

      this.currentHealth = extHealth
      // Emit the shared NetworkHealth shape (subset of extended)
      this.onHealthUpdate({
        status: extHealth.status,
        connectivityScore: extHealth.connectivityScore,
        latency: extHealth.latency,
        packetLoss: extHealth.packetLoss,
        timestamp: extHealth.timestamp,
      })

      this.healthHistory.push(extHealth)
      if (this.healthHistory.length > this.maxHealthHistoryPoints) this.healthHistory.shift()

      this.detectOutages(extHealth)

      if (extHealth.status !== 'offline') this.consecutiveFailures = 0
      else this.consecutiveFailures++
    } catch (error) {
      console.error('[network/fault-detector] check error:', error)
      this.consecutiveFailures++
      if (this.consecutiveFailures >= this.config.consecutiveFailures && !this.activeOutage) {
        this.triggerOutage('internet', 'critical', 'Network connectivity lost')
      }
    }
  }

  private checkLocalNetwork(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('ping -n 1 -w 1000 127.0.0.1', { windowsHide: true }, (error) => resolve(!error))
    })
  }

  private checkDNS(): Promise<boolean> {
    const dnsServer = this.config.dnsServers[0]
    return new Promise((resolve) => {
      exec(`nslookup google.com ${dnsServer}`, { windowsHide: true, timeout: 3000 }, (error) => resolve(!error))
    })
  }

  private checkInternetConnectivity(): Promise<boolean> {
    const testHost = this.config.testHosts[0]
    return new Promise((resolve) => {
      exec(`ping -n 1 -w 2000 ${testHost}`, { windowsHide: true }, (error) => resolve(!error))
    })
  }

  setTestHosts(hosts: string[]): void {
    if (hosts && hosts.length > 0) this.config.testHosts = hosts
  }

  getTestHosts(): string[] { return [...this.config.testHosts] }

  private measureLatency(): Promise<number> {
    const testHost = this.config.testHosts[0]
    return new Promise((resolve) => {
      exec(`ping -n 1 ${testHost}`, { windowsHide: true, timeout: 3000 }, (error, stdout) => {
        if (error) { resolve(0); return }
        const match = stdout.match(/time[=<](\d+\.?\d*)\s*ms/i)
        resolve(match ? Math.round(parseFloat(match[1])) : 0)
      })
    })
  }

  private averageLatency(): number {
    const valid = this.latencyHistory.filter((l) => l > 0)
    if (valid.length === 0) return 0
    return valid.reduce((a, b) => a + b, 0) / valid.length
  }

  private calculateLatencyVariance(): number {
    const valid = this.latencyHistory.filter((l) => l > 0)
    if (valid.length < 2) return 0
    const recent = valid.slice(-20)
    const interArrivals: number[] = []
    for (let i = 1; i < recent.length; i++) interArrivals.push(Math.abs(recent[i] - recent[i - 1]))
    const meanInterArrival = interArrivals.reduce((a, b) => a + b, 0) / interArrivals.length
    const avg = this.averageLatency()
    const squaredDiffs = recent.map((l) => Math.pow(l - avg, 2))
    const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length)
    return Math.round(meanInterArrival * 0.7 + stdDev * 0.3)
  }

  private estimatePacketLoss(): number {
    if (this.latencyHistory.length === 0) return 0
    const failures = this.latencyHistory.filter((l) => l === 0).length
    return (failures / this.latencyHistory.length) * 100
  }

  private inferNetworkMedium(avgLatency: number, variance: number): NetworkMedium {
    const detections: MediumDetection[] = []
    const statistical = this.detectByStatistics(avgLatency, variance)
    if (statistical) detections.push(statistical)
    const adapter = this.detectByAdapter()
    if (adapter) detections.push(adapter)
    const speed = this.detectBySpeed()
    if (speed) detections.push(speed)
    const name = this.detectByName()
    if (name) detections.push(name)
    return this.combineDetections(detections)
  }

  private detectByStatistics(avgLatency: number, variance: number): MediumDetection | null {
    if (this.latencyHistory.length < this.minSamplesForInference) return null
    const valid = this.latencyHistory.filter((l) => l > 0)
    if (valid.length < this.minSamplesForInference) return null
    let medium: NetworkMedium = 'unknown'
    let confidence = 0
    if (avgLatency <= 15 && variance <= 5) { medium = 'fiber'; confidence = 85 }
    else if (avgLatency >= 10 && avgLatency <= 60 && variance <= 20) { medium = 'copper'; confidence = 75 }
    else if (avgLatency >= 20 && variance >= 15) { medium = 'wireless'; confidence = 80 }
    if (medium === 'unknown') return null
    return { medium, method: 'statistical', confidence, details: `Latency: ${avgLatency.toFixed(1)}ms, Jitter: ${variance.toFixed(1)}ms` }
  }

  private detectByAdapter(): MediumDetection | null {
    if (!this.adapterInfo?.mediaType) return null
    const mediaType = this.adapterInfo.mediaType.toLowerCase()
    let medium: NetworkMedium = 'unknown'
    if (mediaType.includes('fiber') || mediaType.includes('optical') || mediaType.includes('802.3')) medium = 'fiber'
    else if (mediaType.includes('wireless') || mediaType.includes('wi-fi') || mediaType.includes('802.11')) medium = 'wireless'
    else if (mediaType.includes('ethernet')) medium = 'copper'
    if (medium === 'unknown') return null
    return { medium, method: 'adapter', confidence: 95, details: `Adapter: ${this.adapterInfo.name}, MediaType: ${this.adapterInfo.mediaType}` }
  }

  private detectBySpeed(): MediumDetection | null {
    if (!this.adapterInfo?.speed) return null
    const speed = this.adapterInfo.speed
    let medium: NetworkMedium = 'unknown'
    let confidence = 60
    if (speed >= 10000) { medium = 'fiber'; confidence = 70 }
    else if (speed >= 1000) { medium = 'copper'; confidence = 50 }
    else if (speed <= 300) { medium = 'wireless'; confidence = 55 }
    if (medium === 'unknown') return null
    return { medium, method: 'speed', confidence, details: `Link speed: ${speed}Mbps` }
  }

  private detectByName(): MediumDetection | null {
    if (!this.adapterInfo?.name) return null
    const name = this.adapterInfo.name.toLowerCase()
    let medium: NetworkMedium = 'unknown'
    let confidence = 65
    if (name.includes('mobile') || name.includes('hotspot') || name.includes('cellular') || name.includes('lte') || name.includes('5g') || name.includes('4g')) { medium = 'wireless'; confidence = 95 }
    else if (name.includes('wi-fi') || name.includes('wifi') || name.includes('wireless')) { medium = 'wireless'; confidence = 80 }
    else if (name.includes('fiber') || name.includes('optical') || name.includes('sfp')) { medium = 'fiber'; confidence = 85 }
    else if (name.includes('ethernet') || name.includes('eth') || name.includes('lan')) { medium = 'copper'; confidence = 60 }
    if (medium === 'unknown') return null
    return { medium, method: 'name', confidence, details: `Adapter name: ${this.adapterInfo.name}` }
  }

  private combineDetections(detections: MediumDetection[]): NetworkMedium {
    if (detections.length === 0) return 'unknown'
    const weights: Record<DetectionMethod, number> = { adapter: 0.4, statistical: 0.3, name: 0.2, speed: 0.1, hybrid: 0.5 }
    const scores: Record<NetworkMedium, number> = { fiber: 0, copper: 0, wireless: 0, unknown: 0 }
    for (const d of detections) {
      const weight = weights[d.method] || 0.25
      scores[d.medium] += (d.confidence / 100) * weight
    }
    let bestMedium: NetworkMedium = 'unknown'
    let bestScore = 0
    for (const [medium, score] of Object.entries(scores)) {
      if (score > bestScore) { bestScore = score; bestMedium = medium as NetworkMedium }
    }
    const matching = detections.filter((d) => d.medium === bestMedium)
    const highestConfidence = matching.length > 0 ? Math.max(...matching.map((d) => d.confidence)) : 0
    this.mediumConfidence = highestConfidence
    this.inferredMedium = bestMedium
    if (detections.find((d) => d.method === 'adapter')) this.detectionMethod = 'adapter'
    else if (detections.find((d) => d.method === 'statistical')) this.detectionMethod = 'statistical'
    else if (detections.length > 1) this.detectionMethod = 'hybrid'
    else this.detectionMethod = detections[0]?.method || 'statistical'
    return this.mediumConfidence >= 30 ? bestMedium : 'unknown'
  }

  private determineStatus(localNetwork: boolean, dnsResolution: boolean, internetAccess: boolean, latency: number, packetLoss: number): NetworkHealth['status'] {
    const thresholds = MEDIUM_THRESHOLDS[this.inferredMedium] || MEDIUM_THRESHOLDS.unknown
    if (!localNetwork) return 'offline'
    if (!internetAccess) return 'critical'
    if (!dnsResolution) return 'critical'
    if (packetLoss > thresholds.packetLossThreshold) return 'degraded'
    if (latency > thresholds.latencyThreshold) return 'degraded'
    return 'healthy'
  }

  private calculateConnectivityScore(localNetwork: boolean, dnsResolution: boolean, internetAccess: boolean, latency: number, packetLoss: number): number {
    const thresholds = MEDIUM_THRESHOLDS[this.inferredMedium] || MEDIUM_THRESHOLDS.unknown
    let score = 0
    if (localNetwork) score += 25
    if (dnsResolution) score += 25
    if (internetAccess) score += 25
    if (latency === 0) { /* no data */ }
    else if (latency <= thresholds.expectedLatencyRange.max) score += 25
    else if (latency <= thresholds.expectedLatencyRange.max * 2) score += 20
    else if (latency <= thresholds.expectedLatencyRange.max * 3) score += 15
    else if (latency <= thresholds.expectedLatencyRange.max * 5) score += 10
    else score += 5
    const packetLossPenalty = packetLoss / thresholds.packetLossThreshold
    score = score * (1 - Math.min(1, packetLossPenalty))
    return Math.max(0, Math.min(100, Math.round(score)))
  }

  private detectOutages(health: NetworkHealthExtended): void {
    if (!this.activeOutage && health.status === 'offline') {
      this.triggerOutage('internet', 'critical', 'Network completely offline')
    } else if (!this.activeOutage && health.status === 'critical') {
      if (!health.internetAccess) this.triggerOutage('internet', 'major', 'Internet access lost')
      else if (!health.dnsResolution) this.triggerOutage('dns', 'major', 'DNS resolution failure')
    } else if (!this.activeOutage && health.status === 'degraded') {
      if (health.packetLoss > this.config.packetLossThreshold * 2) this.triggerOutage('packet_loss', 'minor', `High packet loss: ${health.packetLoss.toFixed(1)}%`)
      else if (health.latency > this.config.latencyThreshold * 3) this.triggerOutage('high_latency', 'minor', `High latency: ${health.latency}ms`)
    }
    if (this.activeOutage && health.status === 'healthy') this.resolveOutage()
  }

  private async triggerOutage(type: OutageEvent['type'], severity: OutageEvent['severity'], description: string): Promise<void> {
    const now = Date.now()
    let scope: OutageEvent['scope'] = 'local'
    let failurePoint = 'unknown'
    if (type === 'internet' || type === 'dns') {
      failurePoint = await this.performTraceroute()
      if (failurePoint.includes('192.168.') || failurePoint.includes('10.') || failurePoint.includes('172.')) scope = 'local'
      else if (this.ispInfo && (failurePoint.includes(this.ispInfo.asn) || failurePoint.includes(this.ispInfo?.name || ''))) scope = 'isp'
      else scope = 'area'
    }
    const outage: OutageEvent = {
      id: `outage-${now}`, startTime: now, type, severity, description, resolved: false,
      scope, isp: this.ispInfo?.name, failurePoint,
      areaAffected: scope === 'area' ? 'Regional' : undefined,
    }
    this.activeOutage = outage
    this.outageHistory.push(outage)
    if (this.outageHistory.length > 500) this.outageHistory.shift()
    this.saveOutageHistory()
    console.log(`[network/fault-detector] outage: ${severity} ${type} - ${description}`)
    this.onOutage(outage)
    this.showOutageNotification(outage)
  }

  private showOutageNotification(outage: OutageEvent): void {
    if (!Notification.isSupported()) return
    new Notification({
      title: `Network ${outage.severity.toUpperCase()}: ${outage.type}`,
      body: outage.description,
      urgency: outage.severity === 'critical' ? 'critical' : 'normal',
    }).show()
    if (outage.severity === 'critical') this.playAlertSound()
  }

  private playAlertSound(): void {
    exec('powershell -NoProfile -NonInteractive -Command "[console]::beep(800, 200)"', { windowsHide: true }, () => {})
  }

  private resolveOutage(): void {
    if (!this.activeOutage) return
    const now = Date.now()
    this.activeOutage.endTime = now
    this.activeOutage.duration = now - this.activeOutage.startTime
    this.activeOutage.resolved = true
    this.saveOutageHistory()
    console.log(`[network/fault-detector] outage resolved: ${this.activeOutage.type} (${this.activeOutage.duration}ms)`)
    this.onOutage({ ...this.activeOutage })
    this.activeOutage = null
  }

  getCurrentHealth(): NetworkHealth {
    const h = this.currentHealth
    return { status: h.status, connectivityScore: h.connectivityScore, latency: h.latency, packetLoss: h.packetLoss, timestamp: h.timestamp }
  }

  getHealthHistory(): NetworkHealthExtended[] { return [...this.healthHistory] }

  getHealthHistoryForPeriod(hours: number): NetworkHealthExtended[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000
    return this.healthHistory.filter((h) => h.timestamp >= cutoff)
  }

  analyzeOutagePatterns(): {
    totalOutages: number; averageDuration: number; mostCommonType: string
    mostCommonSeverity: string; hourlyDistribution: Record<number, number>
  } {
    const resolved = this.outageHistory.filter((o) => o.resolved && o.duration)
    if (resolved.length === 0) return { totalOutages: 0, averageDuration: 0, mostCommonType: 'none', mostCommonSeverity: 'none', hourlyDistribution: {} }
    const typeCounts = resolved.reduce((acc, o) => { acc[o.type] = (acc[o.type] || 0) + 1; return acc }, {} as Record<string, number>)
    const severityCounts = resolved.reduce((acc, o) => { acc[o.severity] = (acc[o.severity] || 0) + 1; return acc }, {} as Record<string, number>)
    const hourlyDistribution = resolved.reduce((acc, o) => { const hour = new Date(o.startTime).getHours(); acc[hour] = (acc[hour] || 0) + 1; return acc }, {} as Record<number, number>)
    const avgDuration = resolved.reduce((sum, o) => sum + (o.duration || 0), 0) / resolved.length
    return {
      totalOutages: resolved.length, averageDuration: Math.round(avgDuration),
      mostCommonType: Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      mostCommonSeverity: Object.entries(severityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
      hourlyDistribution,
    }
  }

  calculateNetworkQualityScore(): number {
    if (this.healthHistory.length < 10) return 50
    const recent = this.healthHistory.slice(-60)
    const avgLatency = recent.reduce((s, h) => s + h.latency, 0) / recent.length
    const avgPacketLoss = recent.reduce((s, h) => s + h.packetLoss, 0) / recent.length
    const avgConnectivity = recent.reduce((s, h) => s + h.connectivityScore, 0) / recent.length
    let score = avgConnectivity
    if (avgLatency > 100) score -= 10
    if (avgLatency > 200) score -= 10
    if (avgLatency > 500) score -= 20
    if (avgPacketLoss > 1) score -= 10
    if (avgPacketLoss > 5) score -= 20
    if (avgPacketLoss > 10) score -= 30
    return Math.max(0, Math.min(100, Math.round(score)))
  }

  getOutageHistory(): OutageEvent[] { return [...this.outageHistory] }
  getActiveOutage(): OutageEvent | null { return this.activeOutage }

  updateConfig(config: Partial<FaultDetectionConfig>): void {
    this.config = { ...this.config, ...config }
    if (config.checkInterval && this.isRunning) { this.stop(); this.start() }
  }
}
