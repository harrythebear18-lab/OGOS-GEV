/**
 * Fall Risk Plugin — Slope/curvature/edge/weather fall-risk grid.
 * Tier 5, Priority 17. From OGOS.
 *
 * Computes fall-risk grid and convex-hull risk zones via IPC.
 * Renders as colored polygon overlays.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface RiskZone {
  id: string
  polygon: number[][]
  risk: 'low' | 'medium' | 'high' | 'extreme'
  avgSlope: number
  curvature: number
  edgeProximity: number
}

export class FallRiskPlugin implements EarthEnginePlugin {
  id = 'fall-risk'
  name = 'Fall Risk (Terrain Hazard)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private zones: RiskZone[] = []
  private lastBbox: string | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('fall-risk')
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

  getZones(): RiskZone[] {
    return this.zones
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:fall-risk', {
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      }) as { zones: RiskZone[] } | null

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
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  private addZoneEntity(zone: RiskZone): void {
    if (!this.dataSource || zone.polygon.length < 3) return

    const positions = zone.polygon.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))

    const color = this.riskColor(zone.risk)

    this.dataSource.entities.add({
      id: `fall-risk:${zone.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.35)),
        outline: true,
        outlineColor: new Cesium.ConstantProperty(color.withAlpha(0.9)),
        outlineWidth: new Cesium.ConstantProperty(1),
      },
      properties: {
        risk: zone.risk,
        avgSlope: zone.avgSlope,
        curvature: zone.curvature,
        edgeProximity: zone.edgeProximity,
      },
    } as any)
  }

  private riskColor(risk: string): Cesium.Color {
    switch (risk) {
      case 'extreme': return Cesium.Color.fromBytes(255, 74, 74, 255)
      case 'high': return Cesium.Color.fromBytes(255, 138, 74, 255)
      case 'medium': return Cesium.Color.fromBytes(255, 234, 74, 255)
      case 'low': return Cesium.Color.fromBytes(74, 255, 138, 255)
      default: return Cesium.Color.GRAY
    }
  }
}

export const fallRiskPlugin = new FallRiskPlugin()
