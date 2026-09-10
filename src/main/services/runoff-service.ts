/**
 * Runoff Service — DEM hydrology: flow direction, accumulation, streams.
 * Ported concept from OSINT-Global-OS. Uses D8 flow routing.
 *
 * Uses rainfall (mm) to estimate:
 *   - Discharge (L/s) for each flow path
 *   - Pool volume (L) from depression depth × area
 *   - Flash flood risk from discharge × slope
 */

import type { LngLat, RunoffAnalysisRequest, RunoffAnalysisResponse, WatershedDivide } from '@shared/types'
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

export async function analyzeRunoff(req: RunoffAnalysisRequest): Promise<RunoffAnalysisResponse> {
  const { bounds, rainfallMm = 0 } = req
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
  if (width === 0 || height === 0) {
    return { flowPaths: [], pools: [], floodZones: [], watershedDivides: [], rainfallMm }
  }

  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  // Estimate cell size in meters
  const latMid = (sw.lat + ne.lat) / 2
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = gridWidthM / width
  const cellAreaM2 = cellSizeM * cellSizeM

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

  // Accumulate flow (each cell contributes 1 unit to its downstream)
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
  const flowPaths: RunoffAnalysisResponse['flowPaths'] = []
  const visited = new Uint8Array(width * height)
  let pathId = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      if (visited[i] || accumulation[i] < STREAM_THRESHOLD) continue
      // Trace downstream
      const path: LngLat[] = []
      let cx = x, cy = y
      let maxAcc = 0
      while (true) {
        const ci = idx(cx, cy)
        if (visited[ci]) break
        visited[ci] = 1
        maxAcc = Math.max(maxAcc, accumulation[ci])
        path.push({ lng: sw.lng + cx * lngStep, lat: ne.lat - cy * latStep })
        if (flowDir[ci] < 0) break
        const d = flowDir[ci]
        cx += dirs[d][0]
        cy += dirs[d][1]
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) break
      }
      if (path.length > 5) {
        // Estimate discharge: accumulation × cell area × rainfall (mm→m) → liters
        // Assume discharge over 1 hour
        const totalVolumeL = maxAcc * cellAreaM2 * rainfallMm * 0.001
        const dischargeLps = totalVolumeL / 3600
        flowPaths.push({
          id: `flow-${pathId++}`,
          coords: path,
          dischargeLps,
        })
      }
    }
  }

  // Pools: local depressions (flowDir = -1) with flood fill to find depression volume
  const pools: RunoffAnalysisResponse['pools'] = []
  let poolId = 0
  const poolVisited = new Uint8Array(width * height)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y)
      if (poolVisited[i] || flowDir[i] !== -1) continue
      const elev = grid[y]?.[x]
      if (elev == null) continue

      // Flood fill the depression
      const cluster: { x: number; y: number }[] = []
      const stack = [{ x, y }]
      let minRimElev = Infinity

      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = idx(p.x, p.y)
        if (poolVisited[pidx]) continue
        const pElev = grid[p.y]?.[p.x]
        if (pElev == null) continue
        poolVisited[pidx] = 1
        cluster.push({ x: p.x, y: p.y })

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = p.x + dx
            const ny = p.y + dy
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
            const nidx = idx(nx, ny)
            if (flowDir[nidx] === -1 && !poolVisited[nidx]) {
              stack.push({ x: nx, y: ny })
            } else if (flowDir[nidx] !== -1) {
              const nElev = grid[ny]?.[nx]
              if (nElev != null) minRimElev = Math.min(minRimElev, nElev)
            }
          }
        }
      }

      if (cluster.length < 3) continue

      // Pool depth = rim elevation - pool elevation
      const depthM = Math.max(0, minRimElev - elev)
      const poolAreaM2 = cluster.length * cellAreaM2
      const volumeL = poolAreaM2 * depthM * 1000 // m³ → L

      if (volumeL < 100) continue // skip tiny puddles

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const c of cluster) {
        if (c.x < minX) minX = c.x
        if (c.x > maxX) maxX = c.x
        if (c.y < minY) minY = c.y
        if (c.y > maxY) maxY = c.y
      }

      pools.push({
        id: `pool-${poolId++}`,
        coords: [
          { lng: sw.lng + minX * lngStep, lat: ne.lat - minY * latStep },
          { lng: sw.lng + maxX * lngStep, lat: ne.lat - minY * latStep },
          { lng: sw.lng + maxX * lngStep, lat: ne.lat - maxY * latStep },
          { lng: sw.lng + minX * lngStep, lat: ne.lat - maxY * latStep },
        ],
        depthM,
        volumeL,
      })
    }
  }

  // Flood risk zones: high discharge + steep slope = flash flood
  const floodZones: RunoffAnalysisResponse['floodZones'] = []
  let floodId = 0

  for (const path of flowPaths) {
    if (path.coords.length < 3 || path.dischargeLps < 50) continue

    // Compute slope along the path
    let maxSlope = 0
    for (let i = 1; i < path.coords.length; i++) {
      const p1 = path.coords[i - 1]
      const p2 = path.coords[i]
      const distM = haversineMeters(p1.lng, p1.lat, p2.lng, p2.lat)
      if (distM === 0) continue

      const col1 = Math.round((p1.lng - sw.lng) / lngStep)
      const row1 = Math.round((ne.lat - p1.lat) / latStep)
      const col2 = Math.round((p2.lng - sw.lng) / lngStep)
      const row2 = Math.round((ne.lat - p2.lat) / latStep)
      const e1 = grid[row1]?.[col1]
      const e2 = grid[row2]?.[col2]
      if (e1 == null || e2 == null) continue

      const slopeDeg = (Math.atan2(Math.abs(e2 - e1), distM) * 180) / Math.PI
      maxSlope = Math.max(maxSlope, slopeDeg)
    }

    const dischargeRisk = Math.min(1, path.dischargeLps / 500)
    const slopeRisk = Math.min(1, maxSlope / 30)
    const risk = dischargeRisk * 0.6 + slopeRisk * 0.4

    if (risk < 0.3) continue

    let reason: string
    if (maxSlope > 20 && path.dischargeLps > 200) {
      reason = 'Steep channel with high flow — flash flood likely'
    } else if (maxSlope > 20) {
      reason = 'Steep channel — fast runoff after rain'
    } else {
      reason = 'High flow accumulation — flooding possible'
    }

    floodZones.push({
      id: `flood-${floodId++}`,
      coords: path.coords,
      risk,
      reason,
    })
  }

  // Watershed divides: ridge lines separating drainage basins
  const watershedDivides = findWatershedDivides(flowDir, accumulation, height, width, bounds, cellSizeM)

  return {
    flowPaths: flowPaths.slice(0, 50),
    pools: pools.slice(0, 20),
    floodZones: floodZones.slice(0, 20),
    watershedDivides,
    rainfallMm,
  }
}

/**
 * Trace watershed divides: ridge lines that separate drainage basins.
 * Finds cells where neighbors flow away in opposite directions, then
 * clusters connected ridge cells into divide bounding boxes.
 */
function findWatershedDivides(
  dirs: Int8Array,
  acc: Float64Array,
  height: number,
  width: number,
  bounds: [LngLat, LngLat],
  cellSizeM: number,
): WatershedDivide[] {
  const [sw, ne] = bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  // Find ridge cells: cells where neighbors flow away in different directions
  const ridgeCellSet = new Set<number>()
  const ridgeCells: { x: number; y: number }[] = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      if (dirs[idx] < 0) continue

      const outflowDirs = new Set<number>()
      for (let d = 0; d < 8; d++) {
        const nx = x + dx[d]
        const ny = y + dy[d]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const nidx = ny * width + nx
        // If neighbor flows away from us (opposite direction)
        if (dirs[nidx] === ((d + 4) % 8)) {
          outflowDirs.add(Math.floor(d / 2)) // group into 4 quadrants
        }
      }
      if (outflowDirs.size >= 2) {
        ridgeCells.push({ x, y })
        ridgeCellSet.add(idx)
      }
    }
  }

  // Cluster ridge cells into divide lines (simplified: bounding boxes)
  const visited = new Set<number>()
  const divides: WatershedDivide[] = []
  let divideId = 0
  const letters = 'ABCDEFGHIJ'

  for (const cell of ridgeCells) {
    const idx = cell.y * width + cell.x
    if (visited.has(idx)) continue

    const cluster: { x: number; y: number }[] = []
    const stack = [cell]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    while (stack.length > 0) {
      const p = stack.pop()!
      const pidx = p.y * width + p.x
      if (visited.has(pidx)) continue
      visited.add(pidx)
      cluster.push(p)
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y

      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddx = -1; ddx <= 1; ddx++) {
          if (ddx === 0 && ddy === 0) continue
          const nx = p.x + ddx
          const ny = p.y + ddy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const nidx = ny * width + nx
          if (!visited.has(nidx) && ridgeCellSet.has(nidx)) {
            stack.push({ x: nx, y: ny })
          }
        }
      }
    }

    if (cluster.length < 5) continue

    const areaKm2 = (cluster.length * cellSizeM * cellSizeM) / 1e6

    divides.push({
      id: `watershed-${divideId}`,
      coords: [
        { lng: sw.lng + minX * lngStep, lat: ne.lat - minY * latStep },
        { lng: sw.lng + maxX * lngStep, lat: ne.lat - minY * latStep },
        { lng: sw.lng + maxX * lngStep, lat: ne.lat - maxY * latStep },
        { lng: sw.lng + minX * lngStep, lat: ne.lat - maxY * latStep },
      ],
      label: `Watershed ${letters[divideId % letters.length]}`,
      areaKm2,
    })
    divideId++
  }

  return divides.slice(0, 10)
}
