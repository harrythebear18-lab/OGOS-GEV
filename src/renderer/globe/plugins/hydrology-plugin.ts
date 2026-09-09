/**
 * Hydrology Plugin — Water features + runoff flow paths.
 * Tier 1, Priority 4. Terrain + water = core world logic.
 *
 * Renders:
 * - OSM water bodies (streams, lakes, rivers) via IPC
 * - Runoff flow paths from DEM analysis via IPC
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface WaterFeature {
  id: string
  type: 'stream' | 'lake' | 'river'
  coordinates: number[][] // [lon, lat] pairs
  name?: string
}

interface RunoffPath {
  id: string
  coordinates: number[][]
  flowRate: number
  floodRisk: 'low' | 'medium' | 'high'
}

export class HydrologyPlugin implements EarthEnginePlugin {
  id = 'hydrology'
  name = 'Hydrology (Water + Runoff)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private waterSource: Cesium.CustomDataSource | null = null
  private runoffSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private ipc: typeof window.api | null = null
  private lastBbox: string | null = null
  private showWater = true
  private showRunoff = true

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.waterSource = new Cesium.CustomDataSource('hydrology-water')
    this.runoffSource = new Cesium.CustomDataSource('hydrology-runoff')
    ctx.viewer.dataSources.add(this.waterSource)
    ctx.viewer.dataSources.add(this.runoffSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    if (this.waterSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.waterSource)
    }
    if (this.runoffSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.runoffSource)
    }
    this.waterSource = null
    this.runoffSource = null
    this.viewer = null
    this.ipc = null
    this.lastBbox = null
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

    if (this.showWater) this.fetchWater(bbox)
    if (this.showRunoff) this.fetchRunoff(bbox)
  }

  getStats(): PluginStats {
    return this.status
  }

  setWaterVisible(visible: boolean): void {
    this.showWater = visible
    if (this.waterSource) this.waterSource.show = visible
  }

  setRunoffVisible(visible: boolean): void {
    this.showRunoff = visible
    if (this.runoffSource) this.runoffSource.show = visible
  }

  private async fetchWater(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.waterSource) return
    try {
      const result = await this.ipc.invoke('terrain:water:fetch', {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      }) as { features: WaterFeature[] } | null

      if (!result?.features) return

      this.waterSource.entities.removeAll()

      for (const f of result.features) {
        this.addWaterEntity(f)
      }

      this.status = { count: result.features.length, status: 'nominal' }
    } catch (err) {
      console.warn('[hydrology] water fetch failed:', err)
    }
  }

  private async fetchRunoff(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.runoffSource) return
    try {
      const result = await this.ipc.invoke('terrain:runoff:analysis', {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      }) as { paths: RunoffPath[] } | null

      if (!result?.paths) return

      this.runoffSource.entities.removeAll()

      for (const p of result.paths) {
        this.addRunoffEntity(p)
      }
    } catch (err) {
      console.warn('[hydrology] runoff analysis failed:', err)
    }
  }

  private addWaterEntity(f: WaterFeature): void {
    if (!this.waterSource || f.coordinates.length < 2) return

    const positions = f.coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))

    if (f.type === 'lake' && f.coordinates.length >= 3) {
      // Polygon for lakes
      this.waterSource.entities.add({
        id: `water:${f.id}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: new Cesium.ColorMaterialProperty(Cesium.Color.fromBytes(74, 138, 255, 100)),
          outline: true,
          outlineColor: new Cesium.ConstantProperty(Cesium.Color.fromBytes(74, 138, 255, 200)),
        },
        properties: { type: f.type, name: f.name },
      } as any)
    } else {
      // Polyline for streams/rivers
      this.waterSource.entities.add({
        id: `water:${f.id}`,
        polyline: {
          positions: new Cesium.ConstantProperty(positions),
          width: new Cesium.ConstantProperty(f.type === 'river' ? 3 : 1.5),
          material: new Cesium.ColorMaterialProperty(Cesium.Color.fromBytes(74, 138, 255, 200)),
          clampToGround: true,
        },
        properties: { type: f.type, name: f.name },
      } as any)
    }
  }

  private addRunoffEntity(p: RunoffPath): void {
    if (!this.runoffSource || p.coordinates.length < 2) return

    const positions = p.coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))

    const color = p.floodRisk === 'high'
      ? Cesium.Color.fromBytes(255, 74, 74, 200)
      : p.floodRisk === 'medium'
        ? Cesium.Color.fromBytes(255, 234, 74, 200)
        : Cesium.Color.fromBytes(74, 255, 138, 150)

    this.runoffSource.entities.add({
      id: `runoff:${p.id}`,
      polyline: {
        positions: new Cesium.ConstantProperty(positions),
        width: new Cesium.ConstantProperty(2),
        material: new Cesium.ColorMaterialProperty(color),
        clampToGround: true,
      },
      properties: { flowRate: p.flowRate, floodRisk: p.floodRisk },
    } as any)
  }
}

export const hydrologyPlugin = new HydrologyPlugin()
