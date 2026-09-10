/**
 * Canopy Plugin — Vegetation intelligence.
 * Tier 2, Priority 6. NDVI, biome lookup, pseudo-LiDAR ground correction.
 *
 * Renders canopy height/NDVI as colored polygon overlays via IPC.
 * Used for movement prediction, hazard assessment, and SAR visibility.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { CanopyAnalysisResponse } from '@shared/types'

type CanopyZone = CanopyAnalysisResponse['zones'][number]

export class CanopyPlugin implements EarthEnginePlugin {
  id = 'canopy'
  name = 'Canopy / Vegetation'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private lastBbox: string | null = null
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private cells: CanopyZone[] = []
  private showNdvi = true
  private showHeight = false

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('canopy')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.cells = []
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
      { type: 'button', id: 'run', label: 'Run Analysis', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: this.cells.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'cells', label: 'Zones', value: String(this.cells.length), color: '#4aff8a' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'run') {
      if (this.lastBboxParsed) {
        this.lastBbox = null  // force re-run
        this.runAnalysis(this.lastBboxParsed)
      }
    } else if (id === 'clear') {
      this.dataSource?.entities.removeAll()
      this.cells = []
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
  }

  private rerender(): void {
    if (!this.dataSource) return
    this.dataSource.entities.removeAll()
    for (const zone of this.cells) {
      this.addZoneEntity(zone)
    }
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:canopy:analysis', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
      }) as CanopyAnalysisResponse | null

      if (!result?.zones) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.cells = result.zones
      this.dataSource.entities.removeAll()

      for (const zone of result.zones) {
        this.addZoneEntity(zone)
      }

      this.status = { count: result.zones.length, status: 'nominal' }
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      console.warn('[canopy] analysis failed:', err)
    }
  }

  private addZoneEntity(zone: CanopyZone): void {
    if (!this.dataSource || zone.coords.length < 3) return

    const positions = zone.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    // Color by NDVI: healthy forest = green, defoliation/clearing = red/orange
    const color = this.ndviColor(zone.avgNdvi)

    this.dataSource.entities.add({
      id: `canopy:${zone.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.5)),
      },
      properties: {
        type: zone.type,
        avgNdvi: zone.avgNdvi,
        severity: zone.severity,
      },
    } as any)
  }

  private ndviColor(ndvi: number): Cesium.Color {
    // NDVI: -1 to 1. Map to green ramp.
    const v = Math.max(-1, Math.min(1, ndvi))
    if (v < 0) {
      // Water/barren: blue to brown
      const t = (v + 1) / 1 // 0 to 1
      return Cesium.Color.fromBytes(
        Math.round(74 + (139 - 74) * t),
        Math.round(100 + (90 - 100) * t),
        Math.round(200 + (43 - 200) * t),
        255,
      )
    }
    // Vegetation: brown to dark green
    const t = v // 0 to 1
    return Cesium.Color.fromBytes(
      Math.round(139 + (20 - 139) * t),
      Math.round(90 + (120 - 90) * t),
      Math.round(43 + (40 - 43) * t),
      255,
    )
  }
}

export const canopyPlugin = new CanopyPlugin()
