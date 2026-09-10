/**
 * Region Classification — classifies lat/lon points into ocean basins
 * and continents. Ported from OGOS.
 *
 * Used by the climate monitor to group stations by region and to detect
 * land-based stations reporting ocean depths (or vice versa).
 */

import type { OceanBasin, Continent, RegionId, RegionType, StationType, RegionClassification } from '@shared/types'

interface BoundingBox {
  id: RegionId
  type: RegionType
  name: string
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
  centerLat: number
  centerLon: number
}

const OCEAN_BASINS: BoundingBox[] = [
  { id: 'north_pacific', type: 'ocean', name: 'North Pacific', minLat: 0, maxLat: 70, minLon: 120, maxLon: 300, centerLat: 30, centerLon: 180 },
  { id: 'south_pacific', type: 'ocean', name: 'South Pacific', minLat: -70, maxLat: 0, minLon: 150, maxLon: 290, centerLat: -30, centerLon: 210 },
  { id: 'north_atlantic', type: 'ocean', name: 'North Atlantic', minLat: 0, maxLat: 75, minLon: -80, maxLon: 20, centerLat: 35, centerLon: -40 },
  { id: 'south_atlantic', type: 'ocean', name: 'South Atlantic', minLat: -70, maxLat: 0, minLon: -70, maxLon: 20, centerLat: -25, centerLon: -20 },
  { id: 'indian', type: 'ocean', name: 'Indian Ocean', minLat: -50, maxLat: 30, minLon: 20, maxLon: 120, centerLat: -10, centerLon: 70 },
  { id: 'arctic', type: 'ocean', name: 'Arctic Ocean', minLat: 70, maxLat: 90, minLon: -180, maxLon: 180, centerLat: 82, centerLon: 0 },
  { id: 'southern_ocean', type: 'ocean', name: 'Southern Ocean', minLat: -90, maxLat: -60, minLon: -180, maxLon: 180, centerLat: -70, centerLon: 0 },
]

const CONTINENTS: BoundingBox[] = [
  { id: 'north_america', type: 'land', name: 'North America', minLat: 7, maxLat: 84, minLon: -170, maxLon: -50, centerLat: 45, centerLon: -100 },
  { id: 'south_america', type: 'land', name: 'South America', minLat: -56, maxLat: 15, minLon: -82, maxLon: -34, centerLat: -15, centerLon: -60 },
  { id: 'europe', type: 'land', name: 'Europe', minLat: 35, maxLat: 72, minLon: -25, maxLon: 50, centerLat: 54, centerLon: 15 },
  { id: 'africa', type: 'land', name: 'Africa', minLat: -35, maxLat: 37, minLon: -20, maxLon: 55, centerLat: 0, centerLon: 20 },
  { id: 'asia', type: 'land', name: 'Asia', minLat: -12, maxLat: 78, minLon: 50, maxLon: 150, centerLat: 40, centerLon: 95 },
  { id: 'oceania', type: 'land', name: 'Oceania', minLat: -50, maxLat: 10, minLon: 110, maxLon: 180, centerLat: -25, centerLon: 140 },
  { id: 'antarctica', type: 'land', name: 'Antarctica', minLat: -90, maxLat: -60, minLon: -180, maxLon: 180, centerLat: -80, centerLon: 0 },
]

const OCEAN_STATION_TYPES: Set<StationType> = new Set(['buoy', 'argo_float', 'bgc_argo_float', 'carbon_station'])
const LAND_STATION_TYPES: Set<StationType> = new Set(['weather_station'])

function normalizeLon(lon: number): number {
  if (lon < -180) return lon + 360
  if (lon > 180) return lon - 360
  return lon
}

function pointInBox(lat: number, lon: number, box: BoundingBox): boolean {
  const normLon = normalizeLon(lon)
  const minLon = normalizeLon(box.minLon)
  const maxLon = normalizeLon(box.maxLon)

  if (lat < box.minLat || lat > box.maxLat) return false

  if (minLon <= maxLon) {
    return normLon >= minLon && normLon <= maxLon
  }
  return normLon >= minLon || normLon <= maxLon
}

export function classifyOceanBasin(lat: number, lon: number): OceanBasin | null {
  for (const box of OCEAN_BASINS) {
    if (pointInBox(lat, lon, box)) return box.id as OceanBasin
  }
  return null
}

export function classifyContinent(lat: number, lon: number): Continent | null {
  for (const box of CONTINENTS) {
    if (pointInBox(lat, lon, box)) return box.id as Continent
  }
  return null
}

export function classifyRegion(
  lat: number,
  lon: number,
  stationType?: StationType,
): RegionClassification | null {
  if (stationType && OCEAN_STATION_TYPES.has(stationType)) {
    const basin = classifyOceanBasin(lat, lon)
    if (basin) {
      const box = OCEAN_BASINS.find((b) => b.id === basin)!
      return { regionId: basin, regionType: 'ocean', name: box.name, centerLat: box.centerLat, centerLon: box.centerLon }
    }
  }

  if (stationType && LAND_STATION_TYPES.has(stationType)) {
    const continent = classifyContinent(lat, lon)
    if (continent) {
      const box = CONTINENTS.find((b) => b.id === continent)!
      return { regionId: continent, regionType: 'land', name: box.name, centerLat: box.centerLat, centerLon: box.centerLon }
    }
  }

  const basin = classifyOceanBasin(lat, lon)
  if (basin && (!stationType || !LAND_STATION_TYPES.has(stationType))) {
    const box = OCEAN_BASINS.find((b) => b.id === basin)!
    return { regionId: basin, regionType: 'ocean', name: box.name, centerLat: box.centerLat, centerLon: box.centerLon }
  }

  const continent = classifyContinent(lat, lon)
  if (continent) {
    const box = CONTINENTS.find((b) => b.id === continent)!
    return { regionId: continent, regionType: 'land', name: box.name, centerLat: box.centerLat, centerLon: box.centerLon }
  }

  return null
}

export const ALL_OCEAN_BASINS = OCEAN_BASINS
export const ALL_CONTINENTS = CONTINENTS
