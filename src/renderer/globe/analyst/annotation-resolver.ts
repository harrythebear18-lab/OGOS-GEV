/**
 * Annotation Resolver — resolves place names to coordinates + OSM footprint rings.
 * Adapted from GEV's annotationResolver pattern.
 *
 * Uses Nominatim geocoding (free, no key) and Overpass for building/area outlines.
 * Caches positive results indefinitely, negative results with TTL.
 */

import type { LngLat } from '@shared/types'

export interface AnnotationTarget {
  lon: number
  lat: number
  height: number
  ring: [number, number][] | null  // [lon, lat] pairs
  label: string | null
  source: string
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const geocodeCache = new Map<string, { value: AnnotationTarget | null; at: number }>()
const footprintCache = new Map<string, { value: [number, number][] | null; at: number }>()
const NEG_CACHE_TTL_MS = 60_000

function cacheRead(cache: Map<string, { value: any; at: number }>, key: string): any {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.value !== null) return entry.value
  if (Date.now() - entry.at <= NEG_CACHE_TTL_MS) return null
  cache.delete(key)
  return undefined
}

function cacheWrite(cache: Map<string, { value: any; at: number }>, key: string, value: any): void {
  cache.set(key, { value, at: Date.now() })
}

/** Geocode a place name to a coordinate using Nominatim */
export async function geocodePlace(name: string): Promise<AnnotationTarget | null> {
  const cached = cacheRead(geocodeCache, name)
  if (cached !== undefined) return cached

  try {
    const params = new URLSearchParams({
      q: name,
      format: 'json',
      limit: '1',
      'accept-language': 'en',
    })
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': 'OSINT-Sentinel-Workstation/0.5' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      cacheWrite(geocodeCache, name, null)
      return null
    }
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) {
      cacheWrite(geocodeCache, name, null)
      return null
    }
    const hit = data[0]
    const target: AnnotationTarget = {
      lon: parseFloat(hit.lon),
      lat: parseFloat(hit.lat),
      height: 0,
      ring: null,
      label: hit.display_name || name,
      source: 'nominatim',
    }
    cacheWrite(geocodeCache, name, target)
    return target
  } catch {
    return null
  }
}

/** Fetch the OSM outline ring for a place using Overpass */
export async function fetchFootprint(lat: number, lon: number, radiusM = 500): Promise<[number, number][] | null> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
  const cached = cacheRead(footprintCache, key)
  if (cached !== undefined) return cached

  const bbox = `${lat - 0.005},${lon - 0.005},${lat + 0.005},${lon + 0.005}`
  const query = `[out:json][timeout:15];(way(around:${radiusM},${lat},${lon})["building"];way(around:${radiusM},${lat},${lon})["natural"="water"];way(around:${radiusM},${lat},${lon})["leisure"];relation(around:${radiusM},${lat},${lon})["natural"="water"];);out geom;`

  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      const text = await res.text()
      if (!text.startsWith('{')) continue
      const data = JSON.parse(text)
      if (!data.elements?.length) continue

      // Find the largest polygon
      let bestRing: [number, number][] | null = null
      let bestArea = 0
      for (const el of data.elements) {
        if (el.type === 'way' && el.geometry?.length >= 3) {
          const ring: [number, number][] = el.geometry.map((g: any) => [g.lon, g.lat])
          // Rough area via bounding box
          const lons = ring.map((r) => r[0]), lats = ring.map((r) => r[1])
          const area = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats))
          if (area > bestArea) {
            bestArea = area
            bestRing = ring
          }
        }
      }
      cacheWrite(footprintCache, key, bestRing)
      return bestRing
    } catch {
      continue
    }
  }

  cacheWrite(footprintCache, key, null)
  return null
}

/** Resolve an annotation target: geocode + optional footprint */
export async function resolveAnnotationTarget(opts: {
  target?: string
  latitude?: number
  longitude?: number
  footprint?: boolean
}): Promise<AnnotationTarget | null> {
  let lon: number | null = null
  let lat: number | null = null
  let label: string | null = null

  if (opts.latitude != null && opts.longitude != null) {
    lon = Number(opts.longitude)
    lat = Number(opts.latitude)
    label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  } else if (opts.target) {
    const geocoded = await geocodePlace(opts.target)
    if (!geocoded) return null
    lon = geocoded.lon
    lat = geocoded.lat
    label = geocoded.label
  } else {
    return null
  }

  let ring: [number, number][] | null = null
  if (opts.footprint) {
    ring = await fetchFootprint(lat, lon)
  }

  return {
    lon,
    lat,
    height: 0,
    ring,
    label,
    source: opts.target ? 'geocode+overpass' : 'coordinate',
  }
}
