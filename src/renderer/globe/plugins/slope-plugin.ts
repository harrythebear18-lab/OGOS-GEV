/**
 * Slope Bands Plugin — DEM-derived slope analysis.
 * Tier 1, Priority 3. Both repos use slope for terrain understanding.
 *
 * Requests slope analysis from main process (via IPC), renders colored bands
 * on the globe as a Cesium imagery layer or polygon overlay.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface SlopeBand {
  id: string
  level: 'flat' | 'gentle' | 'moderate' | 'steep' | 'extreme'
  polygon: number[][] // [lon, lat] pairs
  color: string
  avgSlope: number
}

export class SlopeBandsPlugin implements EarthEnginePlugin {
  id = 'slope-bands'
  name = 'Slope Bands (DEM Analysis)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private currentBands: SlopeBand[] = []
  private lastBbox: string | null = null
  private ipc: typeof window.api | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('slope-bands')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.currentBands = []
    this.lastBbox = null
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(ctx: PluginContext): void {
    // Re-run analysis when viewport changes significantly
    const sceneCtx = ctx.sceneContext as any
    const bbox = sceneCtx?.bbox
    if (!bbox) return

    const bboxKey = `${bbox.west.toFixed(2)},${bbox.south.toFixed(2)},${bbox.east.toFixed(2)},${bbox.north.toFixed(2)}`
    if (bboxKey === this.lastBbox) return
    this.lastBbox = bboxKey

    // Throttle analysis — only if zoomed in enough
    const height = sceneCtx?.camera?.height
    if (height && height > 500_000) return // too zoomed out

    this.runAnalysis(bbox)
  }

  getStats(): PluginStats {
    return this.status
  }

  getCurrentBands(): SlopeBand[] {
    return this.currentBands
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.dataSource || !this.ipc) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:slope:analysis', {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      }) as { bands: SlopeBand[] } | null

      if (!result || !result.bands) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      // Clear old bands
      this.dataSource.entities.removeAll()
      this.currentBands = result.bands

      // Render new bands
      for (const band of result.bands) {
        this.addBandEntity(band)
      }

      this.status = { count: result.bands.length, status: 'nominal' }
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      console.warn('[slope-bands] analysis failed:', err)
    }
  }

  private addBandEntity(band: SlopeBand): void {
    if (!this.dataSource || band.polygon.length < 3) return

    const positions = band.polygon.map(([lon, lat]) =>
      Cesium.Cartesian3.fromDegrees(lon, lat),
    )

    const color = this.parseColor(band.color)

    this.dataSource.entities.add({
      id: `slope:${band.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.4)),
        outline: true,
        outlineColor: new Cesium.ConstantProperty(color),
        outlineWidth: new Cesium.ConstantProperty(1),
      },
      properties: {
        level: band.level,
        avgSlope: band.avgSlope,
      },
    } as any)
  }

  private parseColor(hex: string): Cesium.Color {
    try {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      return new Cesium.Color(r, g, b, 1.0)
    } catch {
      return Cesium.Color.ORANGE
    }
  }
}

export const slopeBandsPlugin = new SlopeBandsPlugin()
