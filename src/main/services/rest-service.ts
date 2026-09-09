/**
 * Rest Point Service — predicts where a missing person would stop to rest.
 * Ported from OSINT-Global-OS. Scores slope, water proximity, shelter, distance.
 */

import type { LngLat, RestPointsRequest, RestPointsResponse, RestPoint } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'
import { fetchWaterFeatures, waterProximityScore } from './water-service'
import type { WaterFeature } from '@shared/types'

const BASE_WALK_SPEED_MPS = 0.8
const GRID_SPACING_M = 200
const NMS_RADIUS_M = 500
const SLOPE_MAX_DEG = 25
const MAX_REST_POINTS = 40

interface ScoredCandidate {
  lng: number
  lat: number
  score: number
  reasons: string[]
}

async function loadDemGrid(bounds: [LngLat, LngLat], zoom: number) {
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, effectiveZoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, effectiveZoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  const tileGrids: (number | null)[][][][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    tileGrids[ty] = []
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = await loadTile(minTile.x + tx, minTile.y + ty, effectiveZoom)
      tileGrids[ty][tx] = tile.grid
    }
  }

  const grid: (number | null)[][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let row = 0; row < tileGrids[ty][0].length; row++) {
      const mergedRow: (number | null)[] = []
      for (let tx = 0; tx < tilesX; tx++) {
        const tileRow = tileGrids[ty][tx][row]
        if (tileRow) mergedRow.push(...tileRow)
      }
      grid.push(mergedRow)
    }
  }

  const height = grid.length
  const width = grid[0]?.length ?? 0
  if (width === 0 || height === 0) throw new Error('No elevation data available for this area.')

  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  return { grid, width, height, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

function sampleGrid(
  grid: (number | null)[][], width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  lng: number, lat: number,
): number | null {
  const x = Math.floor((lng - swLng) / lngStep)
  const y = Math.floor((neLat - lat) / latStep)
  if (x < 0 || x >= width || y < 0 || y >= height) return null
  return grid[y]?.[x] ?? null
}

export async function findRestPoints(req: RestPointsRequest): Promise<RestPointsResponse> {
  const { lkp, maxHours = 4, bounds } = req
  const walkRadiusM = BASE_WALK_SPEED_MPS * maxHours * 3600

  let searchBounds: [LngLat, LngLat]
  if (bounds) {
    searchBounds = bounds
  } else {
    const latPerM = 1 / 111320
    const lngPerM = 1 / (111320 * Math.cos((lkp.lat * Math.PI) / 180))
    searchBounds = [
      { lng: lkp.lng - walkRadiusM * lngPerM, lat: lkp.lat - walkRadiusM * latPerM },
      { lng: lkp.lng + walkRadiusM * lngPerM, lat: lkp.lat + walkRadiusM * latPerM },
    ]
  }

  const [sw, ne] = searchBounds
  const { grid, width, height, swLng, neLat, lngStep, latStep } = await loadDemGrid(searchBounds, 12)

  let waterFeatures: WaterFeature[] = []
  try {
    const waterRes = await fetchWaterFeatures(searchBounds)
    waterFeatures = waterRes.features
  } catch { /* neutral water scores */ }

  const latPerM = 1 / 111320
  const lngPerM = 1 / (111320 * Math.cos((lkp.lat * Math.PI) / 180))
  const gridWidthM = (ne.lng - sw.lng) / lngPerM
  const gridHeightM = (ne.lat - sw.lat) / latPerM
  const cols = Math.ceil(gridWidthM / GRID_SPACING_M)
  const rows = Math.ceil(gridHeightM / GRID_SPACING_M)

  const candidates: ScoredCandidate[] = []

  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const lng = sw.lng + (i / cols) * (ne.lng - sw.lng)
      const lat = sw.lat + (j / rows) * (ne.lat - sw.lat)

      const distM = Math.sqrt(((lng - lkp.lng) / lngPerM) ** 2 + ((lat - lkp.lat) / latPerM) ** 2)
      if (distM > walkRadiusM) continue

      const elev = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat)
      if (elev == null) continue

      const e1 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng + 30 * lngPerM, lat)
      const e2 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng - 30 * lngPerM, lat)
      const e3 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat + 30 * latPerM)
      const e4 = sampleGrid(grid, width, height, swLng, neLat, lngStep, latStep, lng, lat - 30 * latPerM)

      let slopeDeg = 0
      if (e1 != null && e2 != null) slopeDeg = Math.max(slopeDeg, Math.atan2(Math.abs(e1 - e2), 60) * (180 / Math.PI))
      if (e3 != null && e4 != null) slopeDeg = Math.max(slopeDeg, Math.atan2(Math.abs(e3 - e4), 60) * (180 / Math.PI))

      if (slopeDeg > SLOPE_MAX_DEG) continue

      const slopeScore = Math.max(0, 1 - slopeDeg / SLOPE_MAX_DEG)
      const waterScore = waterProximityScore({ lng, lat }, waterFeatures)

      const neighborAvg = [e1, e2, e3, e4].filter((v): v is number => v != null)
      const shelterScore = neighborAvg.length > 0
        ? Math.max(0, Math.min(1, 0.5 + (neighborAvg.reduce((a, b) => a + b, 0) / neighborAvg.length - elev) / 10))
        : 0.5

      let distanceScore: number
      if (distM < 200) distanceScore = 0.3
      else if (distM <= 3000) distanceScore = 0.9
      else distanceScore = Math.max(0.2, 0.6 - (distM - 3000) / 5000)

      const score = slopeScore * 0.30 + waterScore * 0.18 + shelterScore * 0.12 + distanceScore * 0.18 + 0.22

      const strongFactors =
        (slopeScore > 0.5 ? 1 : 0) + (waterScore > 0.5 ? 1 : 0) + (shelterScore > 0.55 ? 1 : 0) + (distanceScore > 0.6 ? 1 : 0)
      if (strongFactors < 2) continue
      if (score < 0.25) continue

      const reasons: string[] = []
      if (slopeScore > 0.5) reasons.push(`flat terrain (${slopeDeg.toFixed(0)}°)`)
      if (waterScore > 0.4) reasons.push('near water')
      if (shelterScore > 0.55) reasons.push('sheltered position')
      if (distanceScore > 0.6) reasons.push(`${(distM / 1000).toFixed(1)}km from LKP (rest interval)`)

      candidates.push({ lng, lat, score, reasons })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  const kept: ScoredCandidate[] = []
  for (const c of candidates) {
    if (kept.length >= MAX_REST_POINTS) break
    const tooClose = kept.some(
      (k) => Math.sqrt(((k.lng - c.lng) / lngPerM) ** 2 + ((k.lat - c.lat) / latPerM) ** 2) < NMS_RADIUS_M,
    )
    if (!tooClose) kept.push(c)
  }

  const points: RestPoint[] = kept.map((c, i) => ({
    id: `rest-${i}`,
    lng: c.lng,
    lat: c.lat,
    score: c.score,
    reasons: c.reasons,
  }))

  return { points }
}
