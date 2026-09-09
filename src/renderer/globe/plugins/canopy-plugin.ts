/**
 * Canopy Plugin — Vegetation intelligence.
 * Tier 2, Priority 6. NDVI, biome lookup, pseudo-LiDAR ground correction.
 *
 * Renders canopy height/NDVI as colored polygon overlays via IPC.
 * Used for movement prediction, hazard assessment, and SAR visibility.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface CanopyCell {
  id: string
  polygon: number[][] // [lon, lat]
  ndvi: number
  biome: string
  canopyHeight: number // meters
  groundHeight: number // meters (pseudo-LiDAR corrected)
}

export class CanopyPlugin implements EarthEnginePlugin {
  id = 'canopy'
  name = 'Canopy / Vegetation'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private lastBbox: string | null = null
  private cells: CanopyCell[] = []
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
    const bbox = sceneCtx?.bbox
    if (!bbox) return

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

  setNdviVisible(visible: boolean): void {
    this.showNdvi = visible
    this.showHeight = !visible
    this.rerender()
  }

  setHeightVisible(visible: boolean): void {
    this.showHeight = visible
    this.showNdvi = !visible
    this.rerender()
  }

  private rerender(): void {
    if (!this.dataSource) return
    this.dataSource.entities.removeAll()
    for (const cell of this.cells) {
      this.addCellEntity(cell)
    }
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:canopy:analysis', {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      }) as { cells: CanopyCell[] } | null

      if (!result?.cells) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.cells = result.cells
      this.dataSource.entities.removeAll()

      for (const cell of result.cells) {
        this.addCellEntity(cell)
      }

      this.status = { count: result.cells.length, status: 'nominal' }
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      console.warn('[canopy] analysis failed:', err)
    }
  }

  private addCellEntity(cell: CanopyCell): void {
    if (!this.dataSource || cell.polygon.length < 3) return

    const positions = cell.polygon.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))

    // NDVI color ramp: -1 (blue) → 0 (brown) → 0.5 (yellow) → 1 (dark green)
    // Height color ramp: 0m (dark) → 50m+ (bright green)
    const color = this.showHeight
      ? this.heightColor(cell.canopyHeight)
      : this.ndviColor(cell.ndvi)

    this.dataSource.entities.add({
      id: `canopy:${cell.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.5)),
        outline: true,
        outlineColor: new Cesium.ConstantProperty(color.withAlpha(0.9)),
        outlineWidth: new Cesium.ConstantProperty(0.5),
      },
      properties: {
        ndvi: cell.ndvi,
        biome: cell.biome,
        canopyHeight: cell.canopyHeight,
        groundHeight: cell.groundHeight,
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

  private heightColor(height: number): Cesium.Color {
    // 0m → dark, 50m+ → bright green
    const t = Math.max(0, Math.min(1, height / 50))
    return Cesium.Color.fromBytes(
      Math.round(20 + (40 - 20) * t),
      Math.round(40 + (180 - 40) * t),
      Math.round(20 + (60 - 20) * t),
      255,
    )
  }
}

export const canopyPlugin = new CanopyPlugin()
