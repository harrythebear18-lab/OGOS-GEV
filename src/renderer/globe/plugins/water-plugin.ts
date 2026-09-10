/**
 * Water Plugin — OSM water features (streams, rivers, lakes, springs).
 * Tier 1, Priority 4. From OGOS.
 *
 * Fetches water bodies and waterways from OpenStreetMap via Overpass and
 * renders them on the globe:
 *  - Rivers/streams/canals → blue polylines (width scales with type)
 *  - Lakes/ponds/reservoirs → translucent blue polygons
 *  - Springs → point markers
 *  - Wetlands → green-blue polygons
 *
 * Uses the selection bbox as the fetch area. Runs automatically when the
 * bbox changes, or manually via the Fetch button.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { WaterResponse, WaterFeature } from '@shared/types'

export class WaterPlugin implements EarthEnginePlugin {
  id = 'water'
  name = 'Water (OSM Hydrology)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private features: WaterFeature[] = []
  private lastBbox: string | null = null
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private show = true
  private lastError: string | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('water')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.features = []
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

    this.fetchWater(bbox)
  }

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.show },
      { type: 'button', id: 'run', label: 'Fetch Water', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: this.features.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'rivers', label: 'Rivers/Streams', value: String(this.features.filter((f) => f.type === 'river' || f.type === 'stream').length), color: '#4a8aff' },
      { type: 'display', id: 'lakes', label: 'Lakes/Ponds', value: String(this.features.filter((f) => f.type === 'lake' || f.type === 'pond' || f.type === 'reservoir').length), color: '#4affd4' },
      { type: 'display', id: 'springs', label: 'Springs', value: String(this.features.filter((f) => f.type === 'spring').length), color: '#4aff8a' },
      ...(this.lastError ? [{ type: 'display' as const, id: 'error', label: 'Error', value: this.lastError.slice(0, 60), color: '#ff4a4a' }] : []),
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    } else if (id === 'run') {
      if (this.lastBboxParsed) {
        this.lastBbox = null
        this.fetchWater(this.lastBboxParsed)
      }
    } else if (id === 'clear') {
      this.dataSource?.entities.removeAll()
      this.features = []
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
  }

  getFeatures(): WaterFeature[] {
    return this.features
  }

  private async fetchWater(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:water:fetch', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
      }) as WaterResponse | null

      if (!result?.features) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.features = result.features
      this.lastError = result.error ?? null
      this.dataSource.entities.removeAll()

      for (const f of result.features) {
        this.addWaterEntity(f)
      }

      this.status = { count: result.features.length, status: 'nominal' }
    } catch (err) {
      console.warn('[water] fetch failed:', err)
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  private addWaterEntity(f: WaterFeature): void {
    if (!this.dataSource || f.coords.length === 0) return

    if (f.type === 'stream' || f.type === 'river') {
      // Linear waterways → polylines
      if (f.coords.length < 2) return
      const positions = f.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))
      const width = f.type === 'river' ? 3 : 1.5
      const color = f.type === 'river'
        ? Cesium.Color.fromBytes(74, 138, 255, 220)
        : Cesium.Color.fromBytes(74, 180, 255, 200)

      this.dataSource.entities.add({
        id: `water:${f.id}`,
        polyline: {
          positions: new Cesium.ConstantProperty(positions),
          width: new Cesium.ConstantProperty(width),
          material: new Cesium.ColorMaterialProperty(color),
          clampToGround: true,
        },
        properties: { type: f.type, name: f.name },
      } as any)
    } else if (f.type === 'lake' || f.type === 'pond' || f.type === 'reservoir' || f.type === 'wetland') {
      // Area water bodies → polygons
      if (f.coords.length < 3) return
      const positions = f.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))
      const color = f.type === 'wetland'
        ? Cesium.Color.fromBytes(74, 200, 120, 120)
        : Cesium.Color.fromBytes(74, 138, 255, 140)

      this.dataSource.entities.add({
        id: `water:${f.id}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: new Cesium.ColorMaterialProperty(color),
          outline: true,
          outlineColor: new Cesium.ConstantProperty(color.withAlpha(0.8)),
        },
        properties: { type: f.type, name: f.name },
      } as any)
    } else if (f.type === 'spring') {
      // Point water feature → point marker
      const c = f.coords[0]
      this.dataSource.entities.add({
        id: `water:${f.id}`,
        position: Cesium.Cartesian3.fromDegrees(c.lng, c.lat),
        point: {
          pixelSize: 8,
          color: new Cesium.ConstantProperty(Cesium.Color.fromBytes(74, 255, 138, 255)),
          outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE),
          outlineWidth: new Cesium.ConstantProperty(2),
          disableDepthTestDistance: new Cesium.ConstantProperty(Number.POSITIVE_INFINITY),
        },
        label: f.name ? {
          text: f.name,
          font: '10px sans-serif',
          fillColor: new Cesium.ConstantProperty(Cesium.Color.fromBytes(74, 255, 138, 255)),
          outlineColor: new Cesium.ConstantProperty(Cesium.Color.BLACK),
          outlineWidth: new Cesium.ConstantProperty(2),
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: new Cesium.ConstantProperty(Number.POSITIVE_INFINITY),
        } : undefined,
        properties: { type: f.type, name: f.name },
      } as any)
    }
  }
}

export const waterPlugin = new WaterPlugin()
