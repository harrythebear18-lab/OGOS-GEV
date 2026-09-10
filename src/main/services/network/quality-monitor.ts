/* Connection quality monitoring — ported from OGOS. */
import type { ConnectionQuality } from './types'

export class QualityMonitor {
  private qualityHistory = new Map<string, ConnectionQuality[]>()
  private readonly maxHistoryPoints = 100
  private connectionLatency = new Map<string, number[]>()
  private connectionPacketLoss = new Map<string, number[]>()

  recordLatency(remoteAddress: string, remotePort: number, latency: number): void {
    const key = `${remoteAddress}:${remotePort}`
    if (!this.connectionLatency.has(key)) this.connectionLatency.set(key, [])
    const history = this.connectionLatency.get(key)!
    history.push(latency)
    if (history.length > 10) history.shift()
  }

  recordPacketLoss(remoteAddress: string, remotePort: number, lost: boolean): void {
    const key = `${remoteAddress}:${remotePort}`
    if (!this.connectionPacketLoss.has(key)) this.connectionPacketLoss.set(key, [])
    const history = this.connectionPacketLoss.get(key)!
    history.push(lost ? 1 : 0)
    if (history.length > 10) history.shift()
  }

  calculateQualityScore(remoteAddress: string, remotePort: number): number {
    const key = `${remoteAddress}:${remotePort}`
    const latencyHistory = this.connectionLatency.get(key) || []
    const packetLossHistory = this.connectionPacketLoss.get(key) || []
    if (latencyHistory.length === 0) return 50

    const avgLatency = latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length
    const packetLossRate = packetLossHistory.length > 0
      ? packetLossHistory.reduce((a, b) => a + b, 0) / packetLossHistory.length
      : 0

    let score = 100
    if (avgLatency > 50) score -= 10
    if (avgLatency > 100) score -= 15
    if (avgLatency > 200) score -= 20
    if (avgLatency > 500) score -= 25
    if (packetLossRate > 0.01) score -= 10
    if (packetLossRate > 0.05) score -= 20
    if (packetLossRate > 0.1) score -= 30
    if (packetLossRate > 0.2) score -= 40

    return Math.max(0, Math.min(100, Math.round(score)))
  }

  captureQualitySnapshot(): ConnectionQuality[] {
    const snapshot: ConnectionQuality[] = []
    const now = Date.now()

    for (const [key, latencyHistory] of this.connectionLatency) {
      const [remoteAddress, remotePortStr] = key.split(':')
      const remotePort = parseInt(remotePortStr, 10)
      const packetLossHistory = this.connectionPacketLoss.get(key) || []
      const avgLatency = latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length
      const packetLossRate = packetLossHistory.length > 0
        ? packetLossHistory.reduce((a, b) => a + b, 0) / packetLossHistory.length
        : 0

      const quality: ConnectionQuality = {
        remoteAddress, remotePort,
        qualityScore: this.calculateQualityScore(remoteAddress, remotePort),
        latency: Math.round(avgLatency),
        packetLoss: Math.round(packetLossRate * 1000) / 10,
        timestamp: now,
      }
      snapshot.push(quality)
      if (!this.qualityHistory.has(key)) this.qualityHistory.set(key, [])
      const history = this.qualityHistory.get(key)!
      history.push(quality)
      if (history.length > this.maxHistoryPoints) history.shift()
    }

    return snapshot.sort((a, b) => a.qualityScore - b.qualityScore)
  }

  getQualityHistory(remoteAddress: string, remotePort: number): ConnectionQuality[] {
    return this.qualityHistory.get(`${remoteAddress}:${remotePort}`) || []
  }

  getAllQualityHistory(): Map<string, ConnectionQuality[]> {
    return new Map(this.qualityHistory)
  }

  getQualityHeatmapData(): Array<{ x: number; y: number; quality: number; address: string; port: number }> {
    const heatmapData: Array<{ x: number; y: number; quality: number; address: string; port: number }> = []
    for (const [key, history] of this.qualityHistory) {
      if (history.length > 0) {
        const latest = history[history.length - 1]
        const [address, portStr] = key.split(':')
        const port = parseInt(portStr, 10)
        const ipParts = address.split('.').map(Number)
        const x = (ipParts[0] * 256 + ipParts[1]) % 100
        const y = (ipParts[2] * 256 + ipParts[3]) % 100
        heatmapData.push({ x, y, quality: latest.qualityScore, address, port })
      }
    }
    return heatmapData
  }

  clearHistory(): void {
    this.qualityHistory.clear()
    this.connectionLatency.clear()
    this.connectionPacketLoss.clear()
  }
}
