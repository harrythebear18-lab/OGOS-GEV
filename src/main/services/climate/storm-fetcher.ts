/**
 * Storm fetcher — ported from OGOS weatherFetcher.ts StormFetcher.
 * Fetches active tropical storms / severe weather from:
 *   - NHC (National Hurricane Center) CurrentStorms JSON
 *   - NWS API alerts (Hurricane/Tropical Storm/Tornado/Severe Thunderstorm)
 *
 * Returns Storm[] using our shared types.
 */

import type { Storm } from '@shared/types'

function safeNum(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined
  const n = typeof val === 'number' ? val : parseFloat(val)
  return isNaN(n) ? undefined : n
}

export class StormFetcher {
  /** Fetch active storms from all available sources, deduplicated */
  static async fetchActiveStorms(): Promise<Storm[]> {
    const sources: Promise<Storm[]>[] = [
      this.fetchNHCStorms(),
      this.fetchNWSAlertStorms(),
    ]

    const results = await Promise.allSettled(sources)
    let allStorms: Storm[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') allStorms.push(...r.value)
    }

    allStorms = this.dedupStorms(allStorms)
    console.log(`[climate/storm] Fetched ${allStorms.length} active storms (NHC + NWS alerts)`)
    return allStorms
  }

  /** NHC CurrentStorms JSON — active tropical cyclones */
  private static async fetchNHCStorms(): Promise<Storm[]> {
    const storms: Storm[] = []
    const NHC_URLS = [
      'https://www.nhc.noaa.gov/CurrentStorms.json',
      'https://nhc.noaa.gov/CurrentStorms.json',
    ]

    let raw: string | null = null
    for (const url of NHC_URLS) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (res.ok) {
          raw = await res.text()
          break
        }
      } catch (e) {
        console.error(`[climate/storm] NHC fetch failed (${url}):`, e)
      }
    }
    if (!raw) return storms

    try {
      const data = JSON.parse(raw)
      const activeStorms = data.activeStorms || data.ActiveStorms || []
      for (const s of activeStorms) {
        const lat = safeNum(s.latitudeNumeric) ?? safeNum(s.latitude_numeric) ?? safeNum(s.lat)
        const lon = safeNum(s.longitudeNumeric) ?? safeNum(s.longitude_numeric) ?? safeNum(s.lon)
        if (lat === undefined || lon === undefined) continue

        const ts = s.lastUpdate ? new Date(s.lastUpdate).getTime() : Date.now()
        const intensityNum = safeNum(s.intensity)
        const pressureNum = safeNum(s.pressure)

        storms.push({
          id: `nhc_${s.id}`,
          name: s.name || 'Unknown',
          basin: s.binNumber?.startsWith('EP')
            ? 'East Pacific'
            : s.binNumber?.startsWith('AT')
              ? 'Atlantic'
              : '',
          type: 'tropical_cyclone',
          classification: s.classification || '',
          intensity: intensityNum !== undefined ? `${intensityNum} kt` : '',
          lat,
          lon,
          windSpeedKt: intensityNum,
          pressureMB: pressureNum,
          movementDir: safeNum(s.movementDir) !== undefined ? String(s.movementDir) : undefined,
          movementSpeedKt: safeNum(s.movementSpeed),
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts, windSpeedKt: intensityNum, pressureMB: pressureNum }],
          forecastTrack: [],
        })
      }
      console.log(`[climate/storm] NHC: ${storms.length} storms`)
    } catch (e) {
      console.error('[climate/storm] NHC parse error:', e)
    }
    return storms
  }

  /** NWS API active alerts for severe weather events */
  private static async fetchNWSAlertStorms(): Promise<Storm[]> {
    const storms: Storm[] = []
    try {
      const url =
        'https://api.weather.gov/alerts/active?event=Hurricane%20Warning,Hurricane%20Watch,Tropical%20Storm%20Warning,Tropical%20Storm%20Watch,Severe%20Thunderstorm%20Warning,Tornado%20Warning,Tornado%20Watch'
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/geo+json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const features = data.features || []

      for (const f of features) {
        const props = f.properties || {}
        const geom = f.geometry
        if (!geom || !geom.coordinates) continue

        let lat: number | undefined, lon: number | undefined
        const coords = geom.coordinates
        if (geom.type === 'Polygon' && Array.isArray(coords[0])) {
          const ring = coords[0]
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length
        } else if (geom.type === 'Point' && typeof coords[0] === 'number') {
          lon = coords[0]
          lat = coords[1]
        }
        if (lat === undefined || lon === undefined) continue

        const event = props.event || 'Severe Weather'
        const severity = props.severity || 'Minor'
        const ts = props.sent ? new Date(props.sent).getTime() : Date.now()

        storms.push({
          id: `nws_${props.id || Math.random().toString(36).slice(2)}`,
          name: event,
          basin: '',
          type: event.includes('Tornado')
            ? 'tornado'
            : event.includes('Tropical') || event.includes('Hurricane')
              ? 'tropical_cyclone'
              : 'thunderstorm',
          classification: severity,
          intensity: severity,
          lat,
          lon,
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts }],
          forecastTrack: [],
        })
      }
      console.log(`[climate/storm] NWS alerts: ${storms.length} storms`)
    } catch (e) {
      console.error('[climate/storm] NWS alert fetch failed:', e)
    }
    return storms
  }

  /** Deduplicate storms by name+basin or proximity (<50km) */
  private static dedupStorms(storms: Storm[]): Storm[] {
    const result: Storm[] = []
    for (const s of storms) {
      const isDup = result.some((r) => {
        if (r.name === s.name && r.basin === s.basin && r.basin) return true
        const dist = Math.sqrt((r.lat - s.lat) ** 2 + (r.lon - s.lon) ** 2) * 111
        return dist < 50
      })
      if (!isDup) result.push(s)
    }
    return result
  }
}
