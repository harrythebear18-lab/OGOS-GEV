/**
 * Runoff Service — DEM hydrology: flow direction, accumulation, streams.
 * Ported concept from OSINT-Global-OS. Uses D8 flow routing.
 */

import type { LngLat, RunoffAnalysisRequest, RunoffAnalysisResponse } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const DEM_ZOOM = 12

export async function analyzeRunoff(req: RunoffAnalysisRequest): Promise<RunoffAnalysisResponse> {
  const { bounds } = req
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

  // D8 flow direction: find steepest downhill neighbor
  const flowDir = new Int8Array(width * height).fill(-1)
  const accumulation = new Float64Array(width * height)

  const idx = (x: number, y: number) => y * width + x
  const dirs = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = grid[y]?.[x]
      if (e == null) continue
      let maxDrop = 0
      let bestDir = -1
      for (let d = 0; d < 8; d++) {
        const nx = x + dirs[d][0]
        const ny = y + dirs[d][1]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const ne2 = grid[ny]?.[nx]
        if (ne2 == null) continue
        const drop = e - ne2
        if (drop > maxDrop) {
          maxDrop = drop
          bestDir = d
        }
      }
      flowDir[idx(x, y)] = bestDir
    }
  }

  // Accumulate flow (simple: each cell contributes 1 unit to its downstream)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      if (flowDir[i] < 0) continue
      accumulation[i] += 1
      let cx = x, cy = y, ci = i
      const visited = new Set<number>()
      while (flowDir[ci] >= 0 && !visited.has(ci)) {
        visited.add(ci)
        const d = flowDir[ci]
        cx += dirs[d][0]
        cy += dirs[d][1]
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) break
        ci = idx(cx, cy)
        accumulation[ci] += 1
      }
    }
  }

  // Extract streams: cells with high accumulation
  const STREAM_THRESHOLD = Math.max(10, width * height * 0.001)
  const flowPaths: LngLat[][] = []
  const visited = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      if (visited[i] || accumulation[i] < STREAM_THRESHOLD) continue
      // Trace upstream
      const path: LngLat[] = []
      let cx = x, cy = y
      while (true) {
        const ci = idx(cx, cy)
        if (visited[ci]) break
        visited[ci] = 1
        path.push({ lng: sw.lng + cx * lngStep, lat: ne.lat - cy * latStep })
        if (flowDir[ci] < 0) break
        const d = flowDir[ci]
        cx += dirs[d][0]
        cy += dirs[d][1]
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) break
      }
      if (path.length > 5) flowPaths.push(path)
    }
  }

  // Pools: local minima with high accumulation
  const pools: RunoffAnalysisResponse['pools'] = []
  let poolId = 0
  for (let y = 1; y < height - 1; y += 4) {
    for (let x = 1; x < width - 1; x += 4) {
      const e = grid[y]?.[x]
      if (e == null) continue
      let isMin = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ne2 = grid[y + dy]?.[x + dx]
          if (ne2 != null && ne2 < e) { isMin = false; break }
        }
        if (!isMin) break
      }
      if (isMin && accumulation[idx(x, y)] > STREAM_THRESHOLD * 0.5) {
        pools.push({
          id: `pool-${poolId++}`,
          coords: [
            { lng: sw.lng + (x - 2) * lngStep, lat: ne.lat - (y - 2) * latStep },
            { lng: sw.lng + (x + 2) * lngStep, lat: ne.lat - (y - 2) * latStep },
            { lng: sw.lng + (x + 2) * lngStep, lat: ne.lat - (y + 2) * latStep },
            { lng: sw.lng + (x - 2) * lngStep, lat: ne.lat - (y + 2) * latStep },
          ],
          depthM: 1,
        })
      }
    }
  }

  // Flood zones: flat areas with high accumulation
  const floodZones: RunoffAnalysisResponse['floodZones'] = []
  let floodId = 0
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      if (accumulation[idx(x, y)] > STREAM_THRESHOLD * 2) {
        floodZones.push({
          id: `flood-${floodId++}`,
          coords: [
            { lng: sw.lng + x * lngStep, lat: ne.lat - y * latStep },
            { lng: sw.lng + (x + 8) * lngStep, lat: ne.lat - y * latStep },
            { lng: sw.lng + (x + 8) * lngStep, lat: ne.lat - (y + 8) * latStep },
            { lng: sw.lng + x * lngStep, lat: ne.lat - (y + 8) * latStep },
          ],
        })
      }
    }
  }

  return { flowPaths: flowPaths.slice(0, 50), pools: pools.slice(0, 20), floodZones: floodZones.slice(0, 20) }
}
