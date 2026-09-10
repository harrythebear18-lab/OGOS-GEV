/**
 * Climate Monitor — ported from OGOS climateMonitor.ts.
 *
 * Main orchestrator that polls all climate / ocean / weather data sources every
 * 4 minutes, calls fetchers in parallel, and broadcasts updates via IPC:
 *   - CLIMATE_UPDATE        — stations + measurements + stats
 *   - CLIMATE_INTEGRITY     — integrity summary with storms, space weather, etc.
 *   - CLIMATE_TRAFFIC       — traffic data point (station counts, freshness)
 *   - STORM_UPDATE          — active storms
 *   - SPACE_WEATHER_UPDATE  — space weather conditions
 *
 * Supports viewport culling via CLIMATE_SET_VIEWPORT to reduce IPC payload
 * for viewport-bound data (vessels, aircraft, fires).
 *
 * Reuses existing live data feeds from ../live/ for lightning, aircraft,
 * vessels, fires, and earthquakes — no duplication.
 */

import { IPC } from '@shared/ipc'
import type {
  ClimateStation,
  ClimateMeasurement,
  ClimateStats,
  ClimateUpdate,
  IntegrityUpdate,
  Storm,
  SpaceWeather,
  LiveFeature,
} from '@shared/types'
import { broadcastToWindows } from '../../windows'
import { ErddapFetcher, type FetchResult } from './erddap-fetcher'
import { WeatherFetcher } from './weather-fetcher'
import { StormFetcher } from './storm-fetcher'
import { SpaceWeatherFetcher } from './space-weather-fetcher'
import { getLightningFeatures } from '../live/lightning'
import { getAircraftFeatures } from '../live/aircraft'
import { getVesselFeatures } from '../live/vessels'
import { getFireFeatures } from '../live/fires'
import { ensureBathymetryGrid } from './bathymetry-cache'

import type { PredictionEngine } from '../prediction/prediction-engine'

const POLL_INTERVAL_MS = 4 * 60 * 1000 // 4 minutes
const STALE_DATA_MS = 2 * 60 * 60 * 1000 // 2 hours

const USGS_QUAKES_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'

interface ViewportBounds {
  n: number
  s: number
  e: number
  w: number
}

class ClimateMonitor {
  private stations: ClimateStation[] = []
  private measurements: Record<string, ClimateMeasurement> = {}
  private intervalId: NodeJS.Timeout | null = null
  private fetchInProgress = false
  private viewportBounds: ViewportBounds | null = null

  private lastStorms: Storm[] = []
  private lastSpaceWeather: SpaceWeather | null = null
  private lastLightning: LiveFeature[] = []
  private lastAircraft: LiveFeature[] = []
  private lastEarthquakes: unknown[] = []
  private predictionEngine: PredictionEngine | null = null
  private whitelistedStations = new Set<string>()

  start(): void {
    console.log('[climate/monitor] start() — polling every 4 minutes')
    // Preload the global bathymetry grid in the background (non-blocking)
    ensureBathymetryGrid().catch((e) => console.warn('[climate/monitor] bathymetry preload failed:', e))
    this.fetchAll()
    this.intervalId = setInterval(() => this.fetchAll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    console.log('[climate/monitor] stop()')
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  getPendingCount(): number {
    return this.fetchInProgress ? 1 : 0
  }

  getStations(): ClimateStation[] {
    return this.stations
  }

  getMeasurements(): Record<string, ClimateMeasurement> {
    return this.measurements
  }

  getStorms(): Storm[] {
    return this.lastStorms
  }

  getSpaceWeather(): SpaceWeather | null {
    return this.lastSpaceWeather
  }

  getLightning(): LiveFeature[] {
    return this.lastLightning
  }

  getAircraft(): LiveFeature[] {
    return this.lastAircraft
  }

  getEarthquakes(): unknown[] {
    return this.lastEarthquakes
  }

  setPredictionEngine(engine: PredictionEngine): void {
    this.predictionEngine = engine
  }

  whitelistStation(stationId: string): void {
    this.whitelistedStations.add(stationId)
  }

  unwhitelistStation(stationId: string): void {
    this.whitelistedStations.delete(stationId)
  }

  /** Set viewport bounds for IPC culling (called from CLIMATE_SET_VIEWPORT handler) */
  setViewportBounds(bounds: ViewportBounds | null): void {
    this.viewportBounds = bounds
  }

  /** Cull an array of lat/lon objects to the current viewport (with padding) */
  private cullToViewport<T extends { lat: number; lon: number }>(items: T[], padDeg = 10): T[] {
    if (!this.viewportBounds) return items
    const { n, s, e, w } = this.viewportBounds
    const south = s - padDeg
    const north = n + padDeg
    const west = w - padDeg
    const east = e + padDeg
    if (north - south > 170) return items
    return items.filter((item) => {
      if (item.lat < south || item.lat > north) return false
      if (west < -180 && east > 180) return true
      if (west < -180) return item.lon >= west + 360 || item.lon <= east
      if (east > 180) return item.lon >= west || item.lon <= east - 360
      return item.lon >= west && item.lon <= east
    })
  }

  private async fetchAll(): Promise<void> {
    if (this.fetchInProgress) return
    this.fetchInProgress = true

    try {
      // ── Fetch all ERDDAP + METAR sources in parallel ──
      const sourceFetches: Promise<FetchResult>[] = [
        ErddapFetcher.fetchNDBC(),
        ErddapFetcher.fetchTAO(),
        ErddapFetcher.fetchTAOCurrents(),
        ErddapFetcher.fetchTAOSalinity(),
        ErddapFetcher.fetchGTSPP(),
        ErddapFetcher.fetchArgo(),
        ErddapFetcher.fetchCO2(),
        WeatherFetcher.fetchNWS(),
      ]

      const results = await Promise.allSettled(sourceFetches)

      const allStations: ClimateStation[] = []
      const allMeasurements: Record<string, ClimateMeasurement> = {}

      for (const r of results) {
        if (r.status === 'fulfilled') {
          allStations.push(...r.value.stations)
          Object.assign(allMeasurements, r.value.measurements)
        }
      }

      // ── Fetch storms, space weather, and live feeds in parallel ──
      const [stormsResult, spaceWeatherResult, lightning, aircraft, vessels, fires, earthquakes] =
        await Promise.allSettled([
          StormFetcher.fetchActiveStorms(),
          SpaceWeatherFetcher.fetch(),
          getLightningFeatures(),
          getAircraftFeatures(),
          getVesselFeatures(),
          getFireFeatures(),
          this.fetchEarthquakes(),
        ])

      const storms = stormsResult.status === 'fulfilled' ? stormsResult.value : []
      const spaceWeather = spaceWeatherResult.status === 'fulfilled' ? spaceWeatherResult.value : null
      const lightningFeatures = lightning.status === 'fulfilled' ? lightning.value : []
      const aircraftFeatures = aircraft.status === 'fulfilled' ? aircraft.value : []
      const vesselFeatures = vessels.status === 'fulfilled' ? vessels.value : []
      const fireFeatures = fires.status === 'fulfilled' ? fires.value : []
      const quakeFeatures = earthquakes.status === 'fulfilled' ? earthquakes.value : []

      this.stations = allStations
      this.measurements = allMeasurements
      this.lastStorms = storms
      this.lastSpaceWeather = spaceWeather
      this.lastLightning = lightningFeatures as LiveFeature[]
      this.lastAircraft = aircraftFeatures as LiveFeature[]
      this.lastEarthquakes = quakeFeatures

      // ── Feed data to prediction engine ──
      if (this.predictionEngine) {
        const measurementsMap = new Map(Object.entries(allMeasurements))
        const lightningSimple = (lightningFeatures as LiveFeature[]).map((f) => ({
          lat: f.position.lat,
          lon: f.position.lon,
          timestamp: f.freshness,
        }))
        this.predictionEngine.updateClimateData(
          allStations,
          measurementsMap,
          storms,
          new Map(),
          lightningSimple,
        )
      }

      // ── Compute stats ──
      const stats = this.computeStats(allStations, allMeasurements)

      // ── Broadcast CLIMATE_UPDATE ──
      const update: ClimateUpdate = {
        stations: allStations,
        measurements: allMeasurements,
        stats,
        timestamp: Date.now(),
      }
      broadcastToWindows(IPC.CLIMATE_UPDATE, update)

      // ── Broadcast CLIMATE_TRAFFIC ──
      broadcastToWindows(IPC.CLIMATE_TRAFFIC, {
        timestamp: Date.now(),
        totalStations: allStations.length,
        activeStations: allStations.filter((s) => s.active).length,
        newMeasurements: Object.keys(allMeasurements).length,
        avgWaterTemp: 0, // simplified — no regional averaging in this port
        avgCO2: 0,
        integrityScore: 0,
        sensorsVerified: 0,
        sensorsFlagged: 0,
      })

      // ── Broadcast STORM_UPDATE ──
      broadcastToWindows(IPC.STORM_UPDATE, storms)

      // ── Broadcast SPACE_WEATHER_UPDATE ──
      if (spaceWeather) {
        broadcastToWindows(IPC.SPACE_WEATHER_UPDATE, spaceWeather)
      }

      // ── Compute simplified integrity and broadcast CLIMATE_INTEGRITY ──
      const integrity = this.computeIntegrity(
        allStations,
        allMeasurements,
        storms,
        spaceWeather,
        lightningFeatures,
        aircraftFeatures,
        vesselFeatures,
        fireFeatures,
        quakeFeatures,
      )
      broadcastToWindows(IPC.CLIMATE_INTEGRITY, integrity)

      console.log(
        `[climate/monitor] Cycle complete: ${allStations.length} stations, ` +
        `${Object.keys(allMeasurements).length} measurements, ${storms.length} storms, ` +
        `spaceWeather=${spaceWeather ? 'yes' : 'no'}`,
      )
    } catch (e) {
      console.error('[climate/monitor] fetchAll error:', e)
    } finally {
      this.fetchInProgress = false
    }
  }

  /** Compute ClimateStats from stations and measurements */
  private computeStats(
    stations: ClimateStation[],
    measurements: Record<string, ClimateMeasurement>,
  ): ClimateStats {
    const byType: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    let invalidated = 0

    for (const s of stations) {
      byType[s.type] = (byType[s.type] ?? 0) + 1
      bySource[s.source] = (bySource[s.source] ?? 0) + 1
      if (s.invalidated) invalidated++
    }

    return {
      totalStations: stations.length,
      activeStations: stations.filter((s) => s.active).length,
      invalidatedStations: invalidated,
      byType,
      bySource,
    }
  }

  /** Compute a simplified IntegrityUpdate */
  private computeIntegrity(
    stations: ClimateStation[],
    measurements: Record<string, ClimateMeasurement>,
    storms: Storm[],
    spaceWeather: SpaceWeather | null,
    lightning: unknown[],
    aircraft: unknown[],
    vessels: unknown[],
    wildfires: unknown[],
    earthquakes: unknown[],
  ): IntegrityUpdate {
    const now = Date.now()
    let totalChecks = 0
    let passed = 0
    let warnings = 0
    let failed = 0

    // Check each station for data freshness
    for (const s of stations) {
      totalChecks++
      const m = measurements[s.id]
      if (!m) {
        failed++
        continue
      }
      const age = now - m.timestamp
      if (age < STALE_DATA_MS) {
        passed++
      } else if (age < 24 * 60 * 60 * 1000) {
        warnings++
      } else {
        failed++
      }
    }

    const avgIntegrityScore = totalChecks > 0 ? passed / totalChecks : 0

    return {
      sensorHealth: [],
      dataFlowHealth: [],
      crossVerifications: [],
      summary: {
        totalChecks,
        passed,
        warnings,
        failed,
        avgIntegrityScore,
      },
      storms,
      lightningStrikes: lightning,
      // Live feeds already cap at 500 items each — no viewport culling needed
      vessels,
      aircraft,
      earthquakes,
      spaceWeather,
      wildfires,
      timestamp: now,
    }
  }

  /** Fetch recent earthquakes from USGS (M≥2.5, past day) */
  private async fetchEarthquakes(): Promise<unknown[]> {
    try {
      const res = await fetch(USGS_QUAKES_URL, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.features || !Array.isArray(data.features)) return []

      const quakes = data.features.map((f: any) => ({
        id: f.id,
        mag: f.properties?.mag ?? 0,
        place: f.properties?.place ?? 'Unknown',
        lat: f.geometry?.coordinates?.[1] ?? 0,
        lon: f.geometry?.coordinates?.[0] ?? 0,
        depth: f.geometry?.coordinates?.[2] ?? 0,
        time: f.properties?.time ?? Date.now(),
        url: f.properties?.url ?? '',
        tsunami: f.properties?.tsunami === 1,
      }))
      quakes.sort((a: any, b: any) => b.mag - a.mag)
      console.log(`[climate/monitor] Earthquakes: ${quakes.length} (M≥2.5)`)
      return quakes
    } catch (e) {
      console.warn('[climate/monitor] Earthquake fetch failed:', e)
      return []
    }
  }
}

// Singleton export — matches the live-data.ts pattern
export const climateMonitor = new ClimateMonitor()
