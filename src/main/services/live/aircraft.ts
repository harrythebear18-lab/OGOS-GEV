/**
 * Aircraft feed — OpenSky Network public API.
 * Returns all current aircraft states (ICAO24, callsign, position, velocity).
 * No API key required for anonymous access (rate-limited to ~100 req / 10 min).
 *
 * Endpoint: https://opensky-network.org/api/states/all
 * With optional bbox: ?lamin=&lomin=&lamax=&lomax=
 *
 * Implements 429 backoff: when rate-limited, skips polls for a cooldown period.
 */

import type { LiveFeature } from '@shared/types'

interface OpenSkyResponse {
  time: number
  states: any[][] | null
}

const OPENSKY_URL = 'https://opensky-network.org/api/states/all'

// Backoff state — when we get 429, skip polls until this timestamp
let rateLimitedUntil = 0

export async function getAircraftFeatures(): Promise<LiveFeature[]> {
  // If we're in a rate-limit cooldown, skip this poll
  if (rateLimitedUntil > Date.now()) {
    const waitSec = Math.ceil((rateLimitedUntil - Date.now()) / 1000)
    console.log(`[live/aircraft] rate-limited, skipping (${waitSec}s remaining)`)
    return []
  }

  try {
    const res = await fetch(OPENSKY_URL, { signal: AbortSignal.timeout(15000) })

    if (res.status === 429) {
      // Rate limited — back off for 5 minutes
      rateLimitedUntil = Date.now() + 5 * 60 * 1000
      const retryAfter = res.headers.get('retry-after')
      if (retryAfter) {
        const secs = parseInt(retryAfter, 10)
        if (!isNaN(secs)) rateLimitedUntil = Date.now() + secs * 1000
      }
      console.warn(`[live/aircraft] HTTP 429 — backing off for ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`)
      return []
    }

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
    console.log(`[live/aircraft] ${features.length} aircraft tracked`)
    return features
  } catch (err) {
    console.warn('[live/aircraft] poll failed:', err)
    return []
  }
}
