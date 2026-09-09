/**
 * Route Service — terrain-aware A* routing.
 * Ported concept from OSINT-Global-OS. Uses Tobler's hiking function
 * for cost, with DEM-derived slope. Real A* over a DEM grid.
 */

import type { LngLat, RoutePlanRequest, RoutePlanResponse } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const DEM_ZOOM = 12

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Tobler's hiking function: speed m/s = 6 * exp(-3.5 * |slope|) */
function toblerSpeed(slopeRad: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(slopeRad))
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
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  return { grid, width, height, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

export async function planRoute(req: RoutePlanRequest): Promise<RoutePlanResponse> {
  const { start, end } = req

  // Build a bounding box around start/end with 20% padding
  const padLat = Math.abs(start.lat - end.lat) * 0.2 + 0.01
  const padLng = Math.abs(start.lng - end.lng) * 0.2 + 0.01
  const bounds: [LngLat, LngLat] = [
    { lng: Math.min(start.lng, end.lng) - padLng, lat: Math.min(start.lat, end.lat) - padLat },
    { lng: Math.max(start.lng, end.lng) + padLng, lat: Math.max(start.lat, end.lat) + padLat },
  ]

  const { grid, width, height, swLng, neLat, lngStep, latStep } = await loadDemGrid(bounds, DEM_ZOOM)

  const startX = Math.floor((start.lng - swLng) / lngStep)
  const startY = Math.floor((neLat - start.lat) / latStep)
  const endX = Math.floor((end.lng - swLng) / lngStep)
  const endY = Math.floor((neLat - end.lat) / latStep)

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return { primary: [start, end], alternatives: [], distanceM: 0, ascentM: 0, descentM: 0 }
  }
  if (endX < 0 || endX >= width || endY < 0 || endY >= height) {
    return { primary: [start, end], alternatives: [], distanceM: 0, ascentM: 0, descentM: 0 }
  }

  // A* over the grid with 8-connectivity
  const visited = new Uint8Array(width * height)
  const gScore = new Float64Array(width * height).fill(Infinity)
  const cameFrom = new Int32Array(width * height).fill(-1)

  const idx = (x: number, y: number) => y * width + x
  const heuristic = (x: number, y: number) => {
    const dx = (endX - x) * lngStep
    const dy = (endY - y) * latStep
    return Math.sqrt(dx * dx + dy * dy) * 111000
  }

  gScore[idx(startX, startY)] = 0
  const open: { x: number; y: number; f: number }[] = [{ x: startX, y: startY, f: heuristic(startX, startY) }]

  const neighbors = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ]

  let iterations = 0
  const MAX_ITER = 200000

  while (open.length > 0 && iterations++ < MAX_ITER) {
    open.sort((a, b) => a.f - b.f)
    const current = open.shift()!
    const ci = idx(current.x, current.y)

    if (current.x === endX && current.y === endY) break
    if (visited[ci]) continue
    visited[ci] = 1

    const currElev = grid[current.y]?.[current.x]
    if (currElev == null) continue

    for (const [dx, dy] of neighbors) {
      const nx = current.x + dx
      const ny = current.y + dy
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const ni = idx(nx, ny)
      if (visited[ni]) continue

      const nextElev = grid[ny]?.[nx]
      if (nextElev == null) continue

      const distM = Math.sqrt(
        ((dx * lngStep) * 111000) ** 2 + ((dy * latStep) * 111000) ** 2,
      )
      const dElev = nextElev - currElev
      const slopeRad = Math.atan2(dElev, distM)
      const speed = Math.max(0.1, toblerSpeed(slopeRad))
      const cost = distM / speed

      const tentative = gScore[ci] + cost
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative
        cameFrom[ni] = ci
        open.push({ x: nx, y: ny, f: tentative + heuristic(nx, ny) })
      }
    }
  }

  // Reconstruct path
  const pathCells: { x: number; y: number }[] = []
  let cur = idx(endX, endY)
  if (gScore[cur] === Infinity) {
    // No path found — return straight line
    return { primary: [start, end], alternatives: [], distanceM: 0, ascentM: 0, descentM: 0 }
  }
  while (cur !== -1) {
    pathCells.push({ x: cur % width, y: Math.floor(cur / width) })
    cur = cameFrom[cur]
  }
  pathCells.reverse()

  const primary: LngLat[] = pathCells.map((c) => ({
    lng: swLng + c.x * lngStep,
    lat: neLat - c.y * latStep,
  }))

  // Compute stats
  let distanceM = 0
  let ascentM = 0
  let descentM = 0
  for (let i = 1; i < primary.length; i++) {
    const d = haversineMeters(primary[i - 1].lng, primary[i - 1].lat, primary[i].lng, primary[i].lat)
    distanceM += d
    const e1 = grid[pathCells[i - 1].y]?.[pathCells[i - 1].x] ?? 0
    const e2 = grid[pathCells[i].y]?.[pathCells[i].x] ?? 0
    const dE = e2 - e1
    if (dE > 0) ascentM += dE
    else descentM += Math.abs(dE)
  }

  return { primary, alternatives: [], distanceM, ascentM, descentM }
}
