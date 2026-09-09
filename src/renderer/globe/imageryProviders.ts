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
    maximumLevel: 19,
    credit: new Cesium.Credit('Esri World Imagery (includes Sentinel-2)'),
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
