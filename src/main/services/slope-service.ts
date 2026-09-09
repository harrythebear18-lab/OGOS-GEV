/**
 * Slope Service — Horn's method slope computation.
 * Ported from OSINT-Global-OS.
 */

import type { LngLat, SlopeAnalysisRequest, SlopeAnalysisResponse, SlopeBand, ActivityProfile } from '@shared/types'
import { loadTile, type DemTile } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const THRESHOLDS: Record<ActivityProfile, number> = {
  hiking: 35,
  scrambling: 45,
  sar: 50,
}

const SLOPE_LEGEND = [
  { deg: 0, label: 'Flat (0-10°)', color: '#2d8a4e' },
  { deg: 10, label: 'Gentle (10-20°)', color: '#a8c256' },
  { deg: 20, label: 'Moderate (20-30°)', color: '#e8c547' },
  { deg: 30, label: 'Steep (30-35°)', color: '#e8893a' },
  { deg: 35, label: 'Impassable (>35°)', color: '#d93636' },
]

function safeGet(grid: (number | null)[][], x: number, y: number, w: number, h: number): number | null {
  if (x < 0 || x >= w || y < 0 || y >= h) return null
  return grid[y]?.[x] ?? null
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function computeSlopeGrid(tile: DemTile): number[][] {
  const { grid, width, height } = tile
  const [sw, ne] = tile.bounds
  const latMid = (sw.lat + ne.lat) / 2
  const latSpanM = haversineMeters(sw.lng, sw.lat, sw.lng, ne.lat)
  const lngSpanM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeX = lngSpanM / width
  const cellSizeY = latSpanM / height

  const slope: number[][] = []

  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      const nw = safeGet(grid, x - 1, y - 1, width, height)
      const n = safeGet(grid, x, y - 1, width, height)
      const ne2 = safeGet(grid, x + 1, y - 1, width, height)
      const w = safeGet(grid, x - 1, y, width, height)
      const e = safeGet(grid, x + 1, y, width, height)
      const sw2 = safeGet(grid, x - 1, y + 1, width, height)
      const s = safeGet(grid, x, y + 1, width, height)
      const se = safeGet(grid, x + 1, y + 1, width, height)

      if ([nw, n, ne2, w, e, sw2, s, se].some((v) => v == null)) {
        row.push(0)
        continue
      }

      const dzdx = ((ne2 ?? 0) + 2 * (e ?? 0) + (se ?? 0) - (nw ?? 0) - 2 * (w ?? 0) - (sw2 ?? 0)) / (8 * cellSizeX)
      const dzdy = ((sw2 ?? 0) + 2 * (s ?? 0) + (se ?? 0) - (nw ?? 0) - 2 * (n ?? 0) - (ne2 ?? 0)) / (8 * cellSizeY)

      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))
      row.push((slopeRad * 180) / Math.PI)
    }
    slope.push(row)
  }

  return slope
}

async function loadDemGridArea(bounds: [LngLat, LngLat], zoom: number) {
  const [sw, ne] = bounds
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
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
  const latMid = (sw.lat + ne.lat) / 2
  const lngSpanM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const latSpanM = haversineMeters(sw.lng, sw.lat, sw.lng, ne.lat)
  const cellSizeX = lngSpanM / width
  const cellSizeY = latSpanM / height
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  return { grid, width, height, cellSizeX, cellSizeY, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

function clusterSlopeBands(
  slopeGrid: number[][],
  threshold: number,
  width: number, height: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): SlopeBand[] {
  const visited = new Uint8Array(width * height)
  const bands: SlopeBand[] = []
  let bandId = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || (slopeGrid[y]?.[x] ?? 0) < threshold) continue

      const cluster: { x: number; y: number; slope: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx]) continue
        const s = slopeGrid[p.y]?.[p.x]
        if (s == null || s < threshold) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, slope: s })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 3) continue
      const minX = Math.min(...cluster.map((c) => c.x))
      const maxX = Math.max(...cluster.map((c) => c.x))
      const minY = Math.min(...cluster.map((c) => c.y))
      const maxY = Math.max(...cluster.map((c) => c.y))
      const avgSlope = cluster.reduce((a, c) => a + c.slope, 0) / cluster.length

      bands.push({
        id: `slope-band-${bandId++}`,
        coords: [
          { lng: swLng + minX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - maxY * latStep },
          { lng: swLng + minX * lngStep, lat: neLat - maxY * latStep },
        ],
        slopeDeg: avgSlope,
        class: avgSlope > 45 ? 'impassable' : 'steep',
      })
    }
  }
  return bands
}

export async function analyzeSlopeArea(req: SlopeAnalysisRequest): Promise<SlopeAnalysisResponse> {
  const { bounds, profile, demZoom } = req
  const zoom = demZoom ?? DEFAULT_ZOOM
  const activityProfile: ActivityProfile = (profile ?? 'hiking') as ActivityProfile
  const threshold = THRESHOLDS[activityProfile]

  const { grid, width, height, swLng, neLat, lngStep, latStep } = await loadDemGridArea(bounds, zoom)

  const tile: DemTile = { grid, width, height, bounds }
  const slopeGrid = computeSlopeGrid(tile)

  const bands = clusterSlopeBands(slopeGrid, threshold, width, height, swLng, neLat, lngStep, latStep)

  return { grid: slopeGrid, bounds, bands, legend: SLOPE_LEGEND }
}

export { SLOPE_LEGEND, THRESHOLDS as SLOPE_THRESHOLDS }
