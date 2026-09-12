/**
 * Earthquakes Plugin — USGS 24h M2.5+ feed.
 * Tier 1, Priority 2. Low-volume, high-value, both repos use it.
 *
 * Renders earthquake points as Cesium entities with magnitude-based sizing/color.
 * Polls USGS every 60 seconds. Delta updates only.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { WorldOverlay } from '../WorldOverlay'

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
const POLL_INTERVAL = 60_000

interface QuakeFeature {
  id: string
  mag: number
  place: string
  time: number
  lon: number
  lat: number
  depth: number
}

export class EarthquakesPlugin implements EarthEnginePlugin {
  id = 'earthquakes'
  name = 'Earthquakes (USGS)'
  category = 'live' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private worldOverlay: WorldOverlay | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private show = true
  private knownIds = new Set<string>()
  private status: PluginStats = { count: 0, status: 'disabled' }

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.worldOverlay = ctx.worldOverlay ?? null
    this.dataSource = new Cesium.CustomDataSource('earthquakes')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    // Initial poll
    await this.poll()

    // Set up recurring poll
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL)
  }

  unregister(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.worldOverlay) {
      this.worldOverlay.clearCategory('earthquake')
    }
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.worldOverlay = null
    this.knownIds.clear()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {
    // Could filter by viewport
  }

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.show },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'count', label: 'Count', value: String(this.status.count), color: this.status.count > 0 ? '#4aff8a' : '#6b7d92' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    }
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(USGS_URL, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`USGS HTTP ${res.status}`)
      const data = await res.json() as { features: any[] }

      const features: QuakeFeature[] = data.features.map((f: any) => ({
        id: f.id,
        mag: f.properties.mag ?? 0,
        place: f.properties.place ?? '',
        time: f.properties.time ?? 0,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depth: f.geometry.coordinates[2],
      }))

      // Delta update — remove old, add new
      const newIds = new Set(features.map((f) => f.id))
      const toRemove: string[] = []
      for (const id of this.knownIds) {
        if (!newIds.has(id)) toRemove.push(id)
      }

      if (this.dataSource) {
        for (const id of toRemove) {
          this.dataSource.entities.removeById(`quake:${id}`)
          this.worldOverlay?.removeCard(`quake:${id}`)
          this.knownIds.delete(id)
        }

        for (const f of features) {
          if (this.knownIds.has(f.id)) continue
          this.addEntity(f)
          this.knownIds.add(f.id)
        }
      }

      this.status = { count: features.length, status: 'nominal' }
    } catch (err) {
      this.status = { ...this.status, status: 'stale' }
      console.warn('[earthquakes] poll failed:', err)
    }
  }

  private addEntity(f: QuakeFeature): void {
    if (!this.dataSource) return

    // Magnitude-based color: <3 blue, 3-5 orange, >5 red
    const color = f.mag >= 5
      ? Cesium.Color.fromBytes(255, 74, 74, 255)
      : f.mag >= 3
        ? Cesium.Color.fromBytes(249, 115, 22, 255)
        : Cesium.Color.fromBytes(74, 158, 255, 255)

    const colorHex = f.mag >= 5 ? '#ff4a4a' : f.mag >= 3 ? '#f97316' : '#4a9eff'

    // Size scales with magnitude
    const pixelSize = Math.max(4, Math.min(15, f.mag * 2.5))

    this.dataSource.entities.add({
      id: `quake:${f.id}`,
      position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, 0),
      point: {
        pixelSize,
        color: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(0.6)),
        outlineWidth: new Cesium.ConstantProperty(1),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      properties: {
        mag: f.mag,
        place: f.place,
        time: f.time,
        depth: f.depth,
      },
    } as any)

    // Register card for significant earthquakes (M >= 4.0)
    if (this.worldOverlay && f.mag >= 4.0) {
      this.worldOverlay.registerCard({
        id: `quake:${f.id}`,
        lat: f.lat,
        lon: f.lon,
        title: `M${f.mag.toFixed(1)}`,
        subtitle: `${f.depth.toFixed(0)}km • ${f.place.slice(0, 30)}`,
        category: 'earthquake',
        priority: Math.min(10, Math.round(f.mag * 1.5)),
        color: colorHex,
      })
    }
  }
}

export const earthquakesPlugin = new EarthquakesPlugin()
