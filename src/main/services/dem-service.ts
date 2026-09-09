/**
 * DEM Service — point sampling and elevation profiles.
 * Ported from OSINT-Global-OS.
 */

import type { LngLat, DemProfileResponse, DemProfilePoint } from '@shared/types'
import { loadDemTile, lngLatToTile, lngLatToTilePixel, DEFAULT_ZOOM } from './dem-tiles'

export interface DemTile {
  grid: (number | null)[][]
  width: number
  height: number
  bounds: [LngLat, LngLat]
}

const tileCache = new Map<string, DemTile | null>()

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`
}

async function getTile(z: number, x: number, y: number): Promise<DemTile | null> {
  const key = tileKey(z, x, y)
  if (tileCache.has(key)) return tileCache.get(key) ?? null

  const data = await loadDemTile(z, x, y)
  if (!data) {
    tileCache.set(key, null)
    return null
  }

  const tile: DemTile = {
    grid: data.grid,
    width: data.width,
    height: data.height,
    bounds: data.bounds as [LngLat, LngLat],
  }
  tileCache.set(key, tile)
  return tile
}

export async function sampleElevation(lng: number, lat: number): Promise<number | null> {
  const z = DEFAULT_ZOOM
  const { x, y } = lngLatToTile(lng, lat, z)
  const tile = await getTile(z, x, y)
  if (!tile) return null

  const { px, py } = lngLatToTilePixel(lng, lat, z, x, y, tile.width)
  const row = Math.min(Math.max(py, 0), tile.height - 1)
  const col = Math.min(Math.max(px, 0), tile.width - 1)
  return tile.grid[row]?.[col] ?? null
}

export async function elevationProfile(coords: LngLat[]): Promise<DemProfileResponse> {
  if (coords.length < 2) {
    return { points: [], totalAscent: 0, totalDescent: 0, maxSlopeDeg: 0 }
  }

  const SAMPLE_INTERVAL_M = 30
  const points: DemProfilePoint[] = []
  let totalDistance = 0

  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i]
    const end = coords[i + 1]
    const segLen = haversine(start, end)
    const numSamples = Math.max(2, Math.ceil(segLen / SAMPLE_INTERVAL_M))

    for (let j = 0; j <= numSamples; j++) {
      const t = j / numSamples
      const lng = start.lng + (end.lng - start.lng) * t
      const lat = start.lat + (end.lat - start.lat) * t
      const elev = await sampleElevation(lng, lat)
      const dist = totalDistance + segLen * t
      points.push({ lng, lat, elevation: elev, distance: dist })
    }
    totalDistance += segLen
  }

  let totalAscent = 0
  let totalDescent = 0
  let maxSlopeDeg = 0

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    if (prev.elevation == null || curr.elevation == null) continue

    const dElev = curr.elevation - prev.elevation
    const dDist = curr.distance - prev.distance
    if (dDist <= 0) continue

    if (dElev > 0) totalAscent += dElev
    else totalDescent += Math.abs(dElev)

    const slopeRad = Math.atan2(Math.abs(dElev), dDist)
    const slopeDeg = (slopeRad * 180) / Math.PI
    if (slopeDeg > maxSlopeDeg) maxSlopeDeg = slopeDeg
  }

  return { points, totalAscent, totalDescent, maxSlopeDeg }
}

export async function loadTile(x: number, y: number, z: number): Promise<DemTile> {
  const tile = await getTile(z, x, y)
  if (!tile) throw new Error(`No DEM tile at ${z}/${x}/${y}`)
  return tile
}

function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
