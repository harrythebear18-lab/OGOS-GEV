/**
 * ERDDAP data fetcher — ported from OGOS dataFetcher.ts.
 * Fetches oceanographic / climate station data from NOAA ERDDAP servers:
 *   - NOAA NDBC buoys (cwwcNDBCMet)
 *   - TAO/PIRATA moorings (pmelTaoDyT, pmelTaoDyCur, pmelTaoDySss)
 *   - GTSPP (erdGtsppBest)
 *   - Argo floats (AOML + Ifremer ERDDAP)
 *   - PMEL CO2 moorings (all_pmel_co2_moorings)
 *
 * Each method returns { stations, measurements } using our shared types.
 */

import type {
  ClimateStation,
  ClimateMeasurement,
} from '@shared/types'

export interface FetchResult {
  stations: ClimateStation[]
  measurements: Record<string, ClimateMeasurement>
}

/* ── helpers ── */

function safeNum(val: number | string | null | undefined): number | undefined {
  if (val === null || val === undefined || val === '') return undefined
  const n = typeof val === 'number' ? val : parseFloat(val as string)
  return isNaN(n) ? undefined : n
}

/** Simple deterministic hash for stable sampling (e.g. which floats are "BGC-equipped"). */
function hashStringToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

interface ErddapJsonResponse {
  table: {
    columnNames: string[]
    columnTypes: string[]
    rows: any[][]
  }
}

async function fetchErddapJson(url: string, timeoutMs = 20000): Promise<ErddapJsonResponse> {
  // Retry with exponential backoff — ERDDAP and NHC can be slow/flaky
  const maxRetries = 2
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return (await res.json()) as ErddapJsonResponse
    } catch (e) {
      lastError = e as Error
      if (attempt < maxRetries) {
        const delay = 2000 * Math.pow(2, attempt) // 2s, 4s
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastError ?? new Error('fetchErddapJson failed')
}

function parseErddapTime(val: any): number {
  if (typeof val === 'number') {
    if (val > 1e12) return val
    if (val > 1e9) return val * 1000
    return val * 1000
  }
  return new Date(val).getTime()
}

function buildRowMapper(columnNames: string[]) {
  return (row: any[], field: string): any => {
    const idx = columnNames.indexOf(field)
    return idx >= 0 ? row[idx] : undefined
  }
}

const ERDDAP_BASE = 'https://coastwatch.pfeg.noaa.gov/erddap/tabledap'

/* ── ErddapFetcher ── */

export class ErddapFetcher {
  /** NOAA NDBC buoy meteorological data */
  static async fetchNDBC(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const vars =
        'station,longitude,latitude,time,WD,WSPD,GST,WVHT,DPD,APD,BAR,ATMP,WTMP,DEWP,VIS,PTDY,TIDE,WSPU,WSPV'
      const url = `${ERDDAP_BASE}/cwwcNDBCMet.json?${vars}&time%3E=now-2hours&orderBy(%22station,time%22)`
      console.log('[climate/erddap] NDBC fetching:', url)
      const data = await fetchErddapJson(url, 30000)
      const get = buildRowMapper(data.table.columnNames)

      const seen = new Set<string>()
      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string
        if (!stationId) continue

        const lat = safeNum(get(row, 'latitude'))
        const lon = safeNum(get(row, 'longitude'))
        if (lat === undefined || lon === undefined) continue

        const id = `ndbc_${stationId}`
        const ts = parseErddapTime(get(row, 'time'))

        if (!seen.has(id)) {
          seen.add(id)
          stations.push({
            id,
            name: stationId,
            type: 'buoy',
            source: 'NOAA_NDBC',
            lat,
            lon,
            lastUpdate: ts,
            active: true,
          })
        }

        measurements[id] = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'WTMP')),
          airTemp: safeNum(get(row, 'ATMP')),
          windSpeed: safeNum(get(row, 'WSPD')),
          windDir: safeNum(get(row, 'WD')),
          waveHeight: safeNum(get(row, 'WVHT')),
          wavePeriod: safeNum(get(row, 'DPD')),
          pressure: safeNum(get(row, 'BAR')),
        }
      }
      console.log(`[climate/erddap] NDBC: ${stations.length} stations, ${Object.keys(measurements).length} measurements`)
    } catch (e) {
      console.error('[climate/erddap] NDBC fetch error:', e)
    }

    return { stations, measurements }
  }

  /** GTSPP — Global Temperature-Salinity Profile Programme */
  static async fetchGTSPP(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const vars = 'trajectory,longitude,latitude,time,depth,temperature,salinity'
      const url = `${ERDDAP_BASE}/erdGtsppBest.json?${vars}&time%3Emax(time)-7days&depth%3C=20&orderBy(%22trajectory,time%22)`
      const data = await fetchErddapJson(url, 30000)
      const get = buildRowMapper(data.table.columnNames)

      const seen = new Set<string>()
      for (const row of data.table.rows) {
        const traj = get(row, 'trajectory') as string
        if (!traj) continue

        const lat = safeNum(get(row, 'latitude'))
        const lon = safeNum(get(row, 'longitude'))
        if (lat === undefined || lon === undefined) continue

        const id = `gtspp_${traj}`
        const ts = parseErddapTime(get(row, 'time'))

        if (!seen.has(id)) {
          seen.add(id)
          const isArgo = traj.startsWith('PF') || traj.includes('argo')
          stations.push({
            id,
            name: traj,
            type: isArgo ? 'argo_float' : 'buoy',
            source: 'GTSPP',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          })
        }

        measurements[id] = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'temperature')),
          salinity: safeNum(get(row, 'salinity')),
          depth: safeNum(get(row, 'depth')),
        }
      }
      console.log(`[climate/erddap] GTSPP: ${stations.length} stations`)
    } catch (e) {
      console.error('[climate/erddap] GTSPP fetch error:', e)
    }

    return { stations, measurements }
  }

  /** TAO/PIRATA — temperature at 20m depth */
  static async fetchTAO(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const vars = 'station,longitude,latitude,time,depth,T_20'
      const url = `${ERDDAP_BASE}/pmelTaoDyT.json?${vars}&time%3Emax(time)-7days&orderBy(%22station,time%22)`
      const data = await fetchErddapJson(url, 30000)
      const get = buildRowMapper(data.table.columnNames)

      const seen = new Set<string>()
      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string
        if (!stationId) continue

        const lat = safeNum(get(row, 'latitude'))
        const lon = safeNum(get(row, 'longitude'))
        if (lat === undefined || lon === undefined) continue

        const id = `tao_${stationId}`
        const ts = parseErddapTime(get(row, 'time'))

        if (!seen.has(id)) {
          seen.add(id)
          stations.push({
            id,
            name: stationId,
            type: 'buoy',
            source: 'TAO_PIRATA',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          })
        }

        measurements[id] = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'T_20')),
          depth: safeNum(get(row, 'depth')),
        }
      }
      console.log(`[climate/erddap] TAO: ${stations.length} stations`)
    } catch (e) {
      console.error('[climate/erddap] TAO fetch error:', e)
    }

    return { stations, measurements }
  }

  /** TAO/PIRATA — ocean currents */
  static async fetchTAOCurrents(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const vars = 'station,longitude,latitude,time,depth,CS_300,CD_310'
      const url = `${ERDDAP_BASE}/pmelTaoDyCur.json?${vars}&time%3Emax(time)-7days&orderBy(%22station,time%22)`
      const data = await fetchErddapJson(url, 30000)
      const get = buildRowMapper(data.table.columnNames)

      const seen = new Set<string>()
      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string
        if (!stationId) continue

        const lat = safeNum(get(row, 'latitude'))
        const lon = safeNum(get(row, 'longitude'))
        if (lat === undefined || lon === undefined) continue

        const id = `tao_cur_${stationId}`
        const ts = parseErddapTime(get(row, 'time'))

        if (!seen.has(id)) {
          seen.add(id)
          stations.push({
            id,
            name: `${stationId} (currents)`,
            type: 'buoy',
            source: 'TAO_PIRATA',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          })
        }

        measurements[id] = {
          stationId: id,
          timestamp: ts,
          currentSpeed: safeNum(get(row, 'CS_300')),
          currentDir: safeNum(get(row, 'CD_310')),
          depth: safeNum(get(row, 'depth')),
        }
      }
      console.log(`[climate/erddap] TAO currents: ${stations.length} stations`)
    } catch (e) {
      console.error('[climate/erddap] TAO currents fetch error:', e)
    }

    return { stations, measurements }
  }

  /** TAO/PIRATA — sea surface salinity */
  static async fetchTAOSalinity(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const vars = 'station,longitude,latitude,time,depth,S_41'
      const url = `${ERDDAP_BASE}/pmelTaoDySss.json?${vars}&time%3Emax(time)-7days&orderBy(%22station,time%22)`
      const data = await fetchErddapJson(url, 30000)
      const get = buildRowMapper(data.table.columnNames)

      const seen = new Set<string>()
      for (const row of data.table.rows) {
        const stationId = get(row, 'station') as string
        if (!stationId) continue

        const lat = safeNum(get(row, 'latitude'))
        const lon = safeNum(get(row, 'longitude'))
        if (lat === undefined || lon === undefined) continue

        const id = `tao_sss_${stationId}`
        const ts = parseErddapTime(get(row, 'time'))

        if (!seen.has(id)) {
          seen.add(id)
          stations.push({
            id,
            name: `${stationId} (salinity)`,
            type: 'buoy',
            source: 'TAO_PIRATA',
            lat,
            lon,
            depth: safeNum(get(row, 'depth')),
            lastUpdate: ts,
            active: true,
          })
        }

        measurements[id] = {
          stationId: id,
          timestamp: ts,
          salinity: safeNum(get(row, 'S_41')),
          depth: safeNum(get(row, 'depth')),
        }
      }
      console.log(`[climate/erddap] TAO salinity: ${stations.length} stations`)
    } catch (e) {
      console.error('[climate/erddap] TAO salinity fetch error:', e)
    }

    return { stations, measurements }
  }

  /** Argo floats — tries AOML then Ifremer ERDDAP servers */
  static async fetchArgo(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    const ARGO_SERVERS = [
      {
        base: 'https://erddap.aoml.noaa.gov/hdb/erddap/tabledap',
        datasets: [
          'argo_float_pacific_2025_present',
          'argo_float_atlantic_2025_present',
          'argo_float_indian_2025_present',
        ],
        vars: 'PLATFORM_NUMBER,latitude,longitude,time,PRES,TEMP,PSAL',
        platformField: 'PLATFORM_NUMBER',
        presField: 'PRES',
        tempField: 'TEMP',
        psalField: 'PSAL',
      },
      {
        base: 'https://erddap.ifremer.fr/erddap/tabledap',
        datasets: ['ArgoFloats'],
        vars: 'platform_number,latitude,longitude,time,pres,temp,psal',
        platformField: 'platform_number',
        presField: 'pres',
        tempField: 'temp',
        psalField: 'psal',
      },
    ]

    const seenFloats = new Set<string>()
    // Collect trajectory points per float for drift trail visualization
    const trajectories = new Map<string, { lat: number; lon: number; timestamp: number }[]>()
    let fetched = false

    for (const server of ARGO_SERVERS) {
      if (fetched) break
      for (const dataset of server.datasets) {
        try {
          const url = `${server.base}/${dataset}.json?${server.vars}&time%3Emax(time)-30days&${server.presField}%3C=20&orderBy(%22${server.platformField},time%22)`
          const data = await fetchErddapJson(url, 45000)
          const get = buildRowMapper(data.table.columnNames)
          const before = seenFloats.size

          for (const row of data.table.rows) {
            const floatId = get(row, server.platformField) as string
            if (!floatId) continue

            const lat = safeNum(get(row, 'latitude'))
            const lon = safeNum(get(row, 'longitude'))
            if (lat === undefined || lon === undefined) continue

            const id = `argo_${floatId}`
            const ts = parseErddapTime(get(row, 'time'))

            if (!seenFloats.has(id)) {
              seenFloats.add(id)
              stations.push({
                id,
                name: `Argo ${floatId}`,
                type: 'argo_float',
                source: 'ARGO',
                lat,
                lon,
                depth: safeNum(get(row, server.presField)),
                lastUpdate: ts,
                active: true,
              })
              trajectories.set(id, [])
            }

            // Collect trajectory points (limit to last 30 per float to bound memory)
            const traj = trajectories.get(id)!
            if (traj.length < 30) {
              traj.push({ lat, lon, timestamp: ts })
            }

            measurements[id] = {
              stationId: id,
              timestamp: ts,
              waterTemp: safeNum(get(row, server.tempField)),
              salinity: safeNum(get(row, server.psalField)),
              depth: safeNum(get(row, server.presField)),
            }
          }

          // Attach trajectories to measurements
          for (const [id, traj] of trajectories) {
            if (measurements[id] && traj.length >= 2) {
              measurements[id].trajectory = traj
            }
          }

          fetched = true
          console.log(`[climate/erddap] Argo ${dataset}: +${seenFloats.size - before} floats (total ${stations.length})`)
        } catch (e) {
          console.error(`[climate/erddap] Argo fetch failed (${server.base}/${dataset}):`, e)
        }
      }
    }

    if (!fetched) {
      console.error('[climate/erddap] All Argo ERDDAP servers failed')
    }

    return { stations, measurements }
  }

  /**
   * BGC-Argo simulator — derives biogeochemical measurements from existing
   * Argo T/S/depth profiles using established oceanographic algorithms.
   *
   * No external fetch needed. Uses:
   *  - Oxygen: Garcia & Gordon (1992) solubility equation (T, S, depth)
   *  - Chlorophyll: latitude/season/basin model (oligotrophic gyres vs polar)
   *  - Nitrate: depth + latitude model (deep/high-lat = high nitrate)
   *  - pH: thermodynamic model from T and S (warmer/saltier = lower pH)
   *
   * @param argoResult The result from fetchArgo() — used as the base profile
   */
  static simulateBGCArgo(argoResult: FetchResult): FetchResult {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    const now = Date.now()
    const dayOfYear = (new Date().getUTCMonth() * 30 + new Date().getUTCDate()) / 365

    for (const [argoId, m] of Object.entries(argoResult.measurements)) {
      // Only sample ~15% of Argo floats as BGC-equipped (realistic ratio)
      if (hashStringToInt(argoId) % 7 !== 0) continue

      const station = argoResult.stations.find((s) => s.id === argoId)
      if (!station) continue

      const lat = station.lat
      const lon = station.lon
      const temp = m.waterTemp ?? 15
      const sal = m.salinity ?? 35
      const depth = m.depth ?? 10

      const bgcId = argoId.replace('argo_', 'bgc_argo_')

      stations.push({
        ...station,
        id: bgcId,
        name: station.name.replace('Argo', 'BGC-Argo'),
        type: 'bgc_argo_float' as const,
        source: 'BGC_ARGO' as const,
      })

      // ── Dissolved Oxygen (mg/L) — Garcia & Gordon (1992) simplified ──
      // O2 saturation decreases with temperature and salinity.
      // Realistic range: 2-9 mg/L. Deep water = lower O2 (OMZ zones).
      const o2Sat = 14.6 - 0.41 * temp + 0.008 * temp * temp - 0.04 * (sal - 35)
      const depthFactor = Math.max(0.3, 1 - depth / 2000)
      // Pacific OMZ (eastern equatorial Pacific) has very low O2
      const omzFactor = (lon > -160 && lon < -100 && lat > -20 && lat < 20) ? 0.3 : 1
      const oxygen = Math.max(0.5, o2Sat * depthFactor * omzFactor)

      // ── Chlorophyll-a (mg/m³) — latitude/season/basin model ──
      // High latitudes (polar) = higher chl. Oligotrophic gyres (subtropical) = low.
      // Spring/summer bloom = higher. Coastal/upwelling = higher.
      const absLat = Math.abs(lat)
      const seasonalBoost = 1 + 0.5 * Math.sin(2 * Math.PI * (dayOfYear - 0.2))
      const latFactor = absLat > 50 ? 2.5 : absLat > 30 ? 0.8 : 1.2
      // Upwelling zones (eastern boundaries) have higher chl
      const upwellingZone =
        (lon > -150 && lon < -110 && lat > -5 && lat < 35) || // California
        (lon > 5 && lon < 20 && lat > -35 && lat < -10) ||    // Benguela
        (lon > -80 && lon < -70 && lat > -20 && lat < 5)      // Peru
      const upwellingFactor = upwellingZone ? 3.0 : 1.0
      const chl = Math.max(0.05, 0.3 * latFactor * seasonalBoost * upwellingFactor * (1 - depth / 500))

      // ── Nitrate (µmol/L) — depth + latitude model ──
      // Deep water = high nitrate. High latitudes = higher surface nitrate.
      // Realistic range: 0-40 µmol/L
      const deepNitrate = Math.min(40, depth / 50)
      const latNitrate = absLat > 50 ? 15 : absLat > 30 ? 5 : 2
      const nitrate = Math.max(0.1, deepNitrate + latNitrate * (1 - depth / 1000))

      // ── pH (total scale) — thermodynamic from T and S ──
      // Colder/fresher water = higher pH. Warmer/saltier = lower pH.
      // Realistic range: 7.8-8.2
      const ph = 8.15 - 0.005 * (temp - 15) - 0.0008 * (sal - 35) - 0.0001 * depth / 100

      measurements[bgcId] = {
        stationId: bgcId,
        timestamp: m.timestamp ?? now,
        waterTemp: temp,
        salinity: sal,
        depth,
        oxygen: Math.round(oxygen * 100) / 100,
        chl: Math.round(chl * 1000) / 1000,
        nitrate: Math.round(nitrate * 100) / 100,
        ph: Math.round(ph * 1000) / 1000,
      }
    }

    console.log(`[climate/erddap] BGC-Argo simulated: ${stations.length} floats (derived from Argo)`)
    return { stations, measurements }
  }

  /** PMEL CO2 moorings — surface ocean CO2 measurements */
  static async fetchCO2(): Promise<FetchResult> {
    const stations: ClimateStation[] = []
    const measurements: Record<string, ClimateMeasurement> = {}

    try {
      const CO2_BASE = 'https://data.pmel.noaa.gov/pmel/erddap/tabledap'
      const vars = 'station_id,longitude,latitude,time,SST,SSS,pCO2_sw,pCO2_air,xCO2_air,pH_sw'
      const url = `${CO2_BASE}/all_pmel_co2_moorings.json?${vars}&time%3Emax(time)-730days&orderBy(%22station_id,time%22)`
      const data = await fetchErddapJson(url, 30000)
      const get = buildRowMapper(data.table.columnNames)

      // Keep only the latest measurement per station
      const latestPerStation = new Map<string, { row: any[]; ts: number }>()
      for (const row of data.table.rows) {
        const stationId = get(row, 'station_id') as string
        if (!stationId) continue
        const id = `co2_${stationId}`
        const ts = parseErddapTime(get(row, 'time'))
        const existing = latestPerStation.get(id)
        if (!existing || ts > existing.ts) {
          latestPerStation.set(id, { row, ts })
        }
      }

      for (const [id, { row, ts }] of latestPerStation) {
        const stationId = get(row, 'station_id') as string
        const lat = safeNum(get(row, 'latitude'))
        const lon = safeNum(get(row, 'longitude'))
        if (lat === undefined || lon === undefined) continue

        stations.push({
          id,
          name: stationId,
          type: 'carbon_station',
          source: 'PMEL_CO2',
          lat,
          lon,
          lastUpdate: ts,
          active: ts > Date.now() - 365 * 24 * 60 * 60 * 1000,
        })

        measurements[id] = {
          stationId: id,
          timestamp: ts,
          waterTemp: safeNum(get(row, 'SST')),
          salinity: safeNum(get(row, 'SSS')),
          co2: safeNum(get(row, 'xCO2_air')),
        }
      }

      console.log(`[climate/erddap] CO2 moorings: ${stations.length} stations (${stations.filter((s) => s.active).length} active)`)
    } catch (e) {
      console.error('[climate/erddap] CO2 mooring fetch error:', e)
    }

    return { stations, measurements }
  }
}
