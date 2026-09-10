/* Cross-domain influence: weather events → grid risk alerts.
 * Ported from OGOS weatherGridInfluence.ts. Uses Storm from @shared/types. */

import type { Storm } from '@shared/types'
import {
  type InternalGridAsset,
  type AssetMeasurement,
  type InternalGridAlert,
  type GridAlertType,
  type InternalSeverity,
  distanceKm,
} from './grid-data'

export interface WeatherEvent {
  type: 'storm' | 'lightning_cluster' | 'severe_weather'
  name: string
  lat: number
  lon: number
  severity: InternalSeverity
  radiusKm: number
  windSpeedKt?: number
  pressureMB?: number
  lightningDensity?: number
  classification?: string
}

/** Minimal lightning strike shape for clustering. */
export interface LightningStrikeInput {
  lat: number
  lon: number
  timestamp: number
}

/** Convert storms to weather events. */
export function stormsToWeatherEvents(storms: Storm[]): WeatherEvent[] {
  return storms.map((storm) => {
    const wind = storm.windSpeedKt ?? 0
    let severity: WeatherEvent['severity'] = 'info'
    let radiusKm = 200

    if (wind >= 96) {
      severity = 'critical'
      radiusKm = 500
    } else if (wind >= 64) {
      severity = 'warning'
      radiusKm = 350
    } else if (wind >= 34) {
      severity = 'warning'
      radiusKm = 250
    } else {
      severity = 'info'
      radiusKm = 150
    }

    return {
      type: 'storm' as const,
      name: storm.name,
      lat: storm.lat,
      lon: storm.lon,
      severity,
      radiusKm,
      windSpeedKt: wind,
      pressureMB: storm.pressureMB,
      classification: storm.classification,
    }
  })
}

/** Convert lightning strikes to clustered weather events. */
export function lightningToWeatherEvents(strikes: LightningStrikeInput[]): WeatherEvent[] {
  const now = Date.now()
  const recent = strikes.filter((s) => now - s.timestamp < 10 * 60 * 1000)
  if (recent.length < 10) return []

  const cells = new Map<string, { lat: number; lon: number; count: number }>()
  for (const s of recent) {
    const key = `${Math.floor(s.lat)},${Math.floor(s.lon)}`
    const existing = cells.get(key)
    if (existing) {
      existing.count++
    } else {
      cells.set(key, { lat: s.lat, lon: s.lon, count: 1 })
    }
  }

  const events: WeatherEvent[] = []
  for (const cell of cells.values()) {
    if (cell.count < 10) continue
    const density = cell.count / 10
    const severity: WeatherEvent['severity'] = density > 50 ? 'critical' : density > 20 ? 'warning' : 'info'
    events.push({
      type: 'lightning_cluster',
      name: `Lightning cluster (${cell.count} strikes)`,
      lat: cell.lat,
      lon: cell.lon,
      severity,
      radiusKm: density > 50 ? 100 : 50,
      lightningDensity: density,
    })
  }
  return events
}

/** Generate grid risk alerts from weather events + grid assets. */
export function generateWeatherGridAlerts(
  events: WeatherEvent[],
  assets: InternalGridAsset[],
  measurements: Map<string, AssetMeasurement>,
): InternalGridAlert[] {
  const alerts: InternalGridAlert[] = []
  const now = Date.now()

  for (const event of events) {
    for (const asset of assets) {
      const dist = distanceKm(event.lat, event.lon, asset.lat, asset.lon)
      if (dist > event.radiusKm) continue
      if (!asset.active) continue

      const proximityFactor = 1 - dist / event.radiusKm
      let alertSeverity: InternalSeverity = 'info'

      if (event.severity === 'critical') {
        alertSeverity = proximityFactor > 0.5 ? 'critical' : 'warning'
      } else if (event.severity === 'warning') {
        alertSeverity = proximityFactor > 0.7 ? 'warning' : 'info'
      } else {
        alertSeverity = 'info'
      }

      let message = ''
      let alertType: GridAlertType = 'regional_anomaly'

      if (event.type === 'storm') {
        const windStr = event.windSpeedKt ? `${event.windSpeedKt}kt winds` : 'high winds'
        const classStr = event.classification ? `${event.classification} ` : ''
        const distStr = dist < 50 ? 'directly overhead' : `${dist.toFixed(0)}km away`

        if (asset.type === 'power_plant' || asset.type === 'renewable_farm') {
          message = `${classStr}${event.name} (${windStr}) ${distStr} — risk of generation disruption`
          alertType = 'capacity_exceeded'
        } else if (asset.type === 'substation' || asset.type === 'transformer') {
          message = `${classStr}${event.name} (${windStr}) ${distStr} — risk of infrastructure damage`
          alertType = 'interconnect_failure'
        } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
          message = `${classStr}${event.name} (${windStr}) ${distStr} — risk of power outage to facility`
          alertType = 'pipeline_error'
        } else if (asset.type === 'battery_storage') {
          message = `${classStr}${event.name} (${windStr}) ${distStr} — risk of thermal stress on storage`
          alertType = 'thermal_stress'
        } else {
          message = `${classStr}${event.name} (${windStr}) ${distStr}`
        }
      } else if (event.type === 'lightning_cluster') {
        const densityStr = event.lightningDensity ? `${event.lightningDensity.toFixed(0)}/min` : 'high'
        if (asset.type === 'power_plant' || asset.type === 'substation' || asset.type === 'transformer') {
          message = `Lightning cluster (${densityStr}) ${dist.toFixed(0)}km away — risk of transient overvoltage`
          alertType = 'interconnect_failure'
        } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
          message = `Lightning cluster (${densityStr}) ${dist.toFixed(0)}km away — risk of power quality event`
          alertType = 'pipeline_error'
        } else {
          message = `Lightning cluster (${densityStr}) ${dist.toFixed(0)}km away`
        }
      } else if (event.type === 'severe_weather') {
        message = `Severe weather ${dist.toFixed(0)}km away — monitor for impact`
      }

      if (!message) continue

      alerts.push({
        id: `wx-${event.type}-${event.name}-${asset.id}-${now}`,
        timestamp: now,
        type: alertType,
        assetId: asset.id,
        assetName: asset.name,
        source: asset.source,
        lat: asset.lat,
        lon: asset.lon,
        message,
        severity: alertSeverity,
        weatherCorrelated: true,
      })
    }
  }

  return alerts
}
