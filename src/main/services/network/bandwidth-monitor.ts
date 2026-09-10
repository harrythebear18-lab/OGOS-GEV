/* Per-process bandwidth monitoring — ported from OGOS. */
import type { BandwidthUsage } from './types'

export class BandwidthMonitor {
  private bandwidthHistory = new Map<string, BandwidthUsage[]>()
  private readonly maxHistoryPoints = 60
  private processBandwidth = new Map<string, { sent: number; received: number; connections: number }>()

  updateProcessBandwidth(processName: string, processId: number, bytesSent: number, bytesReceived: number): void {
    const key = `${processName}-${processId}`
    const current = this.processBandwidth.get(key) || { sent: 0, received: 0, connections: 0 }
    // Simulate bandwidth data since Windows doesn't easily provide per-process bandwidth
    const simulatedSent = Math.random() * 1000
    const simulatedReceived = Math.random() * 5000
    this.processBandwidth.set(key, {
      sent: current.sent + simulatedSent,
      received: current.received + simulatedReceived,
      connections: current.connections + 1,
    })
  }

  captureSnapshot(): BandwidthUsage[] {
    const snapshot: BandwidthUsage[] = []
    const now = Date.now()

    for (const [key, data] of this.processBandwidth.entries()) {
      const [processName, processIdStr] = key.split('-')
      const processId = parseInt(processIdStr, 10)
      const usage: BandwidthUsage = {
        processName, processId,
        bytesSent: data.sent, bytesReceived: data.received,
        totalBytes: data.sent + data.received, connections: data.connections,
        timestamp: now,
      }
      snapshot.push(usage)
      if (!this.bandwidthHistory.has(key)) this.bandwidthHistory.set(key, [])
      const history = this.bandwidthHistory.get(key)!
      history.push(usage)
      if (history.length > this.maxHistoryPoints) history.shift()
    }

    this.processBandwidth.clear()
    return snapshot.sort((a, b) => b.totalBytes - a.totalBytes)
  }

  getBandwidthHistory(processName: string, processId: number): BandwidthUsage[] {
    return this.bandwidthHistory.get(`${processName}-${processId}`) || []
  }

  getAllBandwidthHistory(): Map<string, BandwidthUsage[]> {
    return new Map(this.bandwidthHistory)
  }

  getTopBandwidthUsers(limit = 10): BandwidthUsage[] {
    const all: BandwidthUsage[] = []
    for (const history of this.bandwidthHistory.values()) {
      if (history.length > 0) all.push(history[history.length - 1])
    }
    return all.sort((a, b) => b.totalBytes - a.totalBytes).slice(0, limit)
  }

  getTotalBandwidth(): { sent: number; received: number; total: number } {
    let sent = 0, received = 0
    for (const history of this.bandwidthHistory.values()) {
      if (history.length > 0) {
        const latest = history[history.length - 1]
        sent += latest.bytesSent
        received += latest.bytesReceived
      }
    }
    return { sent, received, total: sent + received }
  }

  clearHistory(): void {
    this.bandwidthHistory.clear()
    this.processBandwidth.clear()
  }
}
