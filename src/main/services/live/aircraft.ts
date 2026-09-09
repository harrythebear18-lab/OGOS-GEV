/**
 * Aircraft feed — OpenSky Network public API.
 * Returns all current aircraft states (ICAO24, callsign, position, velocity).
 * No API key required for anonymous access (rate-limited).
 *
 * Endpoint: https://opensky-network.org/api/states/all
 */

import type { LiveFeature } from '@shared/types'

interface OpenSkyResponse {
  time: number
  states: any[][] | null
}

const OPENSKY_URL = 'https://opensky-network.org/api/states/all'

export async function getAircraftFeatures(): Promise<LiveFeature[]> {
  try {
    const res = await fetch(OPENSKY_URL, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as OpenSkyResponse
    if (!data.states) return []

    const features: LiveFeature[] = []
    const MAX_AIRCRAFT = 500
    for (const s of data.states) {
      if (features.length >= MAX_AIRCRAFT) break
      // OpenSky states array indices:
      // 0: icao24, 1: callsign, 5: lon, 6: lat, 7: baro_alt (m),
      // 9: velocity (m/s), 10: heading (deg)
      const icao24 = s[0] as string
      const callsign = (s[1] as string)?.trim() || icao24
      const lon = s[5] as number
      const lat = s[6] as number
      const alt = s[7] as number | null
      const velocity = s[9] as number | null
      const heading = s[10] as number | null

      if (lon == null || lat == null) continue

      features.push({
        id: `aircraft:${icao24}`,
        type: 'aircraft',
        position: { lon, lat, height: alt ?? 0 },
        velocity: velocity != null ? { speed: velocity, heading: heading ?? 0 } : undefined,
        meta: {
          callsign,
          icao24,
          altitude: alt,
          color: '#4aff8a',
        },
        freshness: Date.now(),
      })
    }
    return features
  } catch (err) {
    console.warn('[live/aircraft] poll failed:', err)
    return []
  }
}
