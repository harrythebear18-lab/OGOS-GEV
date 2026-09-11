/**
 * Slope Bands Plugin — DEM-derived slope analysis.
 * Tier 1, Priority 3. Both repos use slope for terrain understanding.
 *
 * Requests slope analysis from main process (via IPC), renders colored bands
 * on the globe as a Cesium imagery layer or polygon overlay.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { SlopeBand } from '@shared/types'

export class SlopeBandsPlugin implements EarthEnginePlugin {
  id = 'slope-bands'
  name = 'Slope Bands (DEM Analysis)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private currentBands: SlopeBand[] = []
  private lastBbox: string | null = null
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private ipc: typeof window.api | null = null
  private profile: 'hiking' | 'scrambling' | 'sar' = 'hiking'

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
    // Re-run analysis only when user draws a selection bbox
    const sceneCtx = ctx.sceneContext as any
    const bbox = sceneCtx?.selectionBbox
    if (!bbox) return

    this.lastBboxParsed = bbox

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

  getControls(): PluginControlSpec[] {
    return [
      { type: 'select', id: 'profile', label: 'Profile', value: this.profile, options: [
        { label: 'Hiking', value: 'hiking' },
        { label: 'Scrambling', value: 'scrambling' },
        { label: 'SAR', value: 'sar' },
      ]},
      { type: 'button', id: 'run', label: 'Run Analysis', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: this.currentBands.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'bands', label: 'Bands', value: String(this.currentBands.length), color: '#4aff8a' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'profile' && typeof value === 'string') {
      this.profile = value as 'hiking' | 'scrambling' | 'sar'
    } else if (id === 'run') {
      if (this.lastBboxParsed) {
        this.lastBbox = null  // force re-run
        this.runAnalysis(this.lastBboxParsed)
      }
    } else if (id === 'clear') {
      this.dataSource?.entities.removeAll()
      this.currentBands = []
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
  }

  getCurrentBands(): SlopeBand[] {
    return this.currentBands
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.dataSource || !this.ipc) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:slope:analysis', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
        profile: this.profile,
      }) as { bands: SlopeBand[] } | null

      if (!result || !result.bands) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      // Re-check after async — plugin may have been deactivated during fetch
      if (!this.dataSource) {
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
    if (!this.dataSource || band.coords.length < 3) return

    const positions = band.coords.map((c) =>
      Cesium.Cartesian3.fromDegrees(c.lng, c.lat),
    )

    // Color by slope degree: green (passable) → orange (steep) → red (impassable)
    const deg = band.slopeDeg
    const color = deg > 45
      ? Cesium.Color.fromBytes(255, 74, 74, 255)
      : deg > 30
        ? Cesium.Color.fromBytes(255, 138, 74, 255)
        : deg > 15
          ? Cesium.Color.fromBytes(255, 234, 74, 255)
          : Cesium.Color.fromBytes(74, 255, 138, 255)

    this.dataSource.entities.add({
      id: `slope:${band.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.4)),
      },
      properties: {
        class: band.class,
        slopeDeg: band.slopeDeg,
      },
    } as any)
  }
}

export const slopeBandsPlugin = new SlopeBandsPlugin()
