/**
 * Canopy Service — pseudo-LiDAR canopy analysis using DEM + GIBS NDVI.
 * Ported concept from OSINT-Global-OS.
 */

import type { LngLat, CanopyAnalysisRequest, CanopyAnalysisResponse } from '@shared/types'
import { loadTile } from './dem-service'
import { lngLatToTile } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'

const DEM_ZOOM = 12

/** Fetch NDVI from GIBS WMS single-pixel request. */
async function fetchNdvi(lng: number, lat: number, date: string): Promise<number> {
  const bbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_NDVI_8Day&CRS=EPSG:4326&BBOX=${bbox}&WIDTH=1&HEIGHT=1&FORMAT=image/png&TIME=${date}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return 0.5
    const buf = Buffer.from(await res.arrayBuffer())
    const { PNG } = await import('pngjs')
    const png = PNG.sync.read(buf)
    const r = png.data[0]
    const g = png.data[1]
    // NDVI palette: green = high NDVI, tan = low
    return Math.max(0, Math.min(1, g / 255))
  } catch {
    return 0.5
  }
}

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export async function analyzeCanopy(req: CanopyAnalysisRequest): Promise<CanopyAnalysisResponse> {
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

  // Sample NDVI on a coarse grid (every 16 cells) to limit API calls
  const date = yesterdayISO()
  const sampleStep = Math.max(8, Math.floor(width / 20))

  const cells: { lng: number; lat: number; ndvi: number; elev: number | null }[] = []
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const lng = sw.lng + x * lngStep
      const lat = ne.lat - y * latStep
      const elev = grid[y]?.[x] ?? null
      const ndvi = await fetchNdvi(lng, lat, date)
      cells.push({ lng, lat, ndvi, elev })
    }
  }

  // Cluster low-NDVI zones (defoliation / clearing)
  const zones: CanopyAnalysisResponse['zones'] = []
  let zoneId = 0
  const lowNdvi = cells.filter((c) => c.ndvi < 0.3)
  const visited = new Set<number>()

  for (let i = 0; i < lowNdvi.length; i++) {
    if (visited.has(i)) continue
    const cluster: typeof cells = []
    const stack = [i]
    while (stack.length > 0) {
      const idx = stack.pop()!
      if (visited.has(idx)) continue
      visited.add(idx)
      cluster.push(lowNdvi[idx])
      for (let j = 0; j < lowNdvi.length; j++) {
        if (visited.has(j)) continue
        const d = Math.sqrt(
          ((lowNdvi[j].lng - lowNdvi[idx].lng) / lngStep) ** 2 +
          ((lowNdvi[j].lat - lowNdvi[idx].lat) / latStep) ** 2,
        )
        if (d < sampleStep * 2) stack.push(j)
      }
    }
    if (cluster.length < 2) continue

    const lngs = cluster.map((c) => c.lng)
    const lats = cluster.map((c) => c.lat)
    const avgNdvi = cluster.reduce((a, c) => a + c.ndvi, 0) / cluster.length

    zones.push({
      id: `canopy-${zoneId++}`,
      coords: [
        { lng: Math.min(...lngs), lat: Math.min(...lats) },
        { lng: Math.max(...lngs), lat: Math.min(...lats) },
        { lng: Math.max(...lngs), lat: Math.max(...lats) },
        { lng: Math.min(...lngs), lat: Math.max(...lats) },
      ],
      type: avgNdvi < 0.15 ? 'clearing' : 'defoliation',
      avgNdvi,
      severity: 1 - avgNdvi,
    })
  }

  return { zones, bounds }
}
