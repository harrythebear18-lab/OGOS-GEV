/**
 * Slope utilities — shared between main process and renderer.
 *
 * These are pure computation functions with no I/O, so they can run
 * in either process. The renderer uses them after the compute dispatcher
 * returns a slope grid.
 */

import type { SlopeBand, ActivityProfile } from './types'

export const SLOPE_THRESHOLDS: Record<ActivityProfile, number> = {
  hiking: 35,
  scrambling: 45,
  sar: 50,
}

export const SLOPE_LEGEND = [
  { deg: 0, label: 'Flat (0-10°)', color: '#2d8a4e' },
  { deg: 10, label: 'Gentle (10-20°)', color: '#a8c256' },
  { deg: 20, label: 'Moderate (20-30°)', color: '#e8c547' },
  { deg: 30, label: 'Steep (30-35°)', color: '#e8893a' },
  { deg: 35, label: 'Impassable (>35°)', color: '#d93636' },
]

/**
 * Cluster a slope grid into bands of contiguous steep areas.
 * Pure computation — no I/O, safe to run in renderer.
 */
export function clusterSlopeBands(
  slopeGrid: Float32Array | number[][],
  threshold: number,
  width: number,
  height: number,
  swLng: number,
  neLat: number,
  lngStep: number,
  latStep: number,
): SlopeBand[] {
  const visited = new Uint8Array(width * height)
  const bands: SlopeBand[] = []
  let bandId = 0

  const getCell = (x: number, y: number): number => {
    if (slopeGrid instanceof Float32Array) {
      return slopeGrid[y * width + x]
    }
    return slopeGrid[y]?.[x] ?? 0
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || getCell(x, y) < threshold) continue

      const cluster: { x: number; y: number; slope: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx]) continue
        const s = getCell(p.x, p.y)
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
