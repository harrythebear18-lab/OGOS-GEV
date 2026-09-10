import { IPC } from '@shared/ipc'
import type { LiveFeature, LiveUpdate } from '@shared/types'
import { broadcastToWindows } from '../../windows'
import { getSatelliteFeatures } from './satellites'
import { getAircraftFeatures } from './aircraft'
import { getFireFeatures } from './fires'
import { getVesselFeatures } from './vessels'
import { getLightningFeatures, startLightningFeed } from './lightning'

const USGS_QUAKES_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'

interface QuakeProperties {
  mag: number
  place: string
  time: number
}

interface QuakeFeature {
  id: string
  geometry: {
    coordinates: [number, number, number]
  }
  properties: QuakeProperties
}

type FeedKey = 'quake' | 'satellite' | 'aircraft' | 'fire' | 'vessel' | 'lightning'

class LiveDataManager {
  private timers: NodeJS.Timeout[] = []
  private features: Map<FeedKey, LiveFeature[]> = new Map()
  private lastBroadcastIds: Set<string> = new Set()

  start(): void {
    console.log('[live-data] start() — all feeds')

    // Satellites — every 10s, first poll in 3s
    setTimeout(() => { console.log('[live-data] polling satellites'); this.pollSatellites() }, 3000)
    this.timers.push(setInterval(() => this.pollSatellites(), 10_000))

    // Aircraft — every 60s (OpenSky anonymous rate limit), first poll in 5s
    setTimeout(() => { console.log('[live-data] polling aircraft'); this.pollAircraft() }, 5000)
    this.timers.push(setInterval(() => this.pollAircraft(), 60_000))

    // Fires — every 5 min, first poll in 8s
    setTimeout(() => { console.log('[live-data] polling fires'); this.pollFires() }, 8000)
    this.timers.push(setInterval(() => this.pollFires(), 5 * 60_000))

    // Vessels — every 30s, first poll in 10s
    setTimeout(() => { console.log('[live-data] polling vessels'); this.pollVessels() }, 10000)
    this.timers.push(setInterval(() => this.pollVessels(), 30_000))

    // Lightning — WebSocket feed, start connection immediately
    startLightningFeed()
    setTimeout(() => { console.log('[live-data] polling lightning'); this.pollLightning() }, 12000)
    this.timers.push(setInterval(() => this.pollLightning(), 30_000))

    // Earthquakes — every 5 min, first poll in 6s
    setTimeout(() => { console.log('[live-data] polling earthquakes'); this.pollQuakes() }, 6000)
    this.timers.push(setInterval(() => this.pollQuakes(), 5 * 60_000))

    console.log('[live-data] all feed timers set')
  }

  stop(): void {
    console.log('[live-data] stop() — clearing timers')
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  private getAllFeatures(): LiveFeature[] {
    const all: LiveFeature[] = []
    for (const feats of this.features.values()) {
      all.push(...feats)
    }
    return all
  }

  private broadcastFull(): void {
    const update: LiveUpdate = {
      type: 'full',
      features: this.getAllFeatures(),
      source: 'live',
      timestamp: Date.now(),
    }
    broadcastToWindows(IPC.LIVE_UPDATE, update)
  }

  private broadcastDelta(key: FeedKey, features: LiveFeature[]): void {
    const currentIds = new Set(features.map((f) => f.id))
    const prevFeatures = this.features.get(key) ?? []
    const prevIds = new Set(prevFeatures.map((f) => f.id))

    const added = features.filter((f) => !prevIds.has(f.id))
    const removed = prevFeatures.filter((f) => !currentIds.has(f.id))

    this.features.set(key, features)

    console.log(`[live-data] ${key}: ${features.length} features (${added.length} added, ${removed.length} removed)`)

    // Always broadcast full update to per-feed channel
    const feedUpdate: LiveUpdate = {
      type: 'full',
      features,
      source: key,
      timestamp: Date.now(),
    }

    const feedChannel = this.getFeedChannel(key)
    if (feedChannel) {
      broadcastToWindows(feedChannel, feedUpdate)
    }

    // Also broadcast delta to general LIVE_UPDATE channel
    if (added.length === 0 && removed.length === 0) return

    const update: LiveUpdate = {
      type: 'delta',
      added,
      removed,
      source: key,
      timestamp: Date.now(),
    }
    broadcastToWindows(IPC.LIVE_UPDATE, update)
  }

  private getFeedChannel(key: FeedKey): string | null {
    switch (key) {
      case 'aircraft':   return IPC.AIRCRAFT_UPDATE
      case 'quake':      return IPC.EARTHQUAKE_UPDATE
      case 'fire':       return IPC.FIRE_UPDATE
      case 'vessel':     return IPC.VESSEL_UPDATE
      case 'lightning':  return IPC.LIGHTNING_UPDATE
      case 'satellite':  return IPC.LIVE_UPDATE
      default:           return null
    }
  }

  private async pollQuakes(): Promise<void> {
    try {
      const res = await fetch(USGS_QUAKES_URL, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { features: QuakeFeature[] }

      const features: LiveFeature[] = data.features.map((f) => ({
        id: `quake:${f.id}`,
        type: 'quake',
        position: {
          lon: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          height: f.geometry.coordinates[2] * 1000,
        },
        meta: {
          mag: f.properties.mag,
          place: f.properties.place,
          time: f.properties.time,
          color: '#f97316',
        },
        freshness: Date.now(),
      }))

      this.broadcastDelta('quake', features)
    } catch (err) {
      console.warn('[live-data] quake poll failed:', err)
    }
  }

  private async pollSatellites(): Promise<void> {
    try {
      const features = await getSatelliteFeatures()
      this.broadcastDelta('satellite', features)
    } catch (err) {
      console.warn('[live-data] satellite poll failed:', err)
    }
  }

  private async pollAircraft(): Promise<void> {
    try {
      const features = await getAircraftFeatures()
      this.broadcastDelta('aircraft', features)
    } catch (err) {
      console.warn('[live-data] aircraft poll failed:', err)
    }
  }

  private async pollFires(): Promise<void> {
    try {
      const features = await getFireFeatures()
      this.broadcastDelta('fire', features)
    } catch (err) {
      console.warn('[live-data] fire poll failed:', err)
    }
  }

  private async pollVessels(): Promise<void> {
    try {
      const features = await getVesselFeatures()
      this.broadcastDelta('vessel', features)
    } catch (err) {
      console.warn('[live-data] vessel poll failed:', err)
    }
  }

  private async pollLightning(): Promise<void> {
    try {
      const features = await getLightningFeatures()
      this.broadcastDelta('lightning', features)
    } catch (err) {
      console.warn('[live-data] lightning poll failed:', err)
    }
  }
}

export const liveData = new LiveDataManager()
