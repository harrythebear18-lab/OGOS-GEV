/**
 * Roads Plugin — OSM vector road/trail network overlay.
 * Tier 1, Priority 5. From OGOS.
 *
 * Fetches roads, paths, and trails from OpenStreetMap via Overpass and
 * renders them as colored polylines on the globe. Road type determines
 * color and width:
 *  - motorway/trunk/primary/secondary/tertiary  → thick yellow (roads)
 *  - residential/unclassified/service           → medium orange (streets)
 *  - path/footway/cycleway/track/bridleway      → thin green (trails)
 *  - steps/pedestrian                           → thin white (paths)
 *
 * This is the vector road network used by the route planner. It complements
 * the Esri imagery road overlay with actual OSM vector geometry.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { RoadResponse, RoadSegment } from '@shared/types'

export class RoadsPlugin implements EarthEnginePlugin {
  id = 'roads'
  name = 'Roads (OSM Vector Network)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private segments: RoadSegment[] = []
  private lastBbox: string | null = null
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private visible = true

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('roads')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.segments = []
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

    this.fetchRoads(bbox)
  }

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.visible },
      { type: 'button', id: 'run', label: 'Fetch Roads', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: this.segments.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'segments', label: 'Segments', value: String(this.segments.length), color: '#ffd24a' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.visible = value
      if (this.dataSource) this.dataSource.show = value
    } else if (id === 'run') {
      if (this.lastBboxParsed) {
        this.lastBbox = null
        this.fetchRoads(this.lastBboxParsed)
      }
    } else if (id === 'clear') {
      this.dataSource?.entities.removeAll()
      this.segments = []
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
  }

  getSegments(): RoadSegment[] {
    return this.segments
  }

  private async fetchRoads(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:road:fetch', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
      }) as RoadResponse | null

      if (!result?.segments) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.segments = result.segments
      this.dataSource.entities.removeAll()

      for (const seg of result.segments) {
        this.addRoadEntity(seg)
      }

      this.status = { count: result.segments.length, status: 'nominal' }
    } catch (err) {
      console.warn('[roads] fetch failed:', err)
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  private addRoadEntity(seg: RoadSegment): void {
    if (!this.dataSource || seg.coords.length < 2) return
    const positions = seg.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    const { color, width } = this.roadStyle(seg.highwayType)

    this.dataSource.entities.add({
      id: `road:${seg.id}`,
      polyline: {
        positions: new Cesium.ConstantProperty(positions),
        width: new Cesium.ConstantProperty(width),
        material: new Cesium.ColorMaterialProperty(color),
        clampToGround: true,
      },
      properties: { highwayType: seg.highwayType, name: seg.name },
    } as any)
  }

  private roadStyle(highwayType: string): { color: Cesium.Color; width: number } {
    const t = highwayType
    if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(t)) {
      return { color: Cesium.Color.fromBytes(255, 210, 74, 230), width: 4 }   // yellow — roads
    }
    if (['residential', 'unclassified', 'service', 'living_street', 'pedestrian'].includes(t)) {
      return { color: Cesium.Color.fromBytes(255, 160, 74, 200), width: 2.5 } // orange — streets
    }
    if (['path', 'footway', 'cycleway', 'track', 'bridleway'].includes(t)) {
      return { color: Cesium.Color.fromBytes(120, 220, 120, 200), width: 2 } // green — trails
    }
    if (['steps', 'corridor'].includes(t)) {
      return { color: Cesium.Color.fromBytes(220, 220, 220, 180), width: 1.5 } // white — paths
    }
    return { color: Cesium.Color.fromBytes(180, 180, 180, 160), width: 1.5 }   // gray — other
  }
}

export const roadsPlugin = new RoadsPlugin()
