/* Cross-domain influence: weather events → aircraft risk alerts.
 * Ported from OGOS weatherAircraftInfluence.ts.
 * Aircraft flying through or near storm cells, lightning clusters, or severe
 * weather face turbulence, icing, and convective risk. */

import { type WeatherEvent } from './weather-grid-influence'

/** Minimal aircraft shape for weather-aircraft influence. */
export interface AircraftInput {
  icao24: string
  callsign: string
  lat: number
  lon: number
  altitudeFt?: number
  onGround?: boolean
}

export interface AircraftWeatherAlert {
  id: string
  timestamp: number
  icao24: string
  callsign: string
  lat: number
  lon: number
  altitudeFt?: number
  weatherType: 'storm' | 'lightning_cluster' | 'severe_weather'
  weatherName: string
  distanceKm: number
  severity: 'info' | 'warning' | 'critical'
  message: string
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Generate aircraft weather risk alerts. */
export function generateWeatherAircraftAlerts(
  events: WeatherEvent[],
  aircraft: AircraftInput[],
): AircraftWeatherAlert[] {
  const alerts: AircraftWeatherAlert[] = []
  const now = Date.now()

  const airborne = aircraft.filter((a) => !a.onGround)
  const aircraftToCheck = airborne.length > 5000 ? airborne.slice(0, 5000) : airborne

  for (const event of events) {
    for (const ac of aircraftToCheck) {
      const dist = distanceKm(event.lat, event.lon, ac.lat, ac.lon)
      if (dist > event.radiusKm) continue

      const altFt = ac.altitudeFt ?? 0
      const inStormLayer = altFt < 50000

      if (!inStormLayer && event.type !== 'severe_weather') continue

      const proximityFactor = 1 - dist / event.radiusKm
      let severity: AircraftWeatherAlert['severity'] = 'info'

      if (event.severity === 'critical') {
        severity = proximityFactor > 0.3 ? 'critical' : 'warning'
      } else if (event.severity === 'warning') {
        severity = proximityFactor > 0.5 ? 'warning' : 'info'
      }

      let message = ''
      if (event.type === 'storm') {
        const windStr = event.windSpeedKt ? `${event.windSpeedKt}kt winds` : 'high winds'
        message = `${event.name} (${windStr}) ${dist.toFixed(0)}km away — turbulence, convective risk`
      } else if (event.type === 'lightning_cluster') {
        const densityStr = event.lightningDensity ? `${event.lightningDensity.toFixed(0)}/min` : 'high'
        message = `Lightning cluster (${densityStr}) ${dist.toFixed(0)}km away — convective turbulence, icing risk`
      } else {
        message = `Severe weather ${dist.toFixed(0)}km away — monitor for impact`
      }

      alerts.push({
        id: `acwx-${event.type}-${ac.icao24}-${now}`,
        timestamp: now,
        icao24: ac.icao24,
        callsign: ac.callsign,
        lat: ac.lat,
        lon: ac.lon,
        altitudeFt: ac.altitudeFt,
        weatherType: event.type,
        weatherName: event.name,
        distanceKm: dist,
        severity,
        message,
      })
    }
  }

  return alerts.slice(0, 500)
}
