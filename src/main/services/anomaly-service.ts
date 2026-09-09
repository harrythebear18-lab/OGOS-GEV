/**
 * Anomaly Service — terrain anomaly detection via box-blur residuals.
 * Ported from OSINT-Global-OS.
 */

import type { LngLat, AnomalyAnalysisRequest, AnomalyAnalysisResponse, AnomalyZone, AnalysisMode } from '@shared/types'
import { loadTile, type DemTile } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const STD_DEV_THRESHOLD = 2.5
const BLUR_RADIUS = 5

function boxBlur(grid: (number | null)[][], width: number, height: number): number[][] {
  const blurred: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; dy++) {
        for (let dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const v = grid[ny]?.[nx]
            if (v != null) {
              sum += v
              count++
            }
          }
        }
      }
      row.push(count > 0 ? sum / count : 0)
    }
    blurred.push(row)
  }
  return blurred
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
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
  const cellSizeM = lngSpanM / width
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  return { grid, width, height, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

export async function analyzeAnomalyArea(req: AnomalyAnalysisRequest): Promise<AnomalyAnalysisResponse> {
  const { bounds, threshold, demZoom, mode } = req
  const analysisMode: AnalysisMode = mode || 'active-sar'
  const isLegacy = analysisMode === 'legacy-research'
  const zoom = demZoom ?? DEFAULT_ZOOM

  const defaultThreshold = isLegacy ? STD_DEV_THRESHOLD * 0.7 : STD_DEV_THRESHOLD
  const stdThreshold = threshold ?? defaultThreshold

  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } = await loadDemGridArea(bounds, zoom)

  const smoothed = boxBlur(grid, width, height)

  const residuals: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      row.push((grid[y]?.[x] ?? 0) - (smoothed[y]?.[x] ?? 0))
    }
    residuals.push(row)
  }

  const allResiduals = residuals.flat()
  const mean = allResiduals.reduce((a, b) => a + b, 0) / allResiduals.length
  const variance = allResiduals.reduce((a, b) => a + (b - mean) ** 2, 0) / allResiduals.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.1) return { zones: [], bounds }

  const mask: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(residuals[y][x]) > stdThreshold * stdDev) {
        mask[y][x] = true
      }
    }
  }

  const visited = new Uint8Array(width * height)
  const zones: AnomalyZone[] = []
  let zoneId = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || !mask[y][x]) continue

      const cluster: { x: number; y: number; residual: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx] || !mask[p.y][p.x]) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, residual: residuals[p.y][p.x] })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 5) continue

      const minX = Math.min(...cluster.map((c) => c.x))
      const maxX = Math.max(...cluster.map((c) => c.x))
      const minY = Math.min(...cluster.map((c) => c.y))
      const maxY = Math.max(...cluster.map((c) => c.y))
      const avgResidual = cluster.reduce((a, c) => a + c.residual, 0) / cluster.length
      const strength = Math.abs(avgResidual) / stdDev
      const sizeM = Math.max(maxX - minX, maxY - minY) * cellSizeM

      zones.push({
        id: `anomaly-zone-${zoneId++}`,
        coords: [
          { lng: swLng + minX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - maxY * latStep },
          { lng: swLng + minX * lngStep, lat: neLat - maxY * latStep },
        ],
        strength,
        type: avgResidual < 0 ? 'depression' : 'prominence',
        sizeM,
      })
    }
  }

  return { zones, bounds }
}
