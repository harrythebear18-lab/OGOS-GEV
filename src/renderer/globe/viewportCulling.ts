/**
 * Viewport-based entity culling — only show entities within the camera's
 * view rectangle plus a margin. Drastically reduces draw calls and memory
 * when zoomed into a region with global live data feeds.
 *
 * Ported concept from GEV's camera-height-based visibility + OGOS's
 * viewport-aware analysis.
 */

import * as Cesium from 'cesium'

const MARGIN_DEGREES = 5 // show entities 5° beyond viewport edge

/**
 * Check if a lon/lat position is within the current camera view rectangle
 * (plus margin). Returns true if the entity should be visible.
 */
export function isPositionInViewport(
  viewer: Cesium.Viewer,
  lon: number,
  lat: number,
): boolean {
  try {
    const rec = viewer.camera.computeViewRectangle()
    if (!rec) return true // can't compute — show everything

    const west = Cesium.Math.toDegrees(rec.west) - MARGIN_DEGREES
    const east = Cesium.Math.toDegrees(rec.east) + MARGIN_DEGREES
    const south = Cesium.Math.toDegrees(rec.south) - MARGIN_DEGREES
    const north = Cesium.Math.toDegrees(rec.north) + MARGIN_DEGREES

    // Handle antimeridian wrap
    if (west > east) {
      return lon >= west || lon <= east || (lat >= south && lat <= north)
    }
    return lon >= west && lon <= east && lat >= south && lat <= north
  } catch {
    return true // error — show everything (safe default)
  }
}

/**
 * Get the current camera altitude in meters.
 * Used for LOD decisions — hide dense features when zoomed out.
 */
export function getCameraHeight(viewer: Cesium.Viewer): number {
  try {
    return viewer.camera.positionCartographic.height
  } catch {
    return Infinity
  }
}

/**
 * LOD thresholds — at what camera height should each feature type be visible.
 * Below the threshold = hidden (too zoomed out to be useful).
 */
export const LOD_THRESHOLDS = {
  earthquake: 5_000_000,   // show quakes up to 5000km altitude
  fire: 3_000_000,         // show fires up to 3000km
  aircraft: 2_000_000,     // show aircraft up to 2000km
  vessel: 1_500_000,       // show vessels up to 1500km
  lightning: 1_000_000,    // show lightning up to 1000km
  satellite: Infinity,     // always show satellites
} as const

/**
 * Check if a feature type should be visible at the current zoom level.
 */
export function isLODVisible(
  viewer: Cesium.Viewer,
  type: string,
): boolean {
  const height = getCameraHeight(viewer)
  const threshold = (LOD_THRESHOLDS as any)[type] ?? Infinity
  return height <= threshold
}
