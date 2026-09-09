/**
 * Search Zones Plugin — Probability-weighted LKP search rings.
 * Tier 5, Priority 15. From OGOS.
 *
 * Given a Last Known Position (LKP) and trip parameters, computes
 * probability-weighted search ring polygons via IPC.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface SearchZone {
  id: string
  polygon: number[][] // [lon, lat]
  probability: number // 0-1
  label: string
}

export class SearchZonesPlugin implements EarthEnginePlugin {
  id = 'search-zones'
  name = 'Search Zones (LKP Rings)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private zones: SearchZone[] = []
  private lkp: { lon: number; lat: number } | null = null
  private clickHandler: Cesium.ScreenSpaceEventHandler | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('search-zones')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }

    // Click to set LKP
    this.clickHandler = new Cesium.ScreenSpaceEventHandler(ctx.viewer.canvas)
    this.clickHandler.setInputAction((click: any) => {
      this.handleClick(click)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  }

  unregister(): void {
    this.clickHandler?.destroy()
    this.clickHandler = null
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.zones = []
    this.lkp = null
    this.viewer = null
    this.ipc = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getZones(): SearchZone[] {
    return this.zones
  }

  getLkp(): { lon: number; lat: number } | null {
    return this.lkp
  }

  setLkp(lon: number, lat: number): void {
    this.lkp = { lon, lat }
    this.updateLkpMarker()
    this.computeZones()
  }

  clearAll(): void {
    this.zones = []
    this.lkp = null
    this.dataSource?.entities.removeAll()
    this.status = { count: 0, status: 'nominal' }
  }

  private handleClick(click: any): void {
    if (!this.viewer) return
    const ray = this.viewer.camera.getPickRay(click.position)
    if (!ray) return
    const cart = this.viewer.scene.globe.pick(ray, this.viewer.scene)
    if (!cart) return
    const carto = Cesium.Cartographic.fromCartesian(cart)
    this.setLkp(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude))
  }

  private updateLkpMarker(): void {
    if (!this.dataSource || !this.lkp) return
    this.dataSource.entities.removeById('lkp:marker')
    this.dataSource.entities.add({
      id: 'lkp:marker',
      position: Cesium.Cartesian3.fromDegrees(this.lkp.lon, this.lkp.lat),
      point: {
        pixelSize: 14,
        color: Cesium.Color.fromBytes(255, 74, 255, 255),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: 'LKP',
        font: '11px monospace',
        fillColor: Cesium.Color.fromBytes(255, 74, 255, 255),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    } as any)
  }

  private async computeZones(): Promise<void> {
    if (!this.ipc || !this.lkp || !this.dataSource) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('terrain:search:zones', {
        lkp: [this.lkp.lon, this.lkp.lat],
      }) as { zones: SearchZone[] } | null

      if (!result?.zones) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      // Clear old zones (keep LKP marker)
      const entities = this.dataSource.entities.values.slice()
      for (const e of entities) {
        if (e.id !== 'lkp:marker') this.dataSource.entities.remove(e)
      }

      this.zones = result.zones

      for (const zone of result.zones) {
        this.addZoneEntity(zone)
      }

      this.status = { count: result.zones.length, status: 'nominal' }
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      console.warn('[search-zones] compute failed:', err)
    }
  }

  private addZoneEntity(zone: SearchZone): void {
    if (!this.dataSource || zone.polygon.length < 3) return

    const positions = zone.polygon.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))

    // Probability-based color: 1.0 = red (high), 0.5 = orange, 0.0 = blue (low)
    const t = Math.max(0, Math.min(1, zone.probability))
    const color = Cesium.Color.fromBytes(
      Math.round(74 + (255 - 74) * t),
      Math.round(74 + (74 - 74) * t),
      Math.round(255 + (74 - 255) * t),
      255,
    )

    this.dataSource.entities.add({
      id: `zone:${zone.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.3)),
        outline: true,
        outlineColor: new Cesium.ConstantProperty(color.withAlpha(0.8)),
        outlineWidth: new Cesium.ConstantProperty(1),
      },
      properties: {
        probability: zone.probability,
        label: zone.label,
      },
    } as any)
  }
}

export const searchZonesPlugin = new SearchZonesPlugin()
