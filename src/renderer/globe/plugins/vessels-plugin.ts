/**
 * Vessels Plugin — AIS maritime tracking.
 * Tier 3, Priority 10. Both repos use vessel overlays.
 *
 * Subscribes to VESSEL_UPDATE IPC channel from main process.
 * Renders vessels as chevron billboards with heading orientation.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { WorldOverlay } from '../WorldOverlay'
import type { LiveFeature, LiveUpdate } from '@shared/types'

interface VesselFeature {
  mmsi: string
  lon: number
  lat: number
  speed: number // knots
  heading: number // degrees
  shipType?: string
  name?: string
  destination?: string
}

/** Convert LiveFeature to VesselFeature */
function toVesselFeature(f: LiveFeature): VesselFeature | null {
  if (f.type !== 'vessel') return null
  const meta = f.meta || {}
  return {
    mmsi: String(meta.mmsi ?? f.id.replace(/^vessel:/, '')),
    lon: f.position.lon,
    lat: f.position.lat,
    speed: (meta.speed as number) ?? 0,
    heading: f.velocity?.heading ?? (meta.course as number) ?? 0,
    shipType: meta.shipType as string | undefined,
    name: meta.name as string | undefined,
    destination: meta.destination as string | undefined,
  }
}

export class VesselsPlugin implements EarthEnginePlugin {
  id = 'vessels'
  name = 'Vessels (AIS)'
  category = 'live' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private worldOverlay: WorldOverlay | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private show = true
  private knownMmsi = new Set<string>()
  private unsubscribe: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.worldOverlay = ctx.worldOverlay ?? null
    this.dataSource = new Cesium.CustomDataSource('vessels')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    const handler = (update: LiveUpdate) => {
      if (update.type === 'full' && update.features) {
        const vessels = update.features.map(toVesselFeature).filter((f): f is VesselFeature => f !== null)
        this.handleFullUpdate(vessels)
      } else if (update.type === 'delta') {
        const added = (update.added || []).map(toVesselFeature).filter((f): f is VesselFeature => f !== null)
        const removed = (update.removed || []).map((f) => f.id.replace(/^vessel:/, ''))
        this.handleDeltaUpdate(added, removed)
      }
    }

    const off = (ctx.ipc as any).on?.('vessel:update', handler)
    this.unsubscribe = off ? () => off() : null

    // Request initial vessel data immediately (don't wait for next poll)
    try {
      const features = await ctx.ipc.invoke('live:vessels', {}) as LiveFeature[] | null
      if (features && features.length > 0) {
        const vessels = features.map(toVesselFeature).filter((f): f is VesselFeature => f !== null)
        this.handleFullUpdate(vessels)
      }
    } catch (err) {
      console.warn('[vessels] initial fetch failed:', err)
    }

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
      this.worldOverlay.clearCategory('vessel')
    }
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.worldOverlay = null
    this.knownMmsi.clear()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.show },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'count', label: 'Vessels', value: String(this.status.count), color: this.status.count > 0 ? '#4aff8a' : '#6b7d92' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    }
  }

  private startPolling(): void {
    this.fetchVessels()
    this.pollTimer = setInterval(() => this.fetchVessels(), 30_000)
  }

  private async fetchVessels(): Promise<void> {
    try {
      const features = await window.api.invoke('live:vessels', {}) as LiveFeature[] | null
      if (features) {
        const vessels = features.map(toVesselFeature).filter((f): f is VesselFeature => f !== null)
        this.handleFullUpdate(vessels)
      }
    } catch (err) {
      this.status = { ...this.status, status: 'stale', error: String(err) }
    }
  }

  private handleFullUpdate(features: VesselFeature[]): void {
    if (!this.dataSource) return
    this.dataSource.entities.removeAll()
    this.worldOverlay?.clearCategory('vessel')
    this.knownMmsi.clear()

    for (const f of features) {
      this.addVesselEntity(f)
      this.knownMmsi.add(f.mmsi)
    }

    this.status = { count: features.length, status: 'nominal' }
  }

  private handleDeltaUpdate(added: VesselFeature[], removed: string[]): void {
    if (!this.dataSource) return

    for (const mmsi of removed) {
      this.dataSource.entities.removeById(`vessel:${mmsi}`)
      this.worldOverlay?.removeCard(`vessel:${mmsi}`)
      this.knownMmsi.delete(mmsi)
    }

    for (const f of added) {
      if (this.knownMmsi.has(f.mmsi)) continue
      this.addVesselEntity(f)
      this.knownMmsi.add(f.mmsi)
    }

    this.status = { count: this.knownMmsi.size, status: 'nominal' }
  }

  private addVesselEntity(f: VesselFeature): void {
    if (!this.dataSource) return

    // Color by ship type: cargo=cyan, tanker=orange, passenger=green, fishing=yellow, other=gray
    const color = this.shipTypeColor(f.shipType)
    const colorHex = this.shipTypeColorHex(f.shipType)

    this.dataSource.entities.add({
      id: `vessel:${f.mmsi}`,
      position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
      point: {
        pixelSize: 5,
        color: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(0.5)),
        outlineWidth: new Cesium.ConstantProperty(1),
      },
      // No label here — managed by WorldOverlay for collision
      properties: {
        speed: f.speed,
        heading: f.heading,
        shipType: f.shipType,
        destination: f.destination,
      },
    } as any)

    // Register card through shared WorldOverlay (collision-managed)
    if (this.worldOverlay) {
      const name = f.name?.trim() || `MMSI ${f.mmsi}`
      const subtitle = `${f.speed.toFixed(1)}kt • ${Math.round(f.heading)}°${f.shipType ? ` • ${f.shipType}` : ''}`
      this.worldOverlay.registerCard({
        id: `vessel:${f.mmsi}`,
        lat: f.lat,
        lon: f.lon,
        title: name.slice(0, 20),
        subtitle,
        category: 'vessel',
        priority: 5,
        color: colorHex,
      })
    }
  }

  private shipTypeColor(shipType?: string): Cesium.Color {
    if (!shipType) return Cesium.Color.fromBytes(138, 138, 138, 255)
    const t = shipType.toLowerCase()
    if (t.includes('cargo') || t.includes('container')) return Cesium.Color.fromBytes(74, 200, 255, 255)
    if (t.includes('tanker')) return Cesium.Color.fromBytes(255, 138, 74, 255)
    if (t.includes('passenger')) return Cesium.Color.fromBytes(74, 255, 138, 255)
    if (t.includes('fishing')) return Cesium.Color.fromBytes(255, 234, 74, 255)
    return Cesium.Color.fromBytes(138, 138, 138, 255)
  }

  private shipTypeColorHex(shipType?: string): string {
    if (!shipType) return '#8a8a8a'
    const t = shipType.toLowerCase()
    if (t.includes('cargo') || t.includes('container')) return '#4ac8ff'
    if (t.includes('tanker')) return '#ff8a4a'
    if (t.includes('passenger')) return '#4aff8a'
    if (t.includes('fishing')) return '#ffea4a'
    return '#8a8a8a'
  }
}

export const vesselsPlugin = new VesselsPlugin()
