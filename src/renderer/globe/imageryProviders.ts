import * as Cesium from 'cesium'
import type { GIBSLayer } from '@shared/types'

/** Build a Cesium imagery provider for a GIBS layer (direct URL, no IPC). */
export function buildGibsProvider(layer: GIBSLayer): Cesium.ImageryProvider {
  const date = 'default'
  const base = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
  const url = `${base}/${layer.gibsLayer}/default/${date}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.format}`

  return new Cesium.UrlTemplateImageryProvider({
    url,
    maximumLevel: layer.maxZoom,
    credit: new Cesium.Credit(`NASA GIBS — ${layer.name}`),
  })
}

/**
 * Esri World Imagery — high-res satellite basemap.
 * Includes Sentinel-2 imagery at zoom levels 13+ for many regions.
 * This is our "Sentinel-2 base layer" — it's the most reliable free
 * satellite imagery source that includes S2 data.
 */
export function buildEsriProvider(): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    // Cap at 17 — level 18-19 tiles are numerous and cause V8 heap exhaustion.
    // Level 17 is ~1m resolution, more than enough for analysis.
    maximumLevel: 17,
    credit: new Cesium.Credit('Esri World Imagery (includes Sentinel-2)'),
  })
}

/**
 * Esri World Transportation — roads, highways, rail.
 * Transparent background. Designed to overlay on top of World Imagery.
 * Ported from OSINT-Global-OS (MapCanvas.tsx esri_transportation layer).
 */
export function buildEsriTransportationProvider(): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 17,
    credit: new Cesium.Credit('Esri World Transportation'),
  })
}

/**
 * Esri World Boundaries and Places — roads, place labels, boundaries.
 * Transparent background. Designed to overlay on top of World Imagery.
 * Ported from OSINT-Global-OS (MapCanvas.tsx esri_reference layer).
 */
export function buildEsriReferenceProvider(): Cesium.ImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 17,
    credit: new Cesium.Credit('Esri World Boundaries and Places'),
  })
}

/**
 * 3D terrain provider — ArcGIS World Elevation (built-in Cesium provider).
 * Uses `fromUrl` async factory. No manual PNG decode — Cesium handles it natively.
 */
export async function buildTerrainProvider(): Promise<Cesium.ArcGISTiledElevationTerrainProvider> {
  return await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
    'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
  )
}

/** Flat ellipsoid terrain — no 3D elevation. */
export function buildFlatTerrain(): Cesium.EllipsoidTerrainProvider {
  return new Cesium.EllipsoidTerrainProvider()
}
