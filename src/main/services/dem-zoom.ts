/**
 * DEM Zoom Utility — picks the optimal zoom level for a bounding box
 * to stay within a tile budget. Ported from OSINT-Global-OS.
 */

import { lngLatToTile } from './dem-tiles'
import type { LngLat } from '@shared/types'

const DEFAULT_MAX_TILES_PER_DIM = 64

export function computeOptimalZoom(
  bounds: [LngLat, LngLat],
  preferredZoom: number = 15,
  maxTilesPerDim: number = DEFAULT_MAX_TILES_PER_DIM,
): number {
  const [sw, ne] = bounds
  let zoom = preferredZoom

  while (zoom > 0) {
    const minTile = lngLatToTile(sw.lng, ne.lat, zoom)
    const maxTile = lngLatToTile(ne.lng, sw.lat, zoom)
    const tilesX = maxTile.x - minTile.x + 1
    const tilesY = maxTile.y - minTile.y + 1

    if (tilesX <= maxTilesPerDim && tilesY <= maxTilesPerDim) return zoom
    zoom--
  }

  return 0
}

export function estimateCellSizeM(zoom: number, lat: number): number {
  return (40075000 * Math.cos((lat * Math.PI) / 180)) / (256 * Math.pow(2, zoom))
}
