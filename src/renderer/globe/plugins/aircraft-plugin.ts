/**
 * Aircraft Plugin — OpenSky ADS-B + adsb.lol fallback.
 * Tier 3, Priority 9. Both repos use aircraft overlays.
 *
 * Subscribes to AIRCRAFT_UPDATE IPC channel from main process.
 * Renders aircraft as billboards with heading-based orientation.
 * Dead-reckoning for smooth motion between updates.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { WorldOverlay } from '../WorldOverlay'
import type { LiveFeature, LiveUpdate } from '@shared/types'

interface AircraftFeature {
  icao24: string
  callsign: string
  lon: number
  lat: number
  altitude: number // meters
  velocity: number // m/s
  heading: number // degrees
  verticalRate: number // m/s
  origin?: string
  destination?: string
}

/** Convert LiveFeature (IPC format) to AircraftFeature (plugin internal format) */
function toAircraftFeature(f: LiveFeature): AircraftFeature | null {
  if (f.type !== 'aircraft') return null
  const meta = f.meta || {}
  return {
    icao24: (meta.icao24 as string) || f.id.replace(/^aircraft:/, ''),
    callsign: (meta.callsign as string) || f.id,
    lon: f.position.lon,
    lat: f.position.lat,
    altitude: f.position.height ?? (meta.altitude as number) ?? 0,
    velocity: f.velocity?.speed ?? (meta.velocity as number) ?? 0,
    heading: f.velocity?.heading ?? (meta.heading as number) ?? 0,
    verticalRate: (meta.verticalRate as number) ?? 0,
    origin: meta.origin as string | undefined,
    destination: meta.destination as string | undefined,
  }
}

export class AircraftPlugin implements EarthEnginePlugin {
  id = 'aircraft'
  name = 'Aircraft (ADS-B)'
  category = 'live' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private worldOverlay: WorldOverlay | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private show = true
  private knownIcao = new Set<string>()
  private unsubscribe: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private deadReckonTimer: ReturnType<typeof setInterval> | null = null
  private aircraft = new Map<string, { feature: AircraftFeature; lastUpdate: number }>()

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.worldOverlay = ctx.worldOverlay ?? null
    this.dataSource = new Cesium.CustomDataSource('aircraft')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    // Subscribe to aircraft updates (push-based)
    const handler = (update: LiveUpdate) => {
      if (update.type === 'full' && update.features) {
        const aircraft = update.features.map(toAircraftFeature).filter((f): f is AircraftFeature => f !== null)
        this.handleFullUpdate(aircraft)
      } else if (update.type === 'delta') {
        const added = (update.added || []).map(toAircraftFeature).filter((f): f is AircraftFeature => f !== null)
        const removed = (update.removed || []).map((f) => f.id.replace(/^aircraft:/, ''))
        this.handleDeltaUpdate(added, removed)
      }
    }

    const off = (ctx.ipc as any).on?.('aircraft:update', handler)
    this.unsubscribe = off ? () => off() : null

    // Request initial aircraft data immediately (don't wait for next poll)
    try {
      const features = await ctx.ipc.invoke('live:aircraft', {}) as LiveFeature[] | null
      if (features && features.length > 0) {
        const aircraft = features.map(toAircraftFeature).filter((f): f is AircraftFeature => f !== null)
        this.handleFullUpdate(aircraft)
      }
    } catch (err) {
      console.warn('[aircraft] initial fetch failed:', err)
    }

    if (!this.unsubscribe) {
      this.startPolling()
    }

    // Dead reckoning at 10Hz for smooth motion
    this.deadReckonTimer = setInterval(() => this.deadReckon(), 100)
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
    if (this.deadReckonTimer) {
      clearInterval(this.deadReckonTimer)
      this.deadReckonTimer = null
    }
    if (this.worldOverlay) {
      this.worldOverlay.clearCategory('aircraft')
    }
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.worldOverlay = null
    this.knownIcao.clear()
    this.aircraft.clear()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {
    // Aircraft are push-driven
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

  private startPolling(): void {
    // Initial fetch immediately
    this.fetchAircraft()
    this.pollTimer = setInterval(() => this.fetchAircraft(), 10_000)
  }

  private async fetchAircraft(): Promise<void> {
    try {
      const features = await window.api.invoke('live:aircraft', {}) as LiveFeature[] | null
      if (features) {
        const aircraft = features.map(toAircraftFeature).filter((f): f is AircraftFeature => f !== null)
        this.handleFullUpdate(aircraft)
      }
    } catch (err) {
      this.status = { ...this.status, status: 'stale', error: String(err) }
    }
  }

  private handleFullUpdate(features: AircraftFeature[]): void {
    if (!this.dataSource) return

    // Delta update: remove stale, update existing, add new
    const newIcao = new Set(features.map((f) => f.icao24))
    const toRemove: string[] = []
    for (const icao of this.knownIcao) {
      if (!newIcao.has(icao)) toRemove.push(icao)
    }
    for (const icao of toRemove) {
      this.dataSource.entities.removeById(`aircraft:${icao}`)
      this.worldOverlay?.removeCard(`aircraft:${icao}`)
      this.knownIcao.delete(icao)
      this.aircraft.delete(icao)
    }

    for (const f of features) {
      this.aircraft.set(f.icao24, { feature: f, lastUpdate: Date.now() })
      this.updateAircraftEntity(f)
      this.knownIcao.add(f.icao24)
    }

    this.status = { count: features.length, status: 'nominal' }
  }

  private handleDeltaUpdate(added: AircraftFeature[], removed: string[]): void {
    if (!this.dataSource) return

    for (const icao of removed) {
      this.dataSource.entities.removeById(`aircraft:${icao}`)
      this.worldOverlay?.removeCard(`aircraft:${icao}`)
      this.knownIcao.delete(icao)
      this.aircraft.delete(icao)
    }

    for (const f of added) {
      this.aircraft.set(f.icao24, { feature: f, lastUpdate: Date.now() })
      this.updateAircraftEntity(f)
      this.knownIcao.add(f.icao24)
    }

    this.status = { count: this.knownIcao.size, status: 'nominal' }
  }

  private updateAircraftEntity(f: AircraftFeature): void {
    if (!this.dataSource) return

    const position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.altitude)
    const existing = this.dataSource.entities.getById(`aircraft:${f.icao24}`)

    if (!existing) {
      this.dataSource.entities.add({
        id: `aircraft:${f.icao24}`,
        position: new Cesium.ConstantPositionProperty(position),
        point: {
          pixelSize: 5,
          color: Cesium.Color.fromBytes(255, 234, 74, 255),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
          outlineWidth: 1,
        },
        // No label here — managed by WorldOverlay for collision
        properties: {
          velocity: f.velocity,
          heading: f.heading,
          altitude: f.altitude,
          origin: f.origin,
          destination: f.destination,
        },
      } as any)
    } else {
      (existing.position as Cesium.ConstantPositionProperty).setValue(position)
      if (existing.properties) {
        existing.properties.velocity = f.velocity
        existing.properties.heading = f.heading
        existing.properties.altitude = f.altitude
      }
    }

    // Register card through shared WorldOverlay (collision-managed)
    if (this.worldOverlay) {
      const speedKt = Math.round(f.velocity * 1.94384)
      const altKm = (f.altitude / 1000).toFixed(1)
      this.worldOverlay.registerCard({
        id: `aircraft:${f.icao24}`,
        lat: f.lat,
        lon: f.lon,
        height: f.altitude,
        title: f.callsign.trim() || f.icao24.toUpperCase(),
        subtitle: `${altKm}km • ${speedKt}kt • ${Math.round(f.heading)}°`,
        category: 'aircraft',
        priority: 7,
        color: '#ffea4a',
      })
    }
  }

  private deadReckon(): void {
    if (!this.dataSource) return
    const now = Date.now()

    for (const [icao, { feature, lastUpdate }] of this.aircraft) {
      const dt = (now - lastUpdate) / 1000 // seconds
      if (dt < 0.1) continue

      // Extrapolate position based on velocity and heading
      const distance = feature.velocity * dt // meters
      const bearingRad = Cesium.Math.toRadians(feature.heading)

      // Simple equirectangular projection for small distances
      const latRad = Cesium.Math.toRadians(feature.lat)
      const lonRad = Cesium.Math.toRadians(feature.lon)
      const R = 6371000 // Earth radius in meters
      const newLatRad = latRad + (distance * Math.cos(bearingRad)) / R
      const newLonRad = lonRad + (distance * Math.sin(bearingRad)) / (R * Math.cos(latRad))

      const newLon = Cesium.Math.toDegrees(newLonRad)
      const newLat = Cesium.Math.toDegrees(newLatRad)
      const newAlt = feature.altitude + feature.verticalRate * dt

      const entity = this.dataSource.entities.getById(`aircraft:${icao}`)
      if (entity) {
        const position = Cesium.Cartesian3.fromDegrees(newLon, newLat, Math.max(0, newAlt))
        ;(entity.position as Cesium.ConstantPositionProperty).setValue(position)
      }
    }
  }
}

export const aircraftPlugin = new AircraftPlugin()
