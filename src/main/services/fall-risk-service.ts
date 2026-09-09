/**
 * Fall Risk Service — identifies fall risk zones from slope + curvature.
 * Ported concept from OSINT-Global-OS.
 */

import type { LngLat, FallRiskRequest, FallRiskResponse } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const DEM_ZOOM = 12
const HIGH_RISK_SLOPE = 45
const MODERATE_RISK_SLOPE = 35

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export async function analyzeFallRisk(req: FallRiskRequest): Promise<FallRiskResponse> {
  const bounds = req.bounds ?? (req.route && req.route.length >= 2
    ? [
        { lng: Math.min(...req.route.map((p) => p.lng)) - 0.01, lat: Math.min(...req.route.map((p) => p.lat)) - 0.01 },
        { lng: Math.max(...req.route.map((p) => p.lng)) + 0.01, lat: Math.max(...req.route.map((p) => p.lat)) + 0.01 },
      ] as [LngLat, LngLat]
    : null)

  if (!bounds) return { zones: [] }

  const effectiveZoom = computeOptimalZoom(bounds, DEM_ZOOM, 32)
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
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  // Compute slope grid and cluster high-slope zones
  const visited = new Uint8Array(width * height)
  const zones: FallRiskResponse['zones'] = []
  let zoneId = 0

  const slopeAt = (x: number, y: number): number => {
    const e = grid[y]?.[x]
    if (e == null) return 0
    const e1 = grid[y]?.[x + 1] ?? e
    const e2 = grid[y]?.[x - 1] ?? e
    const e3 = grid[y + 1]?.[x] ?? e
    const e4 = grid[y - 1]?.[x] ?? e
    const dx = Math.abs(e1 - e2) / (lngStep * 111000)
    const dy = Math.abs(e3 - e4) / (latStep * 111000)
    return Math.atan(Math.sqrt(dx * dx + dy * dy)) * (180 / Math.PI)
  }

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const idx = y * width + x
      if (visited[idx]) continue
      const slope = slopeAt(x, y)
      if (slope < MODERATE_RISK_SLOPE) continue

      // Flood fill cluster
      const cluster: { x: number; y: number; slope: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx]) continue
        const s = slopeAt(p.x, p.y)
        if (s < MODERATE_RISK_SLOPE) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, slope: s })
        stack.push({ x: p.x + 4, y: p.y }, { x: p.x - 4, y: p.y }, { x: p.x, y: p.y + 4 }, { x: p.x, y: p.y - 4 })
      }

      if (cluster.length < 3) continue
      const minX = Math.min(...cluster.map((c) => c.x))
      const maxX = Math.max(...cluster.map((c) => c.x))
      const minY = Math.min(...cluster.map((c) => c.y))
      const maxY = Math.max(...cluster.map((c) => c.y))
      const avgSlope = cluster.reduce((a, c) => a + c.slope, 0) / cluster.length

      zones.push({
        id: `fall-risk-${zoneId++}`,
        coords: [
          { lng: sw.lng + minX * lngStep, lat: ne.lat - minY * latStep },
          { lng: sw.lng + maxX * lngStep, lat: ne.lat - minY * latStep },
          { lng: sw.lng + maxX * lngStep, lat: ne.lat - maxY * latStep },
          { lng: sw.lng + minX * lngStep, lat: ne.lat - maxY * latStep },
        ],
        risk: avgSlope > HIGH_RISK_SLOPE ? 'high' : 'moderate',
      })
    }
  }

  return { zones }
}
