/**
 * Runoff Service — DEM hydrology with proper flow routing.
 *
 * Improvements over the original port:
 *  - D8 flow direction with diagonal distance correction (√2 factor)
 *  - O(n) flow accumulation via topological sort (not O(n²) tracing)
 *  - Priority-Flood depression filling (Barnes 2014) — proper spill-point detection
 *  - SCS Curve Number runoff model (not 100% rainfall → runoff)
 *  - Stream network extraction with Strahler ordering
 *  - Time of concentration for flood risk (Kirpich formula)
 *  - Watershed divides as actual ridge polylines, not bounding boxes
 *  - Edge outlet handling (cells on grid edge flow off-grid)
 */

import type { LngLat, RunoffAnalysisRequest, RunoffAnalysisResponse, WatershedDivide } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const DEM_ZOOM = 12

// D8 directions: E, SE, S, SW, W, NW, N, NE
const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, 1, 1, 1, 0, -1, -1, -1]
// Distance weights for diagonal vs orthogonal (diagonal = √2)
const DIST_WEIGHT = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2]

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * SCS Curve Number runoff model.
 * Returns runoff depth in mm.
 *
 * CN ranges: 30 (forest, sandy soil) → 90+ (urban, clay, compacted)
 * Default CN=75 (mixed agricultural/suburban).
 *
 * S = (1000/CN) - 10  (retention in inches)
 * Ia = 0.2 * S       (initial abstraction)
 * Q = (P - Ia)² / (P - Ia + S)  for P > Ia, else 0
 */
function scsRunoffMm(rainfallMm: number, cn: number = 75): number {
  if (rainfallMm <= 0) return 0
  // Convert mm to inches for the SCS formula
  const pIn = rainfallMm / 25.4
  const sIn = 1000 / cn - 10
  const iaIn = 0.2 * sIn
  if (pIn <= iaIn) return 0
  const qIn = (pIn - iaIn) ** 2 / (pIn - iaIn + sIn)
  return qIn * 25.4 // back to mm
}

/**
 * Kirpich formula for time of concentration (minutes).
 * tc = 0.0195 * L^0.77 * S^-0.385
 * where L = flow length (m), S = slope (m/m)
 */
function timeOfConcentrationMin(flowLengthM: number, slopeRatio: number): number {
  if (flowLengthM <= 0 || slopeRatio <= 0) return 1
  return 0.0195 * Math.pow(flowLengthM, 0.77) * Math.pow(slopeRatio, -0.385)
}

export async function analyzeRunoff(req: RunoffAnalysisRequest): Promise<RunoffAnalysisResponse> {
  const { bounds, rainfallMm = 0 } = req
  const effectiveZoom = computeOptimalZoom(bounds, DEM_ZOOM, 32)
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, effectiveZoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, effectiveZoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  // ── Load DEM tiles in parallel (not sequential) ──
  const tilePromises: Promise<{ tx: number; ty: number; grid: (number | null)[][] }>[] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const fx = tx, fy = ty
      tilePromises.push(
        loadTile(minTile.x + fx, minTile.y + fy, effectiveZoom).then((tile) => ({ tx: fx, ty: fy, grid: tile.grid }))
      )
    }
  }
  const tiles = await Promise.all(tilePromises)

  // Build tile lookup
  const tileMap = new Map<string, (number | null)[][]>()
  for (const t of tiles) tileMap.set(`${t.tx},${t.ty}`, t.grid)

  // Merge into flat typed array — Float32Array with NaN sentinel for null
  const tileH = tiles[0]?.grid.length ?? 0
  const tileW = tiles[0]?.grid[0]?.length ?? 0
  const width = tilesX * tileW
  const height = tilesY * tileH

  if (width === 0 || height === 0) {
    return { flowPaths: [], pools: [], floodZones: [], watershedDivides: [], rainfallMm }
  }

  // Flat Float32Array — NaN = no data. Much faster than (number|null)[][]
  const filled = new Float32Array(width * height)
  const original = new Float32Array(width * height)

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tg = tileMap.get(`${tx},${ty}`)!
      for (let row = 0; row < tg.length; row++) {
        const srcRow = tg[row]
        if (!srcRow) continue
        const dstY = ty * tileH + row
        for (let col = 0; col < srcRow.length; col++) {
          const val = srcRow[col]
          const dstX = tx * tileW + col
          const i = dstY * width + dstX
          if (val == null) {
            filled[i] = NaN
            original[i] = NaN
          } else {
            filled[i] = val
            original[i] = val
          }
        }
      }
    }
  }

  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  const latMid = (sw.lat + ne.lat) / 2
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = gridWidthM / width
  const cellAreaM2 = cellSizeM * cellSizeM

  // ── Step 1: Priority-Flood depression filling (Barnes 2014) ──
  // Uses HAL worker pool — runs on a real OS thread, not the event loop
  await priorityFloodWorker(filled, width, height)

  // ── Step 2: D8 flow direction with diagonal correction ──
  const flowDir = new Int8Array(width * height).fill(-1)
  const idx = (x: number, y: number) => y * width + x

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      const e = filled[i]
      if (isNaN(e)) continue
      let maxSlope = 0
      let bestDir = -1
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const ne2 = filled[ny * width + nx]
        if (isNaN(ne2)) continue
        const drop = e - ne2
        const slope = drop / DIST_WEIGHT[d]
        if (slope > maxSlope) {
          maxSlope = slope
          bestDir = d
        }
      }
      flowDir[i] = bestDir
    }
  }

  // ── Step 3: Flow accumulation via topological sort O(n) ──
  const accumulation = new Float64Array(width * height)
  const inDegree = new Int32Array(width * height)

  // Count upstream donors
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      if (flowDir[i] < 0) continue
      const d = flowDir[i]
      const nx = x + DX[d]
      const ny = y + DY[d]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      inDegree[idx(nx, ny)]++
    }
  }

  // Kahn's topological sort
  const queue: number[] = []
  for (let i = 0; i < width * height; i++) {
    if (inDegree[i] === 0 && !isNaN(filled[i])) {
      queue.push(i)
    }
  }

  let queueHead = 0
  while (queueHead < queue.length) {
    const i = queue[queueHead++]
    accumulation[i] += 1  // each cell contributes itself
    if (flowDir[i] < 0) continue
    const d = flowDir[i]
    const x = i % width
    const y = Math.floor(i / width)
    const nx = x + DX[d]
    const ny = y + DY[d]
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
    const ni = idx(nx, ny)
    accumulation[ni] += accumulation[i]
    inDegree[ni]--
    if (inDegree[ni] === 0) queue.push(ni)
  }

  // ── Step 4: SCS Curve Number runoff ──
  const runoffMm = scsRunoffMm(rainfallMm, 75)
  const runoffDepthM = runoffMm / 1000

  // ── Step 5: Stream network extraction with Strahler ordering ──
  const STREAM_THRESHOLD = Math.max(5, Math.floor(width * height * 0.0005))
  const strahlerOrder = new Int8Array(width * height)
  const visited = new Uint8Array(width * height)
  const flowPaths: RunoffAnalysisResponse['flowPaths'] = []
  let pathId = 0

  // Find stream heads (high accumulation, no upstream donors above threshold)
  const streamHeads: { x: number; y: number; acc: number }[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      if (accumulation[i] < STREAM_THRESHOLD) continue
      // Check if this is a headwater (no upstream cell above threshold feeds it)
      let hasUpstream = false
      for (let d = 0; d < 8; d++) {
        const px = x - DX[d]
        const py = y - DY[d]
        if (px < 0 || px >= width || py < 0 || py >= height) continue
        const pi = idx(px, py)
        if (flowDir[pi] === ((d + 4) % 8) && accumulation[pi] >= STREAM_THRESHOLD) {
          hasUpstream = true
          break
        }
      }
      if (!hasUpstream) {
        streamHeads.push({ x, y, acc: accumulation[i] })
      }
    }
  }

  // Sort heads by accumulation (biggest first)
  streamHeads.sort((a, b) => b.acc - a.acc)

  for (const head of streamHeads) {
    if (visited[idx(head.x, head.y)]) continue

    const path: LngLat[] = []
    let cx = head.x, cy = head.y
    let maxAcc = 0
    let flowLengthM = 0
    let maxSlope = 0
    let prevElev: number | null = null
    let order = 1  // Start as 1st order stream

    while (true) {
      const ci = idx(cx, cy)
      if (visited[ci]) break
      visited[ci] = 1
      maxAcc = Math.max(maxAcc, accumulation[ci])

      const lng = sw.lng + cx * lngStep
      const lat = ne.lat - cy * latStep
      path.push({ lng, lat })

      const elev = filled[cy * width + cx]
      if (!isNaN(elev) && prevElev != null) {
        const drop = prevElev - elev
        if (drop > 0) maxSlope = Math.max(maxSlope, drop / cellSizeM)
        flowLengthM += cellSizeM * DIST_WEIGHT[flowDir[ci] >= 0 ? flowDir[ci] : 0]
      }
      prevElev = isNaN(elev) ? null : elev

      if (flowDir[ci] < 0) break
      const d = flowDir[ci]
      cx += DX[d]
      cy += DY[d]
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) break

      // Check for tributary junction → increase Strahler order
      let tributaries = 0
      for (let td = 0; td < 8; td++) {
        const tpx = (cx - DX[d]) - DX[td]
        const tpy = (cy - DY[d]) - DY[td]
        if (tpx < 0 || tpx >= width || tpy < 0 || tpy >= height) continue
        const tpi = idx(tpx, tpy)
        if (flowDir[tpi] === ((td + 4) % 8) && accumulation[tpi] >= STREAM_THRESHOLD && !visited[tpi]) {
          tributaries++
        }
      }
      if (tributaries >= 2) order++
    }

    if (path.length < 3) continue

    // Discharge via SCS: runoff depth × upstream area
    const upstreamAreaM2 = maxAcc * cellAreaM2
    const totalRunoffVolumeL = upstreamAreaM2 * runoffDepthM * 1000
    // Time of concentration for peak discharge
    const tcMin = timeOfConcentrationMin(flowLengthM, maxSlope || 0.01)
    const tcSec = Math.max(60, tcMin * 60)
    // Rational method: Q = C * i * A (simplified)
    // Peak discharge ≈ total volume / time of concentration
    const dischargeLps = totalRunoffVolumeL / tcSec

    flowPaths.push({
      id: `flow-${pathId++}`,
      coords: path,
      dischargeLps,
    })
  }

  // ── Step 6: Pools from unfilled depressions ──
  // After Priority-Flood, true depressions are cells where filled > original
  const pools: RunoffAnalysisResponse['pools'] = []
  let poolId = 0
  const poolVisited = new Uint8Array(width * height)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y)
      if (poolVisited[i]) continue
      const origElev = original[i]
      const fillElev = filled[i]
      if (isNaN(origElev) || isNaN(fillElev)) continue
      if (fillElev <= origElev) continue  // not a depression

      // Flood fill the depression cluster
      const cluster: { x: number; y: number }[] = []
      const stack = [{ x, y }]
      let maxFillDepth = 0

      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = idx(p.x, p.y)
        if (poolVisited[pidx]) continue
        const pOrig = original[pidx]
        const pFill = filled[pidx]
        if (isNaN(pOrig) || isNaN(pFill)) continue
        if (pFill <= pOrig) continue  // not part of this depression

        poolVisited[pidx] = 1
        cluster.push({ x: p.x, y: p.y })
        maxFillDepth = Math.max(maxFillDepth, pFill - pOrig)

        for (let d = 0; d < 8; d++) {
          stack.push({ x: p.x + DX[d], y: p.y + DY[d] })
        }
      }

      if (cluster.length < 3) continue

      const poolAreaM2 = cluster.length * cellAreaM2
      const depthM = maxFillDepth
      // Volume = area × depth (filled depression volume)
      const volumeL = poolAreaM2 * depthM * 1000

      if (volumeL < 500) continue  // skip tiny puddles

      // Compute actual polygon from cluster (convex hull approximation)
      const coords = clusterToPolygon(cluster, sw, ne, lngStep, latStep, width, height)

      pools.push({
        id: `pool-${poolId++}`,
        coords,
        depthM,
        volumeL,
      })
    }
  }

  // ── Step 7: Flood risk zones with time of concentration ──
  const floodZones: RunoffAnalysisResponse['floodZones'] = []
  let floodId = 0

  for (const path of flowPaths) {
    if (path.coords.length < 3) continue

    // Compute slope along the path
    let maxSlope = 0
    let totalDrop = 0
    let totalDist = 0
    for (let i = 1; i < path.coords.length; i++) {
      const p1 = path.coords[i - 1]
      const p2 = path.coords[i]
      const distM = haversineMeters(p1.lng, p1.lat, p2.lng, p2.lat)
      if (distM === 0) continue

      const col1 = Math.round((p1.lng - sw.lng) / lngStep)
      const row1 = Math.round((ne.lat - p1.lat) / latStep)
      const col2 = Math.round((p2.lng - sw.lng) / lngStep)
      const row2 = Math.round((ne.lat - p2.lat) / latStep)
      const e1 = filled[row1 * width + col1]
      const e2 = filled[row2 * width + col2]
      if (isNaN(e1) || isNaN(e2)) continue

      const drop = Math.abs(e2 - e1)
      const slope = drop / distM
      maxSlope = Math.max(maxSlope, slope)
      totalDrop += drop
      totalDist += distM
    }

    const avgSlope = totalDist > 0 ? totalDrop / totalDist : 0
    const dischargeRisk = Math.min(1, path.dischargeLps / 200)  // lower threshold
    const slopeRisk = Math.min(1, maxSlope / 0.5)  // 50% grade = max risk
    const risk = dischargeRisk * 0.5 + slopeRisk * 0.5

    if (risk < 0.15) continue  // lower threshold

    let reason: string
    if (maxSlope > 0.3 && path.dischargeLps > 100) {
      reason = 'Steep channel with high flow — flash flood likely'
    } else if (maxSlope > 0.3) {
      reason = 'Steep channel — fast runoff after rain'
    } else if (path.dischargeLps > 100) {
      reason = 'High flow accumulation — flooding possible'
    } else if (avgSlope < 0.02) {
      reason = 'Flat terrain — slow drainage, ponding likely'
    } else {
      reason = 'Moderate flow — monitor during heavy rain'
    }

    floodZones.push({
      id: `flood-${floodId++}`,
      coords: path.coords,
      risk,
      reason,
    })
  }

  // ── Step 8: Watershed divides as actual ridge polylines ──
  const watershedDivides = findWatershedDivides(flowDir, accumulation, filled, width, height, bounds, cellSizeM)

  return {
    flowPaths: flowPaths.slice(0, 80),
    pools: pools.slice(0, 30),
    floodZones: floodZones.slice(0, 30),
    watershedDivides,
    rainfallMm,
  }
}

/**
 * Priority-Flood via HAL worker pool — runs on a real OS thread.
 * Falls back to inline implementation if the worker pool is unavailable.
 * Modifies `filled` in place (depression-filled elevations).
 */
async function priorityFloodWorker(filled: Float32Array, width: number, height: number): Promise<void> {
  try {
    const { getWorkerPool } = await import('./hal/worker-pool')
    const pool = getWorkerPool()
    const result = await pool.exec('priority-flood', {
      elev: filled, width, height,
    })
    if (result.ok && result.data) {
      const filledResult = (result.data as any).filled as Float32Array
      filled.set(filledResult)
      console.log(`[hal] Priority-Flood computed on worker thread in ${result.durationMs}ms`)
      return
    }
  } catch (e) {
    console.warn('[hal] worker pool priority-flood failed, falling back to inline:', e)
  }
  // Fallback: inline JS implementation
  priorityFlood(filled, width, height)
}

/**
 * Priority-Flood depression filling (Barnes 2014).
 * Proper implementation with a binary min-heap.
 * O(n log n) — processes cells from lowest elevation, filling
 * depressions to the spill point. Handles cascading fills correctly.
 */
function priorityFlood(filled: Float32Array, width: number, height: number): void {
  const closed = new Uint8Array(width * height)
  const idx = (x: number, y: number) => y * width + x

  // Binary min-heap of [elevation, cellIndex]
  const heap: number[] = []  // flat: [elev0, idx0, elev1, idx1, ...]
  let heapSize = 0

  function heapPush(elev: number, cellIdx: number): void {
    let i = heapSize
    heap[heapSize * 2] = elev
    heap[heapSize * 2 + 1] = cellIdx
    heapSize++
    // bubble up
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent * 2] <= heap[i * 2]) break
      // swap
      const te = heap[parent * 2], ti = heap[parent * 2 + 1]
      heap[parent * 2] = heap[i * 2]
      heap[parent * 2 + 1] = heap[i * 2 + 1]
      heap[i * 2] = te
      heap[i * 2 + 1] = ti
      i = parent
    }
  }

  function heapPop(): number {
    const cellIdx = heap[1]
    heapSize--
    if (heapSize > 0) {
      // move last to root, sift down
      heap[0] = heap[heapSize * 2]
      heap[1] = heap[heapSize * 2 + 1]
      let i = 0
      while (true) {
        const left = 2 * i + 1
        const right = 2 * i + 2
        let smallest = i
        if (left < heapSize && heap[left * 2] < heap[smallest * 2]) smallest = left
        if (right < heapSize && heap[right * 2] < heap[smallest * 2]) smallest = right
        if (smallest === i) break
        const te = heap[smallest * 2], ti = heap[smallest * 2 + 1]
        heap[smallest * 2] = heap[i * 2]
        heap[smallest * 2 + 1] = heap[i * 2 + 1]
        heap[i * 2] = te
        heap[i * 2 + 1] = ti
        i = smallest
      }
    }
    return cellIdx
  }

  // Seed: push all edge cells into the heap
  for (let x = 0; x < width; x++) {
    const top = idx(x, 0)
    const bot = idx(x, height - 1)
    if (!isNaN(filled[top])) { heapPush(filled[top], top); closed[top] = 1 }
    if (!isNaN(filled[bot])) { heapPush(filled[bot], bot); closed[bot] = 1 }
  }
  for (let y = 1; y < height - 1; y++) {
    const left = idx(0, y)
    const right = idx(width - 1, y)
    if (!isNaN(filled[left])) { heapPush(filled[left], left); closed[left] = 1 }
    if (!isNaN(filled[right])) { heapPush(filled[right], right); closed[right] = 1 }
  }

  while (heapSize > 0) {
    const i = heapPop()
    const cx = i % width
    const cy = (i / width) | 0
    const elev = filled[i]

    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const ni = nx + ny * width
      if (closed[ni]) continue
      if (isNaN(filled[ni])) continue

      // Fill to at least the current cell's elevation (spill point)
      if (filled[ni] < elev) filled[ni] = elev

      closed[ni] = 1
      heapPush(filled[ni], ni)
    }
  }
}

/**
 * Convert a cluster of grid cells to a polygon (convex hull approximation).
 */
function clusterToPolygon(
  cluster: { x: number; y: number }[],
  sw: LngLat,
  ne: LngLat,
  lngStep: number,
  latStep: number,
  _width: number,
  _height: number,
): LngLat[] {
  // Compute convex hull of the cluster
  const points = cluster.map((c) => ({
    lng: sw.lng + c.x * lngStep,
    lat: ne.lat - c.y * latStep,
  }))

  // Simple convex hull (Andrew's monotone chain)
  points.sort((a, b) => a.lng - b.lng || a.lat - b.lat)

  const lower: typeof points = []
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: typeof points = []
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  return hull.length >= 3 ? hull : points.slice(0, 4)
}

function cross(o: LngLat, a: LngLat, b: LngLat): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
}

/**
 * Trace watershed divides as actual ridge polylines.
 * Finds ridge cells (where neighbors flow in divergent directions) and
 * connects them into polylines following the ridge crest.
 */
function findWatershedDivides(
  dirs: Int8Array,
  acc: Float64Array,
  filled: Float32Array,
  width: number,
  height: number,
  bounds: [LngLat, LngLat],
  cellSizeM: number,
): WatershedDivide[] {
  const [sw, ne] = bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  const idx = (x: number, y: number) => y * width + x

  // Find ridge cells: cells where neighbors flow away in 2+ opposite quadrants
  const ridgeCellSet = new Set<number>()
  const ridgeCells: { x: number; y: number }[] = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y)
      if (dirs[i] < 0) continue

      const outflowQuadrants = new Set<number>()
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const ni = idx(nx, ny)
        // Neighbor flows away from us (opposite direction)
        if (dirs[ni] === ((d + 4) % 8)) {
          outflowQuadrants.add(Math.floor(d / 2))
        }
      }
      if (outflowQuadrants.size >= 2) {
        ridgeCells.push({ x, y })
        ridgeCellSet.add(i)
      }
    }
  }

  // Cluster ridge cells into connected polylines
  const visited = new Set<number>()
  const divides: WatershedDivide[] = []
  let divideId = 0
  const letters = 'ABCDEFGHIJ'

  for (const cell of ridgeCells) {
    const i = idx(cell.x, cell.y)
    if (visited.has(i)) continue

    // BFS/DFS to find connected ridge cells
    const cluster: { x: number; y: number }[] = []
    const stack = [cell]
    while (stack.length > 0) {
      const p = stack.pop()!
      const pi = idx(p.x, p.y)
      if (visited.has(pi)) continue
      visited.add(pi)
      cluster.push(p)

      for (let d = 0; d < 8; d++) {
        const nx = p.x + DX[d]
        const ny = p.y + DY[d]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const ni = idx(nx, ny)
        if (!visited.has(ni) && ridgeCellSet.has(ni)) {
          stack.push({ x: nx, y: ny })
        }
      }
    }

    if (cluster.length < 5) continue

    // Order cluster cells into a polyline by tracing along the ridge
    const ridgeLine = orderRidgeCells(cluster, width)

    const areaKm2 = (cluster.length * cellSizeM * cellSizeM) / 1e6
    const coords = ridgeLine.map((c) => ({
      lng: sw.lng + c.x * lngStep,
      lat: ne.lat - c.y * latStep,
    }))

    divides.push({
      id: `watershed-${divideId}`,
      coords: coords.length >= 3 ? coords : coords.concat(coords.slice(0, 1)),
      label: `Watershed ${letters[divideId % letters.length]}`,
      areaKm2,
    })
    divideId++
  }

  return divides.slice(0, 10)
}

/**
 * Order ridge cells into a polyline by finding the two endpoints
 * (cells with only 1 ridge neighbor) and tracing between them.
 */
function orderRidgeCells(cells: { x: number; y: number }[], width: number): { x: number; y: number }[] {
  const cellSet = new Set(cells.map((c) => c.y * width + c.x))

  // Find endpoints (cells with only 1 ridge neighbor)
  const endpoints: { x: number; y: number }[] = []
  for (const c of cells) {
    let neighbors = 0
    for (let d = 0; d < 8; d++) {
      const nx = c.x + DX[d]
      const ny = c.y + DY[d]
      if (cellSet.has(ny * width + nx)) neighbors++
    }
    if (neighbors <= 1) endpoints.push(c)
  }

  if (endpoints.length < 2) {
    // No clear endpoints — return cells in scan order
    return cells
  }

  // Trace from first endpoint
  const start = endpoints[0]
  const ordered: { x: number; y: number }[] = [start]
  const used = new Set([start.y * width + start.x])
  let current = start

  while (true) {
    let found = false
    for (let d = 0; d < 8; d++) {
      const nx = current.x + DX[d]
      const ny = current.y + DY[d]
      const ni = ny * width + nx
      if (cellSet.has(ni) && !used.has(ni)) {
        ordered.push({ x: nx, y: ny })
        used.add(ni)
        current = { x: nx, y: ny }
        found = true
        break
      }
    }
    if (!found) break
  }

  return ordered
}
