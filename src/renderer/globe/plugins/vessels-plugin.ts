/**
 * Vessels Plugin — AIS maritime tracking.
 * Tier 3, Priority 10. Both repos use vessel overlays.
 *
 * Subscribes to VESSEL_UPDATE IPC channel from main process.
 * Renders vessels as chevron billboards with heading orientation.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'
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
  private status: PluginStats = { count: 0, status: 'disabled' }
  private knownMmsi = new Set<string>()
  private unsubscribe: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
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
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.knownMmsi.clear()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
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

    this.dataSource.entities.add({
      id: `vessel:${f.mmsi}`,
      position: Cesium.Cartesian3.fromDegrees(f.lon, f.lat),
      point: {
        pixelSize: 5,
        color: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(0.5)),
        outlineWidth: new Cesium.ConstantProperty(1),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: f.name ? {
        text: f.name.trim().slice(0, 12),
        font: '9px monospace',
        fillColor: new Cesium.ConstantProperty(color.withAlpha(0.8)),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.BLACK),
        outlineWidth: new Cesium.ConstantProperty(2),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      properties: {
        speed: f.speed,
        heading: f.heading,
        shipType: f.shipType,
        destination: f.destination,
      },
    } as any)
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
}

export const vesselsPlugin = new VesselsPlugin()
