/**
 * HeuristicWatchdog — ported from OGOS climate/heuristicWatchdog.ts.
 *
 * Detects sensor heuristics: stuck sensors, cluster/regional outliers,
 * data uniformity, field correlation, and field-count regression.
 * Mutates existing CrossVerification objects in place by appending flags.
 */

import type {
  ClimateStation,
  ClimateMeasurement,
  CrossVerification,
  VerificationFlag,
  ClimateAlert,
} from '@shared/types'

const STUCK_VALUE_THRESHOLD = 0.01
const STUCK_MIN_REPEATS = 3
const CLUSTER_RADIUS_KM = 300
const CLUSTER_MIN_SIZE = 3
const CLUSTER_OUTLIER_FACTOR = 2.5
const REGIONAL_BAND_DEGREES = 10
const REGIONAL_MIN_SAMPLES = 5
const REGIONAL_OUTLIER_FACTOR = 3.0
const UNIFORMITY_THRESHOLD = 0.1
const UNIFORMITY_MIN_STATIONS = 50
const AIR_WATER_TEMP_MAX_DELTA = 35

interface StationHistory {
  stationId: string
  waterTempReadings: number[]
  fieldCounts: number[]
  lastFieldCount: number
}

export class HeuristicWatchdog {
  private history = new Map<string, StationHistory>()
  private onAlert: (alert: ClimateAlert) => void

  constructor(onAlert: (alert: ClimateAlert) => void) {
    this.onAlert = onAlert
  }

  verify(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    existingVerifications: CrossVerification[],
  ): VerificationFlag[] {
    const allFlags: VerificationFlag[] = []
    const verMap = new Map(existingVerifications.map((v) => [v.stationId, v]))

    const flagsByStation = new Map<string, VerificationFlag[]>()

    const addFlags = (stationId: string, newFlags: VerificationFlag[]) => {
      allFlags.push(...newFlags)
      const existing = flagsByStation.get(stationId) ?? []
      existing.push(...newFlags)
      flagsByStation.set(stationId, existing)
    }

    for (const flag of this.checkStuckSensors(stations, measurements)) {
      const sid = this.findStationIdForFlag(flag, stations)
      if (sid) addFlags(sid, [flag])
    }

    for (const flag of this.checkClusterOutliers(stations, measurements)) {
      const sid = this.findStationIdForFlag(flag, stations)
      if (sid) addFlags(sid, [flag])
    }

    for (const flag of this.checkRegionalAnomalies(stations, measurements)) {
      const sid = this.findStationIdForFlag(flag, stations)
      if (sid) addFlags(sid, [flag])
    }

    for (const flag of this.checkDataUniformity(stations, measurements)) {
      addFlags('global', [flag])
    }

    for (const flag of this.checkFieldCorrelation(stations, measurements)) {
      const sid = this.findStationIdForFlag(flag, stations)
      if (sid) addFlags(sid, [flag])
    }

    for (const flag of this.checkFieldCountRegression(stations, measurements)) {
      const sid = this.findStationIdForFlag(flag, stations)
      if (sid) addFlags(sid, [flag])
    }

    for (const [stationId, stationFlags] of flagsByStation) {
      const ver = verMap.get(stationId)
      if (!ver) continue

      for (const flag of stationFlags) {
        ver.flags.push(flag)
        if (flag.severity === 'critical') {
          ver.verificationScore = Math.max(0, ver.verificationScore - 25)
        } else if (flag.severity === 'warning') {
          ver.verificationScore = Math.max(0, ver.verificationScore - 10)
        }
        if (flag.severity === 'critical' && ver.status !== 'failed') {
          ver.status = 'failed'
        } else if (flag.severity === 'warning' && ver.status === 'verified') {
          ver.status = 'warning'
        }
      }
    }

    return allFlags
  }

  private findStationIdForFlag(
    flag: VerificationFlag,
    stations: ClimateStation[],
  ): string | null {
    for (const station of stations) {
      if (flag.message.startsWith(station.name + ':')) {
        return station.id
      }
    }
    return null
  }

  private checkStuckSensors(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): VerificationFlag[] {
    const flags: VerificationFlag[] = []

    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m || m.waterTemp === undefined) continue

      let hist = this.history.get(station.id)
      if (!hist) {
        hist = { stationId: station.id, waterTempReadings: [], fieldCounts: [], lastFieldCount: 0 }
        this.history.set(station.id, hist)
      }

      hist.waterTempReadings.push(m.waterTemp)
      if (hist.waterTempReadings.length > 10) hist.waterTempReadings.shift()

      if (hist.waterTempReadings.length >= STUCK_MIN_REPEATS) {
        const recent = hist.waterTempReadings.slice(-STUCK_MIN_REPEATS)
        const allSame = recent.every((v) => Math.abs(v - recent[0]) < STUCK_VALUE_THRESHOLD)
        if (allSame && recent[0] !== 0) {
          flags.push({
            type: 'stuck_sensor',
            severity: 'warning',
            message: `${station.name}: waterTemp stuck at ${recent[0].toFixed(2)}°C for ${STUCK_MIN_REPEATS} consecutive readings`,
            field: 'waterTemp',
          })
          this.fireAlert(
            station,
            'stuck_sensor',
            `waterTemp stuck at ${recent[0].toFixed(1)}°C for ${STUCK_MIN_REPEATS} readings`,
            'warning',
            'waterTemp',
          )
        }
      }
    }

    return flags
  }

  private checkClusterOutliers(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): VerificationFlag[] {
    const flags: VerificationFlag[] = []

    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m || m.waterTemp === undefined) continue

      if (station.source === 'PMEL_CO2' || station.source === 'ARGO' || station.source === 'BGC_ARGO')
        continue

      const neighbors: { temp: number; dist: number }[] = []
      for (const other of stations) {
        if (other.id === station.id) continue
        const om = measurements.get(other.id)
        if (!om || om.waterTemp === undefined) continue

        const dist = this.haversine(station.lat, station.lon, other.lat, other.lon)
        if (dist <= CLUSTER_RADIUS_KM) {
          neighbors.push({ temp: om.waterTemp, dist })
        }
      }

      if (neighbors.length < CLUSTER_MIN_SIZE) continue

      const temps = neighbors.map((n) => n.temp)
      const mean = temps.reduce((a, b) => a + b, 0) / temps.length
      const stdDev = Math.sqrt(temps.reduce((a, b) => a + (b - mean) ** 2, 0) / temps.length)

      if (stdDev > 0) {
        const zScore = Math.abs((m.waterTemp - mean) / stdDev)
        if (zScore > CLUSTER_OUTLIER_FACTOR) {
          const severity = zScore > CLUSTER_OUTLIER_FACTOR * 1.5 ? 'critical' : 'warning'
          flags.push({
            type: 'cluster_outlier',
            severity,
            message: `${station.name}: waterTemp=${m.waterTemp.toFixed(1)}°C is ${zScore.toFixed(1)}σ from ${neighbors.length}-station local cluster (mean=${mean.toFixed(1)}°C, σ=${stdDev.toFixed(1)}°C)`,
            field: 'waterTemp',
          })
          this.fireAlert(
            station,
            'cluster_outlier',
            `waterTemp ${zScore.toFixed(1)}σ from ${neighbors.length} nearby stations (mean=${mean.toFixed(1)}°C)`,
            severity,
            'waterTemp',
          )
        }
      }
    }

    return flags
  }

  private checkRegionalAnomalies(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): VerificationFlag[] {
    const flags: VerificationFlag[] = []

    const bands = new Map<string, { lat: number; temps: number[]; stations: ClimateStation[] }>()
    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m || m.waterTemp === undefined) continue

      const bandLat = Math.round(station.lat / REGIONAL_BAND_DEGREES) * REGIONAL_BAND_DEGREES
      const bandKey = `lat_${bandLat}`
      if (!bands.has(bandKey)) {
        bands.set(bandKey, { lat: bandLat, temps: [], stations: [] })
      }
      const band = bands.get(bandKey)!
      band.temps.push(m.waterTemp)
      band.stations.push(station)
    }

    for (const [bandKey, band] of bands) {
      if (band.temps.length < REGIONAL_MIN_SAMPLES) continue

      const mean = band.temps.reduce((a, b) => a + b, 0) / band.temps.length
      const stdDev = Math.sqrt(band.temps.reduce((a, b) => a + (b - mean) ** 2, 0) / band.temps.length)

      if (stdDev < 0.1) continue

      for (let i = 0; i < band.stations.length; i++) {
        const station = band.stations[i]
        const temp = band.temps[i]
        const zScore = Math.abs((temp - mean) / stdDev)

        if (zScore > REGIONAL_OUTLIER_FACTOR) {
          const severity = zScore > REGIONAL_OUTLIER_FACTOR * 1.5 ? 'critical' : 'warning'
          flags.push({
            type: 'regional_anomaly',
            severity,
            message: `${station.name}: waterTemp=${temp.toFixed(1)}°C is ${zScore.toFixed(1)}σ from ${bandKey} regional baseline (mean=${mean.toFixed(1)}°C, σ=${stdDev.toFixed(1)}°C, n=${band.temps.length})`,
            field: 'waterTemp',
          })
          this.fireAlert(
            station,
            'regional_anomaly',
            `waterTemp ${zScore.toFixed(1)}σ from regional baseline (lat band ${band.lat}°, n=${band.temps.length})`,
            severity,
            'waterTemp',
          )
        }
      }
    }

    return flags
  }

  private checkDataUniformity(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): VerificationFlag[] {
    const flags: VerificationFlag[] = []

    const temps: number[] = []
    for (const station of stations) {
      const m = measurements.get(station.id)
      if (m?.waterTemp !== undefined) temps.push(m.waterTemp)
    }

    if (temps.length < UNIFORMITY_MIN_STATIONS) return flags

    const mean = temps.reduce((a, b) => a + b, 0) / temps.length
    const stdDev = Math.sqrt(temps.reduce((a, b) => a + (b - mean) ** 2, 0) / temps.length)
    const cv = stdDev / Math.abs(mean)

    if (cv < UNIFORMITY_THRESHOLD && temps.length > 100) {
      flags.push({
        type: 'data_uniformity',
        severity: 'warning',
        message: `Global waterTemp uniformity suspicious: CV=${cv.toFixed(3)} across ${temps.length} stations (mean=${mean.toFixed(1)}°C, σ=${stdDev.toFixed(1)}°C) — possible pipeline issue or data echo`,
      })
      const dummyStation: ClimateStation = {
        id: 'global',
        name: 'Global Pipeline',
        type: 'buoy',
        source: 'NOAA_NDBC',
        lat: 0,
        lon: 0,
        lastUpdate: Date.now(),
        active: true,
      }
      this.fireAlert(
        dummyStation,
        'data_uniformity',
        `Global waterTemp CV=${cv.toFixed(3)} across ${temps.length} stations — suspicious uniformity`,
        'warning',
        'waterTemp',
      )
    }

    return flags
  }

  private checkFieldCorrelation(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): VerificationFlag[] {
    const flags: VerificationFlag[] = []

    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m) continue
      if (m.waterTemp === undefined || m.airTemp === undefined) continue

      const delta = Math.abs(m.waterTemp - m.airTemp)
      if (delta > AIR_WATER_TEMP_MAX_DELTA) {
        flags.push({
          type: 'field_correlation',
          severity: 'warning',
          message: `${station.name}: waterTemp=${m.waterTemp.toFixed(1)}°C vs airTemp=${m.airTemp.toFixed(1)}°C — Δ${delta.toFixed(1)}°C exceeds expected correlation (max ${AIR_WATER_TEMP_MAX_DELTA}°C)`,
          field: 'waterTemp',
        })
        this.fireAlert(
          station,
          'field_correlation',
          `waterTemp/airTemp Δ=${delta.toFixed(1)}°C breaks expected correlation`,
          'warning',
          'waterTemp',
        )
      }
    }

    return flags
  }

  private checkFieldCountRegression(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): VerificationFlag[] {
    const flags: VerificationFlag[] = []

    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m) continue

      const fields = [
        'waterTemp', 'airTemp', 'windSpeed', 'windDir', 'waveHeight',
        'wavePeriod', 'pressure', 'salinity', 'currentSpeed', 'currentDir', 'depth',
      ]
      const count = fields.filter((f) => (m as any)[f] !== undefined).length

      let hist = this.history.get(station.id)
      if (!hist) {
        hist = { stationId: station.id, waterTempReadings: [], fieldCounts: [], lastFieldCount: 0 }
        this.history.set(station.id, hist)
      }

      if (hist.lastFieldCount > 0 && count > 0 && count < hist.lastFieldCount - 2) {
        flags.push({
          type: 'data_gap',
          severity: 'warning',
          message: `${station.name}: field count dropped from ${hist.lastFieldCount} to ${count} — possible sensor degradation`,
        })
        this.fireAlert(
          station,
          'data_gap',
          `Reporting fields dropped from ${hist.lastFieldCount} to ${count}`,
          'warning',
        )
      }

      hist.lastFieldCount = count
      hist.fieldCounts.push(count)
      if (hist.fieldCounts.length > 20) hist.fieldCounts.shift()
    }

    return flags
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  private fireAlert(
    station: ClimateStation,
    type: ClimateAlert['type'],
    message: string,
    severity: ClimateAlert['severity'],
    field?: string,
  ) {
    this.onAlert({
      id: `watchdog_${type}_${station.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type,
      stationId: station.id,
      stationName: station.name,
      source: station.source,
      lat: station.lat,
      lon: station.lon,
      message,
      severity,
      field,
    })
  }
}
