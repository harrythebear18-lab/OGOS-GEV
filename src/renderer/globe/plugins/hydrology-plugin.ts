/**
 * Hydrology Plugin — Water features + runoff flow paths.
 * Tier 1, Priority 4. Terrain + water = core world logic.
 *
 * Renders:
 * - OSM water bodies (streams, lakes, rivers) via IPC
 * - Runoff flow paths from DEM analysis via IPC
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { WaterFeature, WaterResponse, RunoffAnalysisResponse, WatershedDivide } from '@shared/types'

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
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private showWater = true
  private showRunoff = true
  private rainfallMm = 0
  private lastRainfallBbox: string | null = null

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
    const bbox = sceneCtx?.selectionBbox
    if (!bbox) return

    this.lastBboxParsed = bbox

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

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'showWater', label: 'Water Features', value: this.showWater },
      { type: 'toggle', id: 'showRunoff', label: 'Runoff Paths', value: this.showRunoff },
      { type: 'button', id: 'run', label: 'Run Analysis', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger' },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'rainfall', label: 'Rainfall', value: `${this.rainfallMm.toFixed(1)} mm`, color: this.rainfallMm > 10 ? '#ff8a4a' : this.rainfallMm > 2 ? '#ffea4a' : '#4a8aff' },
      { type: 'display', id: 'waterCount', label: 'Water', value: String(this.waterSource?.entities.values.length ?? 0), color: '#4a8aff' },
      { type: 'display', id: 'runoffCount', label: 'Runoff', value: String(this.runoffSource?.entities.values.length ?? 0), color: '#ff8a4a' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'showWater' && typeof value === 'boolean') {
      this.setWaterVisible(value)
    } else if (id === 'showRunoff' && typeof value === 'boolean') {
      this.setRunoffVisible(value)
    } else if (id === 'run') {
      if (this.lastBboxParsed) {
        this.lastBbox = null  // force re-run
        if (this.showWater) this.fetchWater(this.lastBboxParsed)
        if (this.showRunoff) this.fetchRunoff(this.lastBboxParsed)
      }
    } else if (id === 'clear') {
      this.waterSource?.entities.removeAll()
      this.runoffSource?.entities.removeAll()
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
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
    this.status = { ...this.status, status: 'loading' }
    try {
      const result = await this.ipc.invoke('terrain:water:fetch', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
      }) as WaterResponse | null

      if (!result?.features) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.waterSource.entities.removeAll()

      for (const f of result.features) {
        this.addWaterEntity(f)
      }

      this.status = { count: result.features.length, status: 'nominal' }
    } catch (err) {
      console.warn('[hydrology] water fetch failed:', err)
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  private async fetchRunoff(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.ipc || !this.runoffSource) return
    this.status = { ...this.status, status: 'loading' }
    try {
      // Fetch rainfall for the bbox center (last 24h + next 24h from Open-Meteo)
      const rainfallMm = await this.ipc.invoke('weather:rainfall', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
      }) as number | null
      this.rainfallMm = rainfallMm ?? 0

      const result = await this.ipc.invoke('terrain:runoff:analysis', {
        bounds: [{ lng: bbox.west, lat: bbox.south }, { lng: bbox.east, lat: bbox.north }],
        rainfallMm: this.rainfallMm,
      }) as RunoffAnalysisResponse | null

      if (!result?.flowPaths) {
        this.status = { count: 0, status: 'nominal' }
        return
      }

      this.runoffSource.entities.removeAll()

      // Render flow paths — width and color scaled by discharge
      for (const path of result.flowPaths) {
        this.addRunoffEntity(path)
      }

      // Render pools as semi-transparent blue polygons
      if (result.pools) {
        for (const pool of result.pools) {
          this.addPoolEntity(pool)
        }
      }

      // Render flood risk zones as red polygons along high-risk flow paths
      if (result.floodZones) {
        for (const zone of result.floodZones) {
          this.addFloodZoneEntity(zone)
        }
      }

      // Render watershed divides as dashed ridge lines
      if (result.watershedDivides) {
        for (const divide of result.watershedDivides) {
          this.addWatershedEntity(divide)
        }
      }

      const totalEntities = result.flowPaths.length + (result.pools?.length ?? 0) + (result.floodZones?.length ?? 0) + (result.watershedDivides?.length ?? 0)
      this.status = { count: totalEntities, status: 'nominal' }
    } catch (err) {
      console.warn('[hydrology] runoff analysis failed:', err)
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  private addWaterEntity(f: WaterFeature): void {
    if (!this.waterSource || f.coords.length < 2) return

    const positions = f.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    if ((f.type === 'lake' || f.type === 'pond' || f.type === 'reservoir' || f.type === 'wetland') && f.coords.length >= 3) {
      // Polygon for lakes/ponds/reservoirs
      this.waterSource.entities.add({
        id: `water:${f.id}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: new Cesium.ColorMaterialProperty(Cesium.Color.fromBytes(74, 138, 255, 100)),
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

  private addRunoffEntity(path: { id: string; coords: { lng: number; lat: number }[]; dischargeLps: number }): void {
    if (!this.runoffSource || path.coords.length < 2) return

    const positions = path.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    // Width and color scale with discharge
    const discharge = path.dischargeLps
    const width = discharge > 200 ? 5 : discharge > 50 ? 3.5 : 2.5
    const color = discharge > 200
      ? Cesium.Color.fromBytes(255, 100, 74, 230)   // high discharge = red-orange
      : discharge > 50
        ? Cesium.Color.fromBytes(255, 180, 74, 220) // medium = orange
        : Cesium.Color.fromBytes(74, 200, 255, 220) // low = cyan

    this.runoffSource.entities.add({
      id: `runoff:${path.id}`,
      polyline: {
        positions: new Cesium.ConstantProperty(positions),
        width: new Cesium.ConstantProperty(width),
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: new Cesium.ConstantProperty(0.15),
          color: new Cesium.ConstantProperty(color),
        }),
        clampToGround: true,
      },
      properties: { dischargeLps: discharge },
    } as any)
  }

  private addPoolEntity(pool: { id: string; coords: { lng: number; lat: number }[]; depthM: number; volumeL: number }): void {
    if (!this.runoffSource || pool.coords.length < 3) return
    const positions = pool.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    // Deeper pools = darker blue
    const alpha = Math.min(0.6, 0.2 + pool.depthM * 0.05)
    this.runoffSource.entities.add({
      id: `pool:${pool.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromBytes(74, 138, 255, Math.round(alpha * 255))),
      },
      properties: { depthM: pool.depthM, volumeL: pool.volumeL },
    } as any)
  }

  private addFloodZoneEntity(zone: { id: string; coords: { lng: number; lat: number }[]; risk: number; reason: string }): void {
    if (!this.runoffSource || zone.coords.length < 3) return
    const positions = zone.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    // Risk-based color: high risk = bright red, low = orange
    const r = Math.round(255)
    const g = Math.round(100 + (1 - zone.risk) * 100)
    const b = Math.round(74 + (1 - zone.risk) * 50)
    const alpha = Math.round((0.3 + zone.risk * 0.4) * 255)

    this.runoffSource.entities.add({
      id: `flood:${zone.id}`,
      polyline: {
        positions: new Cesium.ConstantProperty(positions),
        width: new Cesium.ConstantProperty(4),
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromBytes(r, g, b, alpha)),
        clampToGround: true,
      },
      properties: { risk: zone.risk, reason: zone.reason },
    } as any)
  }

  private addWatershedEntity(divide: WatershedDivide): void {
    if (!this.runoffSource || divide.coords.length < 3) return
    const positions = divide.coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat))

    // Ridge lines: dashed amber outline + filled polygon
    this.runoffSource.entities.add({
      id: `watershed-fill:${divide.id}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: new Cesium.ColorMaterialProperty(Cesium.Color.fromBytes(180, 140, 60, 40)),
      },
      properties: { label: divide.label, areaKm2: divide.areaKm2 },
    } as any)

    this.runoffSource.entities.add({
      id: `watershed-line:${divide.id}`,
      polyline: {
        positions: new Cesium.ConstantProperty([...positions, positions[0]]),
        width: new Cesium.ConstantProperty(2.5),
        material: new Cesium.PolylineDashMaterialProperty({
          color: new Cesium.ConstantProperty(Cesium.Color.fromBytes(220, 180, 80, 220)),
          dashLength: new Cesium.ConstantProperty(12),
        }),
        clampToGround: true,
      },
      properties: { label: divide.label, areaKm2: divide.areaKm2 },
    } as any)
  }
}

export const hydrologyPlugin = new HydrologyPlugin()
