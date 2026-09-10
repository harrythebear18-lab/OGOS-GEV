/**
 * Remains Corridor Service — downhill-only search from a fall point.
 *
 * The "Flow" in the Fall → Flow → Find pipeline.
 *
 * From a fall point, traces where a body (or debris) would move
 * under gravity (dry fall) or rainfall-assisted flow.
 *
 * Rule: NO UPHILL MOVEMENT. Everything goes downhill.
 *
 * Outputs:
 *  - Primary path: main gully/channel downhill from fall point
 *  - Secondary paths: branch corridors
 *  - Deposition zones: shelves, basins, snag points, fans, confluences
 *  - Choke points: narrow constrictions where debris gets caught
 *  - Terminal zone: the fan/outlet where the corridor ends
 *
 * Ported from OSINT-Global-OS and adapted to the workstation's DEM service.
 */

import type {
  RemainsCorridorRequest,
  RemainsCorridorResponse,
  CorridorPath,
  DepositionZone,
  ChokePoint,
  LngLat,
} from '@shared/types'
import { isWithinBounds } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

async function loadDemGrid(bounds: [LngLat, LngLat], zoom: number) {
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
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = gridWidthM / width
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  return { grid, width, height, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

/**
 * Trace a downhill path from a starting cell using D8 flow direction.
 * Stops at a local minimum, grid edge, flat area, or maxSteps.
 */
function traceDownhill(
  grid: (number | null)[][],
  startX: number, startY: number,
  width: number, height: number,
  maxSteps: number = 500,
): { x: number; y: number }[] {
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]
  const path: { x: number; y: number }[] = [{ x: startX, y: startY }]
  const visited = new Set<number>()
  visited.add(startY * width + startX)

  let cx = startX
  let cy = startY

  for (let step = 0; step < maxSteps; step++) {
    const elev = grid[cy]?.[cx]
    if (elev == null) break

    let maxDrop = 0
    let nextDir = -1
    for (let d = 0; d < 8; d++) {
      const nx = cx + dx[d]
      const ny = cy + dy[d]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const nIdx = ny * width + nx
      if (visited.has(nIdx)) continue
      const nElev = grid[ny]?.[nx]
      if (nElev == null) continue
      const drop = elev - nElev
      if (drop > maxDrop) {
        maxDrop = drop
        nextDir = d
      }
    }

    if (nextDir < 0 || maxDrop <= 0) break

    cx += dx[nextDir]
    cy += dy[nextDir]
    visited.add(cy * width + cx)
    path.push({ x: cx, y: cy })
  }

  return path
}

function traceCorridorPaths(
  grid: (number | null)[][],
  fallX: number, fallY: number,
  width: number, height: number,
  cellSizeM: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): CorridorPath[] {
  const paths: CorridorPath[] = []
  let pathId = 0

  const primaryCells = traceDownhill(grid, fallX, fallY, width, height)
  if (primaryCells.length >= 2) {
    paths.push({
      id: `corridor-${pathId++}`,
      coords: primaryCells.map((c) => ({ lng: swLng + c.x * lngStep, lat: neLat - c.y * latStep })),
      primary: true,
      accumulation: primaryCells.length,
    })
  }

  const dx = [1, -1, 0, 0, 1, 1, -1, -1]
  const dy = [0, 0, 1, -1, 1, -1, 1, -1]
  for (let d = 0; d < 8; d++) {
    const sx = fallX + dx[d]
    const sy = fallY + dy[d]
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue
    const elev = grid[sy]?.[sx]
    if (elev == null) continue

    const fallElev = grid[fallY]?.[fallX]
    if (fallElev == null || elev >= fallElev) continue

    const cells = traceDownhill(grid, sx, sy, width, height, 200)
    if (cells.length >= 3) {
      const coords = cells.map((c) => ({ lng: swLng + c.x * lngStep, lat: neLat - c.y * latStep }))
      paths.push({
        id: `corridor-${pathId++}`,
        coords,
        primary: false,
        accumulation: cells.length,
      })
    }
  }

  return paths
}

function maxNeighborSlope(grid: (number | null)[][], x: number, y: number, cellSizeM: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0
  let maxS = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      const dist = cellSizeM * Math.sqrt(dx * dx + dy * dy)
      const s = (Math.atan2(Math.abs(n - elev), dist) * 180) / Math.PI
      maxS = Math.max(maxS, s)
    }
  }
  return maxS
}

function localRoughness(grid: (number | null)[][], x: number, y: number): number {
  const vals: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const v = grid[y + dy]?.[x + dx]
      if (v != null) vals.push(v)
    }
  }
  if (vals.length < 2) return 0
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
}

function isLocalMinimum(grid: (number | null)[][], x: number, y: number): boolean {
  const elev = grid[y]?.[x]
  if (elev == null) return false
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n != null && n < elev) return false
    }
  }
  return true
}

function findDepositionZones(
  grid: (number | null)[][],
  paths: CorridorPath[],
  width: number, height: number,
  cellSizeM: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): DepositionZone[] {
  const zones: DepositionZone[] = []
  let zoneId = 0

  for (const path of paths) {
    const sampleInterval = Math.max(3, Math.floor(path.coords.length / 20))

    for (let i = sampleInterval; i < path.coords.length - 1; i += sampleInterval) {
      const coord = path.coords[i]
      const x = Math.round((coord.lng - swLng) / lngStep)
      const y = Math.round((neLat - coord.lat) / latStep)
      if (x < 0 || x >= width || y < 0 || y >= height) continue

      const elev = grid[y]?.[x]
      if (elev == null) continue

      const slope = maxNeighborSlope(grid, x, y, cellSizeM)
      const roughness = localRoughness(grid, x, y)
      const isLocalMin = isLocalMinimum(grid, x, y)

      let type: DepositionZone['type'] | null = null
      let reason = ''
      let priority = 0

      if (isLocalMin) {
        type = 'basin'
        reason = 'Local depression — debris collects here'
        priority = 0.8
      } else if (slope < 5 && i > path.coords.length * 0.7) {
        type = 'fan'
        reason = 'Flattening at base — terminal fan deposition'
        priority = 0.9
      } else if (slope < 10 && slope > 5) {
        type = 'shelf'
        reason = 'Shelf — flat spot on slope catches debris'
        priority = 0.6
      } else if (roughness > 15) {
        type = 'snag'
        reason = 'Rough ground — vegetation/rocks snag debris'
        priority = 0.5
      }

      if (type === null) {
        for (const otherPath of paths) {
          if (otherPath.id === path.id) continue
          for (const oc of otherPath.coords) {
            const dist = haversineMeters(coord.lng, coord.lat, oc.lng, oc.lat)
            if (dist < cellSizeM * 3) {
              type = 'confluence'
              reason = 'Confluence — two gullies meet, debris accumulates'
              priority = 0.7
              break
            }
          }
          if (type) break
        }
      }

      if (type === null) continue

      const radius = cellSizeM * 2
      const latRad = (coord.lat * Math.PI) / 180
      const latPerM = 1 / 111320
      const lngPerM = 1 / (111320 * Math.cos(latRad))
      const polyCoords: LngLat[] = []
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * 2 * Math.PI
        polyCoords.push({
          lng: coord.lng + radius * lngPerM * Math.cos(angle),
          lat: coord.lat + radius * latPerM * Math.sin(angle),
        })
      }

      zones.push({
        id: `deposition-${zoneId++}`,
        coords: polyCoords,
        priority,
        type,
        reason,
      })
    }
  }

  zones.sort((a, b) => b.priority - a.priority)
  const kept: DepositionZone[] = []
  for (const z of zones) {
    const tooClose = kept.some((k) => {
      const kc = k.coords[0]
      const zc = z.coords[0]
      return haversineMeters(kc.lng, kc.lat, zc.lng, zc.lat) < cellSizeM * 5
    })
    if (!tooClose) kept.push(z)
    if (kept.length >= 15) break
  }

  return kept
}

function findChokePoints(
  grid: (number | null)[][],
  paths: CorridorPath[],
  width: number, height: number,
  cellSizeM: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): ChokePoint[] {
  const chokes: ChokePoint[] = []
  let chokeId = 0

  for (const path of paths) {
    if (!path.primary) continue

    for (let i = 5; i < path.coords.length - 5; i += 3) {
      const coord = path.coords[i]
      const x = Math.round((coord.lng - swLng) / lngStep)
      const y = Math.round((neLat - coord.lat) / latStep)
      if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) continue

      const elev = grid[y]?.[x]
      if (elev == null) continue

      const prev = path.coords[i - 1]
      const next = path.coords[i + 1]
      const dirLng = next.lng - prev.lng
      const dirLat = next.lat - prev.lat
      const len = Math.sqrt(dirLng * dirLng + dirLat * dirLat)
      if (len === 0) continue

      const perpLng = -dirLat / len
      const perpLat = dirLng / len

      let leftWall = false
      let rightWall = false
      for (let s = 1; s <= 3; s++) {
        const lx = Math.round(x + perpLng * s * (lngStep > 0 ? 1 / lngStep : 0))
        const ly = Math.round(y - perpLat * s * (latStep > 0 ? 1 / latStep : 0))
        const rx = Math.round(x - perpLng * s * (lngStep > 0 ? 1 / lngStep : 0))
        const ry = Math.round(y + perpLat * s * (latStep > 0 ? 1 / latStep : 0))

        const lElev = grid[ly]?.[lx]
        const rElev = grid[ry]?.[rx]

        if (lElev != null && lElev - elev > 5) leftWall = true
        if (rElev != null && rElev - elev > 5) rightWall = true
      }

      if (leftWall && rightWall) {
        chokes.push({
          id: `choke-${chokeId++}`,
          coord,
          reason: 'Narrow constriction — debris likely caught here',
        })
        i += 10
      }
    }
  }

  return chokes.slice(0, 10)
}

function findTerminalZone(
  paths: CorridorPath[],
  cellSizeM: number,
): RemainsCorridorResponse['terminalZone'] {
  const primary = paths.find((p) => p.primary)
  if (!primary || primary.coords.length < 3) return null

  const end = primary.coords[primary.coords.length - 1]
  const latRad = (end.lat * Math.PI) / 180
  const latPerM = 1 / 111320
  const lngPerM = 1 / (111320 * Math.cos(latRad))
  const radius = cellSizeM * 5

  const coords: LngLat[] = []
  for (let a = 0; a < 16; a++) {
    const angle = (a / 16) * 2 * Math.PI
    coords.push({
      lng: end.lng + radius * lngPerM * Math.cos(angle),
      lat: end.lat + radius * latPerM * Math.sin(angle),
    })
  }

  const areaKm2 = (Math.PI * radius * radius) / 1e6

  return { coords, areaKm2 }
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Main remains corridor analysis.
 */
export async function analyzeRemainsCorridor(req: RemainsCorridorRequest): Promise<RemainsCorridorResponse> {
  const { fallPoint, bounds, rainfallMm, demZoom } = req
  const zoom = demZoom ?? DEFAULT_ZOOM
  const rainfall = rainfallMm ?? 0

  if (!bounds) {
    throw new Error('A bounding box is required for remains corridor analysis.')
  }

  if (!isWithinBounds(fallPoint, bounds)) {
    throw new Error('Fall point is outside the drawn analysis area. Click within the bounding box.')
  }

  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } = await loadDemGrid(bounds, zoom)

  const fallX = Math.min(width - 1, Math.max(0, Math.round((fallPoint.lng - swLng) / lngStep)))
  const fallY = Math.min(height - 1, Math.max(0, Math.round((neLat - fallPoint.lat) / latStep)))

  const paths = traceCorridorPaths(grid, fallX, fallY, width, height, cellSizeM, swLng, neLat, lngStep, latStep)
  const depositionZones = findDepositionZones(grid, paths, width, height, cellSizeM, swLng, neLat, lngStep, latStep)
  const chokePoints = findChokePoints(grid, paths, width, height, cellSizeM, swLng, neLat, lngStep, latStep)
  const terminalZone = findTerminalZone(paths, cellSizeM)

  return {
    paths,
    depositionZones,
    chokePoints,
    terminalZone,
    rainfallMm: rainfall,
  }
}
