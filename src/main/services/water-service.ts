/**
 * Water Service — fetches water bodies from OpenStreetMap via Overpass API.
 * Ported from OSINT-Global-OS. Free, no key, no auth.
 */

import type { LngLat, WaterFeature, WaterResponse } from '@shared/types'

export type { WaterFeature }

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { ref: number; role: string; type: string; geometry: { lat: number; lon: number }[] }[]
}

export async function fetchWaterFeatures(bounds: [LngLat, LngLat]): Promise<WaterResponse> {
  const [sw, ne] = bounds
  const bbox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`

  const query = `
    [out:json][timeout:30];
    (
      way["natural"="water"](${bbox});
      relation["natural"="water"](${bbox});
      way["waterway"](${bbox});
      node["natural"="spring"](${bbox});
      way["natural"="wetland"](${bbox});
    );
    out geom;
  `

  let lastError: Error | null = null

  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        lastError = new Error(`Overpass ${url} returned ${res.status}`)
        continue
      }

      const data = await res.json()
      const features = parseOverpassResponse(data)
      return { features, bounds }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      continue
    }
  }

  console.error('All Overpass servers failed:', lastError?.message)
  return { features: [], bounds }
}

function parseOverpassResponse(data: { elements?: OverpassElement[] }): WaterFeature[] {
  const features: WaterFeature[] = []
  if (!data.elements) return features

  for (const el of data.elements) {
    if (el.type === 'node') {
      if (el.tags?.natural === 'spring') {
        features.push({
          id: `spring-${el.id}`,
          type: 'spring',
          coords: [{ lng: el.lon ?? 0, lat: el.lat ?? 0 }],
          name: el.tags?.name,
        })
      }
      continue
    }

    if (el.type === 'way' && el.geometry) {
      const coords: LngLat[] = el.geometry.map((g) => ({ lng: g.lon, lat: g.lat }))
      const tags = el.tags || {}
      let type: WaterFeature['type'] = 'stream'

      if (tags.waterway === 'river') type = 'river'
      else if (tags.waterway === 'stream') type = 'stream'
      else if (tags.waterway === 'canal') type = 'stream'
      else if (tags.natural === 'water') {
        type = tags.water === 'lake' ? 'lake' : tags.water === 'pond' ? 'pond' : tags.water === 'reservoir' ? 'reservoir' : 'lake'
      } else if (tags.natural === 'wetland') type = 'wetland'

      features.push({ id: `${el.type}-${el.id}`, type, coords, name: tags.name })
    }

    if (el.type === 'relation' && el.members) {
      for (const member of el.members) {
        if (member.role === 'outer' && member.geometry) {
          const coords: LngLat[] = member.geometry.map((g) => ({ lng: g.lon, lat: g.lat }))
          features.push({
            id: `rel-${el.id}-${member.ref}`,
            type: 'lake',
            coords,
            name: el.tags?.name,
          })
        }
      }
    }
  }

  return features
}

export function waterProximityScore(point: LngLat, features: WaterFeature[], maxDistanceM: number = 500): number {
  if (features.length === 0) return 0

  let minDist = Infinity
  for (const f of features) {
    if (f.type === 'wetland') continue
    for (const c of f.coords) {
      const dist = haversineMeters(point.lng, point.lat, c.lng, c.lat)
      minDist = Math.min(minDist, dist)
    }
  }

  if (minDist === Infinity) return 0
  if (minDist < 50) return 1.0
  if (minDist > maxDistanceM) return 0
  return 1.0 - (minDist / maxDistanceM) * 0.8
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
