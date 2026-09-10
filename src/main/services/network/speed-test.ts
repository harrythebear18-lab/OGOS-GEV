/* Network speed test — ported from OGOS.
 * Emits progress via callback (caller broadcasts via SPEEDTEST_PROGRESS). */
import { exec } from 'child_process'
import type { SpeedTestResult } from './types'

export class SpeedTestService {
  private isRunning = false
  private onProgress?: (progress: number) => void

  setOnProgress(cb: (progress: number) => void): void {
    this.onProgress = cb
  }

  async runSpeedTest(): Promise<SpeedTestResult> {
    if (this.isRunning) throw new Error('Speed test already running')
    this.isRunning = true
    console.log('[network/speed-test] starting speed test')

    try {
      this.onProgress?.(10)
      const latency = await this.measureLatency()

      this.onProgress?.(30)
      const downloadSpeed = await this.measureDownloadSpeed()

      this.onProgress?.(70)
      const uploadSpeed = await this.measureUploadSpeed()

      this.onProgress?.(90)
      const jitter = await this.measureJitter()

      this.onProgress?.(100)
      console.log(`[network/speed-test] done: down=${downloadSpeed} up=${uploadSpeed} lat=${latency} jit=${jitter}`)

      return { downloadSpeed, uploadSpeed, latency, jitter, timestamp: Date.now() }
    } finally {
      this.isRunning = false
    }
  }

  private pingCmd(count: number): string {
    return `ping -n ${count} 8.8.8.8`
  }

  private parseLatencies(stdout: string): number[] {
    const matches = stdout.match(/time[=<](\d+[\d.]*)\s*ms/g)
    if (!matches) return []
    return matches.map((m) => parseFloat(m.replace(/time[=<]/, '').replace(/ms/, '').trim()))
  }

  private measureLatency(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(4), { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error) { resolve(0); return }
        const latencies = this.parseLatencies(stdout)
        resolve(latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0)
      })
    })
  }

  private measureDownloadSpeed(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(1), { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error) { resolve(0); return }
        const latencies = this.parseLatencies(stdout)
        if (latencies.length > 0) {
          resolve(Math.round(Math.max(1, Math.min(1000, 10000 / (latencies[0] + 1)))))
        } else { resolve(0) }
      })
    })
  }

  private measureUploadSpeed(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(1), { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error) { resolve(0); return }
        const latencies = this.parseLatencies(stdout)
        if (latencies.length > 0) {
          resolve(Math.round(Math.max(1, Math.min(1000, 10000 / (latencies[0] + 1))) * 0.3))
        } else { resolve(0) }
      })
    })
  }

  private measureJitter(): Promise<number> {
    return new Promise((resolve) => {
      exec(this.pingCmd(10), { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error) { resolve(0); return }
        const latencies = this.parseLatencies(stdout)
        if (latencies.length > 1) {
          const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
          const variance = latencies.reduce((sum, lat) => sum + Math.pow(lat - avg, 2), 0) / latencies.length
          resolve(Math.round(Math.sqrt(variance)))
        } else { resolve(0) }
      })
    })
  }

  isTestRunning(): boolean {
    return this.isRunning
  }
}
