/**
 * Weather Plugin — RainViewer radar + Open-Meteo forecast.
 * Tier 1, Priority 1. Both OGOS and GEV rely on weather heavily.
 *
 * Renders:
 * - RainViewer radar tiles as a Cesium imagery overlay (blended, semi-transparent)
 * - RainViewer satellite infrared tiles (optional)
 * - Current conditions + 24h forecast via IPC (weather panel reads this)
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface RadarData {
  host: string
  radarPast: { time: number; path: string }[]
  radarNowcast: { time: number; path: string }[]
  satellite: { time: number; path: string }[]
  generated: number
}

export class WeatherPlugin implements EarthEnginePlugin {
  id = 'weather'
  name = 'Weather (Radar + Forecast)'
  category = 'live' as const

  private viewer: Cesium.Viewer | null = null
  private radarLayer: Cesium.ImageryLayer | null = null
  private satelliteLayer: Cesium.ImageryLayer | null = null
  private radarData: RadarData | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private showRadar = true
  private showSatellite = false
  private radarOpacity = 0.6

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.status = { count: 0, status: 'loading' }

    // Fetch radar metadata
    try {
      this.radarData = await this.fetchRadarData()
      this.status = { count: this.radarData.radarPast.length, status: 'nominal' }
    } catch (err) {
      this.status = { count: 0, status: 'error', error: String(err) }
      console.error('[weather] failed to fetch radar data:', err)
    }

    // Add radar layer (latest past frame)
    if (this.radarData && this.showRadar) {
      this.addRadarLayer()
    }

    // Poll for new radar frames every 10 minutes
    this.pollTimer = setInterval(() => this.refreshRadar(), 10 * 60 * 1000)
  }

  unregister(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.removeRadarLayer()
    this.removeSatelliteLayer()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {
    // Could re-fetch weather for new viewport center
  }

  getStats(): PluginStats {
    return this.status
  }

  // ── Public API for UI panel ──

  setRadarVisible(visible: boolean): void {
    this.showRadar = visible
    if (visible) {
      this.addRadarLayer()
    } else {
      this.removeRadarLayer()
    }
  }

  setSatelliteVisible(visible: boolean): void {
    this.showSatellite = visible
    if (visible) {
      this.addSatelliteLayer()
    } else {
      this.removeSatelliteLayer()
    }
  }

  setRadarOpacity(opacity: number): void {
    this.radarOpacity = opacity
    if (this.radarLayer) this.radarLayer.alpha = opacity
  }

  getRadarData(): RadarData | null {
    return this.radarData
  }

  // ── Internal ──

  private async fetchRadarData(): Promise<RadarData> {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json')
    if (!res.ok) throw new Error(`RainViewer API error: ${res.status}`)
    const data = await res.json()
    return {
      host: data.host,
      radarPast: (data.radar?.past || []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path })),
      radarNowcast: (data.radar?.nowcast || []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path })),
      satellite: (data.satellite?.infrared || []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path })),
      generated: Date.now(),
    }
  }

  private async refreshRadar(): Promise<void> {
    try {
      this.radarData = await this.fetchRadarData()
      this.status = { count: this.radarData.radarPast.length, status: 'nominal' }
      // Refresh the radar layer with the latest frame
      if (this.showRadar) {
        this.removeRadarLayer()
        this.addRadarLayer()
      }
    } catch (err) {
      this.status = { ...this.status, status: 'stale' }
      console.warn('[weather] radar refresh failed:', err)
    }
  }

  private addRadarLayer(): void {
    if (!this.viewer || !this.radarData || this.radarLayer) return
    // Use the latest past frame
    const frames = this.radarData.radarPast
    if (frames.length === 0) return
    const frame = frames[frames.length - 1]
    const url = `${this.radarData.host}${frame.path}/512/{z}/{x}/{y}/4/1_1.png`

    const provider = new Cesium.UrlTemplateImageryProvider({
      url,
      maximumLevel: 12,
      credit: new Cesium.Credit('RainViewer'),
    })

    this.radarLayer = this.viewer.imageryLayers.addImageryProvider(provider)
    this.radarLayer.alpha = this.radarOpacity
    // Render above the base imagery
    this.radarLayer.brightness = 1.2
  }

  private removeRadarLayer(): void {
    if (this.radarLayer && this.viewer) {
      this.viewer.imageryLayers.remove(this.radarLayer)
      this.radarLayer = null
    }
  }

  private addSatelliteLayer(): void {
    if (!this.viewer || !this.radarData || this.satelliteLayer) return
    const frames = this.radarData.satellite
    if (frames.length === 0) return
    const frame = frames[frames.length - 1]
    const url = `${this.radarData.host}${frame.path}/512/{z}/{x}/{y}/0/0_0.png`

    const provider = new Cesium.UrlTemplateImageryProvider({
      url,
      maximumLevel: 12,
      credit: new Cesium.Credit('RainViewer Satellite'),
    })

    this.satelliteLayer = this.viewer.imageryLayers.addImageryProvider(provider)
    this.satelliteLayer.alpha = 0.5
  }

  private removeSatelliteLayer(): void {
    if (this.satelliteLayer && this.viewer) {
      this.viewer.imageryLayers.remove(this.satelliteLayer)
      this.satelliteLayer = null
    }
  }
}

export const weatherPlugin = new WeatherPlugin()
