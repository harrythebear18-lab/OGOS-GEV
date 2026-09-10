/**
 * Anomaly Plugin — terrain anomaly detection (depressions, prominences).
 * Tier 2, Priority 7. From OGOS.
 *
 * Detects terrain features that deviate significantly from the local average
 * (box-blur residuals). Useful for finding:
 *  - Caves, sinkholes, mineshafts, craters (depressions)
 *  - Rock spires, towers, peaks, buildings (prominences)
 *
 * Uses the selection bbox as the analysis area. Runs automatically when the
 * bbox changes, or manually via the Run button.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { AnomalyAnalysisResponse, AnomalyZone } from '@shared/types'

export class AnomalyPlugin implements EarthEnginePlugin {
  id = 'anomaly'
  name = 'Anomaly Detection (Terrain)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private zones: AnomalyZone[] = []
  private lastBbox: string | null = null
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private show = true

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('anomaly')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.zones = []
    this.lastBbox = null
    this.viewer = null
    this.ipc = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(ctx: PluginContext): void {
    const sceneCtx = ctx.sceneContext as any
    const bbox = sceneCtx?.selectionBbox
    if (!bbox) return

    this.lastBboxParsed = bbox

    const bboxKey = `${bbox.west.toFixed(2)},${bbox.south.toFixed(2)},${bbox.east.toFixed(2)},${bbox.north.toFixed(2)}`
    if (bboxKey === this.lastBbox) return
    this.lastBbox = bboxKey

    const height = sceneCtx?.camera?.height
    if (height && height > 500_000) return

    this.runAnalysis(bbox)
  }

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.show },
      { type: 'button', id: 'run', label: 'Run Analysis', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: this.zones.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'depressions', label: 'Depressions', value: String(this.zones.filter((z) => z.type === 'depression').length), color: '#4a8aff' },
      { type: 'display', id: 'prominences', label: 'Prominences', value: String(this.zones.filter((z) => z.type === 'prominence').length), color: '#ff8a4a' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    } else if (id === 'run') {
      if (this.lastBboxParsed) {
        this.lastBbox = null
        this.runAnalysis(this.lastBboxParsed)
      }
    } else if (id === 'clear') {
      this.dataSource?.entities.removeAll()
      this.zones = []
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
  }

  getZones(): AnomalyZone[] {
    return this.zones
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:anomaly:analysis', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
      }) as AnomalyAnalysisResponse | null

      if (!result?.zones) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.zones = result.zones
      this.dataSource.entities.removeAll()

      for (const zone of result.zones) {
        this.addZoneEntity(zone)
      }

      this.status = { count: result.zones.length, status: 'nominal' }
    } catch (err) {
      console.warn('[anomaly] analysis failed:', err)
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  private addZoneEntity(zone: AnomalyZone): void {
    if (!this.dataSource || zone.coords.length < 3) return
    const positions = zone.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    // Depressions = blue (holes, caves, craters)
    // Prominences = orange (spires, towers, peaks)
    const color = zone.type === 'depression'
      ? Cesium.Color.fromBytes(74, 138, 255, 140)
      : Cesium.Color.fromBytes(255, 138, 74, 140)

    const alpha = Math.round((0.3 + zone.strength * 0.5) * 255)

    this.dataSource.entities.add({
      id: `anomaly:${zone.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(alpha / 255)),
        outline: true,
        outlineColor: new Cesium.ConstantProperty(color),
      },
      properties: { type: zone.type, strength: zone.strength, sizeM: zone.sizeM },
    } as any)
  }
}

export const anomalyPlugin = new AnomalyPlugin()
