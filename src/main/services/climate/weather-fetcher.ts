/**
 * Weather fetcher — ported from OGOS weatherFetcher.ts.
 *
 * Only creates NEW fetchers for: NWS METAR weather stations.
 * For sources we already have (lightning, aircraft, vessels, earthquakes, fires),
 * we import from ../live/ and reuse — no duplication.
 */

import type { ClimateStation, ClimateMeasurement } from '@shared/types'
import type { FetchResult } from './erddap-fetcher'

// Re-export existing live data feeds so the climate monitor can use them
export { getLightningFeatures } from '../live/lightning'
export { getAircraftFeatures } from '../live/aircraft'
export { getVesselFeatures } from '../live/vessels'
export { getFireFeatures } from '../live/fires'

// Re-export storm + space weather fetchers
export { StormFetcher } from './storm-fetcher'
export { SpaceWeatherFetcher } from './space-weather-fetcher'

function safeNum(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined
  const n = typeof val === 'number' ? val : parseFloat(val)
  return isNaN(n) ? undefined : n
}

export class WeatherFetcher {
  /**
   * Fetch NWS METAR weather stations from aviationweather.gov.
   * Fetches in 3 longitude bands to cover the globe.
   * Returns ClimateStation[] + Record<string, ClimateMeasurement>.
   */
  static async fetchNWS(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const bands = [
        { bbox: '-180,-90,-30,90' },
        { bbox: '-30,-90,60,90' },
        { bbox: '60,-90,180,90' },
      ]

      const seenIds = new Set<string>()

      for (const band of bands) {
        try {
          const res = await fetch(
            `https://aviationweather.gov/api/data/metar?format=json&taf=false&hours=1&bbox=${band.bbox}`,
            { signal: AbortSignal.timeout(15000) },
          )
          if (!res.ok) continue
          const data = await res.json()
          if (!Array.isArray(data)) continue

          for (const obs of data) {
            const lat = safeNum(obs.lat)
            const lon = safeNum(obs.lon)
            if (lat === undefined || lon === undefined) continue

            const icaoId = obs.icaoId
            if (!icaoId || seenIds.has(icaoId)) continue
            seenIds.add(icaoId)

            const id = `metar_${icaoId}`
            const ts =
              typeof obs.obsTime === 'number'
                ? obs.obsTime * 1000
                : new Date(obs.reportTime || Date.now()).getTime()

            const windSpeedKt = safeNum(obs.wspd)
            const altim = safeNum(obs.altim)
            const airTemp = safeNum(obs.temp)
            const windDir = safeNum(obs.wdir)

            // Skip stations with no useful data
            if (
              airTemp === undefined &&
              windSpeedKt === undefined &&
              windDir === undefined &&
              altim === undefined
            ) {
              continue
            }

            stations.push({
              id,
              name: obs.name || icaoId,
              type: 'weather_station',
              source: 'NWS_WEATHER',
              lat,
              lon,
              elevation: safeNum(obs.elev),
              lastUpdate: ts,
              active: true,
            })

            measurements[id] = {
              stationId: id,
              timestamp: ts,
              airTemp,
              windSpeed: windSpeedKt !== undefined ? windSpeedKt * 0.514444 : undefined, // kt → m/s
              windDir,
              pressure:
                altim !== undefined
                  ? altim > 100
                    ? altim
                    : altim * 33.8639 // inHg → hPa
                  : undefined,
            }
          }
        } catch (e) {
          console.error(`[climate/weather] METAR fetch error (bbox=${band.bbox}):`, e)
        }
      }

      console.log(`[climate/weather] METAR: ${stations.length} global weather stations`)
    } catch (e) {
      console.error('[climate/weather] METAR fetch failed:', e)
    }

    return { stations, measurements }
  }
}
