/**
 * Satellite Imagery Service — NASA GIBS (Global Imagery Browse Services).
 * Ported from OSINT-Global-OS. No API key required.
 *
 * Endpoint: https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/
 * Format:   {layer}/default/{time}/{TileMatrixSet}/{z}/{y}/{x}.{format}
 *
 * Note: GIBS WMTS requires standard tile matrix set IDs (GoogleMapsCompatible_LevelN),
 * not resolution aliases like "250m". The date "default" returns the latest available.
 */

import type { LngLat, GIBSLayer, SentinelScene, SentinelRequest, SentinelResponse } from '@shared/types'

export const GIBS_LAYERS: GIBSLayer[] = [
  {
    id: 'modis-true-color',
    name: 'MODIS True Color',
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    format: 'jpeg',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    temporalResolution: 'Daily',
    description: 'Terra MODIS true color — daily, 250m resolution',
    category: 'true-color',
  },
  {
    id: 'modis-bands-721',
    name: 'MODIS 7-2-1 (Vegetation)',
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_Bands721',
    format: 'jpeg',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    temporalResolution: 'Daily',
    description: 'False color — vegetation appears green, water black, burn scars red',
    category: 'false-color',
  },
  {
    id: 'viirs-true-color',
    name: 'VIIRS True Color',
    gibsLayer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    format: 'jpeg',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxZoom: 9,
    temporalResolution: 'Daily',
    description: 'Suomi NPP VIIRS true color — daily, 300m resolution',
    category: 'true-color',
  },
  {
    id: 'viirs-dnb',
    name: 'VIIRS Day/Night',
    gibsLayer: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance',
    format: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level8',
    maxZoom: 8,
    temporalResolution: 'Daily',
    description: 'Nighttime lights — useful for detecting remote activity',
    category: 'true-color',
  },
  {
    id: 'landsat-weld',
    name: 'Landsat WELD',
    gibsLayer: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual',
    format: 'jpeg',
    tileMatrixSet: 'GoogleMapsCompatible_Level12',
    maxZoom: 12,
    temporalResolution: 'Annual',
    description: 'Landsat annual mosaic — 30m resolution, cloud-free composite',
    category: 'true-color',
  },
  {
    id: 'modis-lst-night',
    name: 'Land Surface Temp (Night)',
    gibsLayer: 'MODIS_Aqua_Land_Surface_Temp_Night',
    format: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxZoom: 8,
    temporalResolution: 'Daily',
    description: 'Aqua MODIS nighttime land surface temperature — thermal',
    category: 'thermal',
  },
]

const GIBS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

function buildGibsTileUrl(layer: GIBSLayer, date: string): string {
  return `${GIBS_BASE}/${layer.gibsLayer}/default/${date}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.format}`
}

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export function getGibsLayerById(id: string): GIBSLayer | undefined {
  return GIBS_LAYERS.find((l) => l.id === id)
}

export function buildLayerTileUrl(layerId: string, date?: string): string {
  const layer = getGibsLayerById(layerId) ?? GIBS_LAYERS[0]
  return buildGibsTileUrl(layer, date ?? yesterdayISO())
}

export async function searchSentinelScenes(req: SentinelRequest): Promise<SentinelResponse> {
  const [sw, ne] = req.bounds
  const targetDate = req.date ?? yesterdayISO()
  const limit = req.limit ?? 5

  const layer = req.layerId
    ? getGibsLayerById(req.layerId) ?? GIBS_LAYERS[0]
    : GIBS_LAYERS[0]

  const tileUrl = buildGibsTileUrl(layer, targetDate)

  const best: SentinelScene = {
    id: layer.id,
    tileUrl,
    date: targetDate,
    cloudCover: 0,
    bounds: [
      { lng: sw.lng, lat: sw.lat },
      { lng: ne.lng, lat: ne.lat },
    ],
    isImageOverlay: false,
    maxZoom: layer.maxZoom,
  }

  const scenes: SentinelScene[] = GIBS_LAYERS.slice(0, limit).map((l) => ({
    id: l.id,
    tileUrl: buildGibsTileUrl(l, targetDate),
    date: targetDate,
    cloudCover: 0,
    bounds: [
      { lng: sw.lng, lat: sw.lat },
      { lng: ne.lng, lat: ne.lat },
    ],
    isImageOverlay: false,
    maxZoom: l.maxZoom,
  }))

  return { layers: GIBS_LAYERS, best, scenes }
}
