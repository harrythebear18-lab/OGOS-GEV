/* Ocean-Atmosphere Coupling Model — ported from OGOS.
 * Computes SST anomalies, land-air anomalies, teleconnection indices
 * (ENSO/PDO/NAO proxies), and ocean-land correlations. */
import type { ClimateStation, ClimateMeasurement, SstAnomaly } from '@shared/types'

/** Result consumed by the severe-weather predictor and the prediction engine. */
export interface CouplingResult {
  sstAnomalies: SstAnomaly[]
  teleconnectionIndices: Record<string, number>
  ensoIndex: number
  ensoCategory: string
  globalMeanSSTAnomaly: number
  globalMeanAirTempAnomaly: number
}

/* ── Region classification (embedded from OGOS regionClassification.ts) ── */

interface RegionBox {
  id: string
  type: 'ocean' | 'land'
  name: string
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
  centerLat: number
  centerLon: number
}

const OCEAN_BASINS: RegionBox[] = [
  { id: 'north_pacific', type: 'ocean', name: 'North Pacific', minLat: 0, maxLat: 70, minLon: 120, maxLon: 300, centerLat: 30, centerLon: 180 },
  { id: 'south_pacific', type: 'ocean', name: 'South Pacific', minLat: -70, maxLat: 0, minLon: 150, maxLon: 290, centerLat: -30, centerLon: 210 },
  { id: 'north_atlantic', type: 'ocean', name: 'North Atlantic', minLat: 0, maxLat: 75, minLon: -80, maxLon: 20, centerLat: 35, centerLon: -40 },
  { id: 'south_atlantic', type: 'ocean', name: 'South Atlantic', minLat: -70, maxLat: 0, minLon: -70, maxLon: 20, centerLat: -25, centerLon: -20 },
  { id: 'indian', type: 'ocean', name: 'Indian Ocean', minLat: -50, maxLat: 30, minLon: 20, maxLon: 120, centerLat: -10, centerLon: 70 },
  { id: 'arctic', type: 'ocean', name: 'Arctic Ocean', minLat: 70, maxLat: 90, minLon: -180, maxLon: 180, centerLat: 82, centerLon: 0 },
  { id: 'southern_ocean', type: 'ocean', name: 'Southern Ocean', minLat: -90, maxLat: -60, minLon: -180, maxLon: 180, centerLat: -70, centerLon: 0 },
]

const CONTINENTS: RegionBox[] = [
  { id: 'north_america', type: 'land', name: 'North America', minLat: 7, maxLat: 84, minLon: -170, maxLon: -50, centerLat: 45, centerLon: -100 },
  { id: 'south_america', type: 'land', name: 'South America', minLat: -56, maxLat: 15, minLon: -82, maxLon: -34, centerLat: -15, centerLon: -60 },
  { id: 'europe', type: 'land', name: 'Europe', minLat: 35, maxLat: 72, minLon: -25, maxLon: 50, centerLat: 54, centerLon: 15 },
  { id: 'africa', type: 'land', name: 'Africa', minLat: -35, maxLat: 37, minLon: -20, maxLon: 55, centerLat: 0, centerLon: 20 },
  { id: 'asia', type: 'land', name: 'Asia', minLat: -12, maxLat: 78, minLon: 50, maxLon: 150, centerLat: 40, centerLon: 95 },
  { id: 'oceania', type: 'land', name: 'Oceania', minLat: -50, maxLat: 10, minLon: 110, maxLon: 180, centerLat: -25, centerLon: 140 },
  { id: 'antarctica', type: 'land', name: 'Antarctica', minLat: -90, maxLat: -60, minLon: -180, maxLon: 180, centerLat: -80, centerLon: 0 },
]

const OCEAN_STATION_TYPES = new Set(['buoy', 'argo_float', 'bgc_argo_float', 'carbon_station'])
const LAND_STATION_TYPES = new Set(['weather_station'])

function normalizeLon(lon: number): number {
  if (lon < -180) return lon + 360
  if (lon > 180) return lon - 360
  return lon
}

function pointInBox(lat: number, lon: number, box: RegionBox): boolean {
  const normLon = normalizeLon(lon)
  const minLon = normalizeLon(box.minLon)
  const maxLon = normalizeLon(box.maxLon)
  if (lat < box.minLat || lat > box.maxLat) return false
  if (minLon <= maxLon) return normLon >= minLon && normLon <= maxLon
  return normLon >= minLon || normLon <= maxLon
}

function classifyRegion(lat: number, lon: number, stationType: string): RegionBox | null {
  const isOcean = OCEAN_STATION_TYPES.has(stationType)
  const isLand = LAND_STATION_TYPES.has(stationType)
  if (isOcean) {
    const box = OCEAN_BASINS.find((b) => pointInBox(lat, lon, b))
    if (box) return box
  }
  if (isLand) {
    const box = CONTINENTS.find((b) => pointInBox(lat, lon, b))
    if (box) return box
  }
  const oceanBox = OCEAN_BASINS.find((b) => pointInBox(lat, lon, b))
  if (oceanBox && !isLand) return oceanBox
  return CONTINENTS.find((b) => pointInBox(lat, lon, b)) ?? null
}

/* ── Helpers ── */

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Climatic baseline temperatures by latitude band (Hadley Cell approximation). */
function climaticBaselineTemp(lat: number, field: string): number {
  const absLat = Math.abs(lat)
  if (field === 'waterTemp') return 28 - (absLat / 90) * 29
  if (field === 'airTemp') return 27 - (absLat / 90) * 52
  return 0
}

interface RegionData {
  regionId: string
  regionName: string
  regionType: 'ocean' | 'land'
  centerLat: number
  centerLon: number
  field: string
  values: number[]
  anomalies: number[]
  stationIds: Set<string>
}

function computeRegionAnomalies(
  stations: ClimateStation[],
  measurements: Map<string, ClimateMeasurement>,
  field: string,
  regionType: 'ocean' | 'land',
): RegionData[] {
  const regionMap = new Map<string, RegionData>()

  for (const station of stations) {
    const m = measurements.get(station.id)
    if (!m) continue
    const val = (m as unknown as Record<string, unknown>)[field] as number | undefined
    if (val === undefined || isNaN(val)) continue

    const region = classifyRegion(station.lat, station.lon, station.type)
    if (!region || region.type !== regionType) continue

    let rd = regionMap.get(region.id)
    if (!rd) {
      rd = {
        regionId: region.id,
        regionName: region.name,
        regionType,
        centerLat: region.centerLat,
        centerLon: region.centerLon,
        field,
        values: [],
        anomalies: [],
        stationIds: new Set(),
      }
      regionMap.set(region.id, rd)
    }
    const baseline = climaticBaselineTemp(station.lat, field)
    rd.values.push(val)
    rd.anomalies.push(val - baseline)
    rd.stationIds.add(station.id)
  }

  return Array.from(regionMap.values())
}

/* ── Teleconnection index computations ── */

interface RegionAnomalySummary {
  regionId: string
  centerLat: number
  centerLon: number
  avgAnomaly: number
  stationCount: number
}

function toSummary(r: RegionData): RegionAnomalySummary {
  return {
    regionId: r.regionId,
    centerLat: r.centerLat,
    centerLon: r.centerLon,
    avgAnomaly: mean(r.anomalies),
    stationCount: r.stationIds.size,
  }
}

function computeENSOIndex(sst: RegionAnomalySummary[]): { value: number; category: string } {
  const pacific = sst.filter(
    (a) => (a.regionId === 'north_pacific' || a.regionId === 'south_pacific') && Math.abs(a.centerLat) < 30,
  )
  if (pacific.length === 0) return { value: 0, category: 'Neutral' }
  const avg = mean(pacific.map((a) => a.avgAnomaly))
  const value = clamp(avg / 0.8, -2.5, 2.5)
  let category = 'Neutral'
  if (value >= 1.0) category = 'El Nino'
  else if (value >= 0.5) category = 'El Nino (weak)'
  else if (value <= -1.0) category = 'La Nina'
  else if (value <= -0.5) category = 'La Nina (weak)'
  return { value, category }
}

function computePDOIndex(sst: RegionAnomalySummary[]): number {
  const npacific = sst.find((a) => a.regionId === 'north_pacific')
  if (!npacific) return 0
  return clamp(npacific.avgAnomaly / 1.0, -2, 2)
}

function computeNAOIndex(
  sst: RegionAnomalySummary[],
  stations: ClimateStation[],
  measurements: Map<string, ClimateMeasurement>,
): number {
  const natl = sst.find((a) => a.regionId === 'north_atlantic')
  if (!natl) return 0
  const highLat: number[] = []
  const lowLat: number[] = []
  for (const s of stations) {
    const m = measurements.get(s.id)
    if (!m || m.pressure === undefined) continue
    const region = classifyRegion(s.lat, s.lon, s.type)
    if (region?.id !== 'north_atlantic') continue
    if (s.lat > 50) highLat.push(m.pressure)
    else if (s.lat < 40 && s.lat > 20) lowLat.push(m.pressure)
  }
  let pressureDiff = 0
  if (highLat.length > 0 && lowLat.length > 0) {
    pressureDiff = mean(lowLat) - mean(highLat)
  }
  return clamp((pressureDiff - 10) / 15, -2, 2)
}

/* ── Ocean→land correlation ── */

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 2) return 0
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my)
    dx += (x[i] - mx) ** 2
    dy += (y[i] - my) ** 2
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? 0 : num / den
}

const TELECONNECTION_PATHWAYS: { ocean: string; land: string; lagHours: number }[] = [
  { ocean: 'north_pacific', land: 'north_america', lagHours: 72 },
  { ocean: 'north_pacific', land: 'asia', lagHours: 48 },
  { ocean: 'north_atlantic', land: 'europe', lagHours: 48 },
  { ocean: 'north_atlantic', land: 'north_america', lagHours: 72 },
  { ocean: 'indian', land: 'africa', lagHours: 96 },
  { ocean: 'indian', land: 'asia', lagHours: 72 },
  { ocean: 'south_pacific', land: 'south_america', lagHours: 120 },
  { ocean: 'south_pacific', land: 'oceania', lagHours: 96 },
]

function computeCorrelations(oceanRegions: RegionData[], landRegions: RegionData[]): number {
  let strongest = 0
  for (const path of TELECONNECTION_PATHWAYS) {
    const ocean = oceanRegions.find((r) => r.regionId === path.ocean && r.field === 'waterTemp')
    const land = landRegions.find((r) => r.regionId === path.land && r.field === 'airTemp')
    if (!ocean || !land) continue
    if (ocean.anomalies.length < 3 || land.anomalies.length < 3) continue
    const minLen = Math.min(ocean.anomalies.length, land.anomalies.length)
    const r = Math.abs(pearsonCorrelation(ocean.anomalies.slice(-minLen), land.anomalies.slice(-minLen)))
    if (r > strongest) strongest = r
  }
  return strongest
}

/* ── Main coupler class ── */

export class OceanAtmosphereCoupler {
  private sstHistory = new Map<string, { anomalies: number[]; timestamps: number[] }>()
  private landTempHistory = new Map<string, { anomalies: number[]; timestamps: number[] }>()

  analyze(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): CouplingResult {
    // 1. Regional SST anomalies (ocean)
    const oceanRegions = computeRegionAnomalies(stations, measurements, 'waterTemp', 'ocean')
    const oceanSummaries = oceanRegions.map(toSummary)

    // 2. Regional land temperature anomalies
    const landRegions = computeRegionAnomalies(stations, measurements, 'airTemp', 'land')
    const landSummaries = landRegions.map(toSummary)

    // 3. Update time-series history (capped at 50)
    const now = Date.now()
    for (const r of oceanRegions) {
      let hist = this.sstHistory.get(r.regionId)
      if (!hist) { hist = { anomalies: [], timestamps: [] }; this.sstHistory.set(r.regionId, hist) }
      hist.anomalies.push(mean(r.anomalies))
      hist.timestamps.push(now)
      if (hist.anomalies.length > 50) { hist.anomalies.shift(); hist.timestamps.shift() }
    }
    for (const r of landRegions) {
      let hist = this.landTempHistory.get(r.regionId)
      if (!hist) { hist = { anomalies: [], timestamps: [] }; this.landTempHistory.set(r.regionId, hist) }
      hist.anomalies.push(mean(r.anomalies))
      hist.timestamps.push(now)
      if (hist.anomalies.length > 50) { hist.anomalies.shift(); hist.timestamps.shift() }
    }

    // 4. Teleconnection indices
    const enso = computeENSOIndex(oceanSummaries)
    const pdo = computePDOIndex(oceanSummaries)
    const nao = computeNAOIndex(oceanSummaries, stations, measurements)

    const teleconnectionIndices: Record<string, number> = {
      ENSO: Math.round(enso.value * 100) / 100,
      PDO: Math.round(pdo * 100) / 100,
      NAO: Math.round(nao * 100) / 100,
    }

    // 5. Ocean→land correlations
    const strongestCorrelation = computeCorrelations(oceanRegions, landRegions)

    // 6. Global means
    const globalMeanSSTAnomaly = oceanSummaries.length > 0 ? mean(oceanSummaries.map((a) => a.avgAnomaly)) : 0
    const globalMeanAirTempAnomaly = landSummaries.length > 0 ? mean(landSummaries.map((a) => a.avgAnomaly)) : 0

    // 7. Build SstAnomaly[] (ocean + land)
    const sstAnomalies: SstAnomaly[] = [
      ...oceanSummaries.map((a) => ({ lat: a.centerLat, lon: a.centerLon, anomaly: Math.round(a.avgAnomaly * 100) / 100, region: a.regionId })),
      ...landSummaries.map((a) => ({ lat: a.centerLat, lon: a.centerLon, anomaly: Math.round(a.avgAnomaly * 100) / 100, region: a.regionId })),
    ]

    console.log(`[prediction/ocean-atmosphere] ${sstAnomalies.length} region anomalies, ENSO: ${enso.category} (${enso.value.toFixed(2)}), strongest correlation: ${strongestCorrelation.toFixed(2)}`)

    return {
      sstAnomalies,
      teleconnectionIndices,
      ensoIndex: enso.value,
      ensoCategory: enso.category,
      globalMeanSSTAnomaly,
      globalMeanAirTempAnomaly,
    }
  }
}
