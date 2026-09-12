/**
 * Fires Plugin — NASA FIRMS active fire detections.
 * Tier 3, Priority 8. Both repos use fire data.
 *
 * Subscribes to FIRE_UPDATE IPC channel from main process.
 * Renders fire detections as colored points with brightness-based sizing.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { WorldOverlay } from '../WorldOverlay'
import type { LiveFeature, LiveUpdate } from '@shared/types'

interface FireFeature {
  id: string
  lon: number
  lat: number
  brightness: number
  confidence: string
  frp: number // fire radiative power (MW)
  satellite: string
  acqTime: number
}

/** Convert LiveFeature to FireFeature */
function toFireFeature(f: LiveFeature): FireFeature | null {
  if (f.type !== 'fire') return null
  const meta = f.meta || {}
  return {
    id: f.id,
    lon: f.position.lon,
    lat: f.position.lat,
    brightness: (meta.brightness as number) ?? 0,
    confidence: (meta.confidence as string) ?? 'low',
    frp: (meta.frp as number) ?? 0,
    satellite: (meta.satellite as string) ?? '',
    acqTime: (meta.acq_time as number) ?? Date.now(),
  }
}

export class FiresPlugin implements EarthEnginePlugin {
  id = 'fires'
  name = 'Fires (NASA FIRMS)'
  category = 'live' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private worldOverlay: WorldOverlay | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private show = true
  private knownIds = new Set<string>()
  private unsubscribe: (() => void) | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.worldOverlay = ctx.worldOverlay ?? null
    this.dataSource = new Cesium.CustomDataSource('fires')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    // Subscribe to fire updates from main process
    const handler = (update: LiveUpdate) => {
      if (update.type === 'full' && update.features) {
        const fires = update.features.map(toFireFeature).filter((f): f is FireFeature => f !== null)
        this.handleFullUpdate(fires)
      } else if (update.type === 'delta') {
        const added = (update.added || []).map(toFireFeature).filter((f): f is FireFeature => f !== null)
        const removed = (update.removed || []).map((f) => f.id)
        this.handleDeltaUpdate(added, removed)
      }
    }

    const off = (ctx.ipc as any).on?.('fire:update', handler)
    this.unsubscribe = off ? () => off() : null

    if (!this.unsubscribe) {
      this.startPolling()
    }
  }

  unregister(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.worldOverlay) {
      this.worldOverlay.clearCategory('fire')
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
    // Fires are push-driven from main process
  }

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.show },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'count', label: 'Total Fires', value: String(this.status.count), color: this.status.count > 0 ? '#4aff8a' : '#6b7d92' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    }
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null

  private startPolling(): void {
    this.fetchFires()
    this.pollTimer = setInterval(() => this.fetchFires(), 60_000)
  }

  private async fetchFires(): Promise<void> {
    try {
      const features = await window.api.invoke('live:fires', {}) as LiveFeature[] | null
      if (features) {
        const fires = features.map(toFireFeature).filter((f): f is FireFeature => f !== null)
        this.handleFullUpdate(fires)
      }
    } catch (err) {
      this.status = { ...this.status, status: 'stale', error: String(err) }
    }
  }

  private handleFullUpdate(features: FireFeature[]): void {
    if (!this.dataSource) return
    this.dataSource.entities.removeAll()
    this.worldOverlay?.clearCategory('fire')
    this.knownIds.clear()

    for (const f of features) {
      this.addFireEntity(f)
      this.knownIds.add(f.id)
    }

    this.status = { count: features.length, status: 'nominal' }
  }

  private handleDeltaUpdate(added: FireFeature[], removed: string[]): void {
    if (!this.dataSource) return

    for (const id of removed) {
      this.dataSource.entities.removeById(`fire:${id}`)
      this.worldOverlay?.removeCard(`fire:${id}`)
      this.knownIds.delete(id)
    }

    for (const f of added) {
      if (this.knownIds.has(f.id)) continue
      this.addFireEntity(f)
      this.knownIds.add(f.id)
    }

    this.status = { count: this.knownIds.size, status: 'nominal' }
  }

  private addFireEntity(f: FireFeature): void {
    if (!this.dataSource) return

    // Brightness-based color: 300K (cool/dim) → 400K+ (hot/intense)
    const intensity = Math.max(0, Math.min(1, (f.brightness - 300) / 100))
    const color = Cesium.Color.fromBytes(
      Math.round(255),
      Math.round(74 + (200 - 74) * (1 - intensity)),
      Math.round(74 * (1 - intensity)),
      255,
    )

    // Size scales with FRP (fire radiative power)
    const pixelSize = Math.max(4, Math.min(12, 4 + f.frp / 10))

    this.dataSource.entities.add({
      id: `fire:${f.id}`,
      position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
      point: {
        pixelSize,
        color: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.fromBytes(255, 200, 100, 200)),
        outlineWidth: new Cesium.ConstantProperty(1),
      },
      properties: {
        brightness: f.brightness,
        confidence: f.confidence,
        frp: f.frp,
        satellite: f.satellite,
        acqTime: f.acqTime,
      },
    } as any)

    // Register card only for high-intensity fires (FRP > 50 MW)
    // This keeps the overlay clean — most fires are small
    if (this.worldOverlay && f.frp > 50) {
      this.worldOverlay.registerCard({
        id: `fire:${f.id}`,
        lat: f.lat,
        lon: f.lon,
        title: `FIRE ${f.frp.toFixed(0)}MW`,
        subtitle: `${f.brightness.toFixed(0)}K • ${f.confidence} • ${f.satellite}`,
        category: 'fire',
        priority: Math.min(10, Math.round(f.frp / 20)), // higher FRP = higher priority
        color: '#ff4a4a',
      })
    }
  }
}

export const firesPlugin = new FiresPlugin()
