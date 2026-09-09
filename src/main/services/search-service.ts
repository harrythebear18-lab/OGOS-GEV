/**
 * Search Zone Service — probability-weighted search rings around LKP.
 * Ported from OSINT-Global-OS.
 */

import type { LngLat, SearchZonesRequest, SearchZonesResponse, SearchZone } from '@shared/types'
import { sampleElevation } from './dem-service'

function createRing(center: LngLat, radiusM: number): LngLat[] {
  const segments = 64
  const coords: LngLat[] = []
  const latRad = (center.lat * Math.PI) / 180
  const latPerM = 1 / 111320
  const lngPerM = 1 / (111320 * Math.cos(latRad))

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI
    const dLat = radiusM * latPerM * Math.cos(angle)
    const dLng = radiusM * lngPerM * Math.sin(angle)
    coords.push({ lng: center.lng + dLng, lat: center.lat + dLat })
  }
  coords.push({ ...coords[0] })
  return coords
}

async function ringProbability(center: LngLat, radiusM: number): Promise<number> {
  const samplePoints = 16
  let passableCount = 0
  let validSamples = 0

  const latPerM = 1 / 111320
  const lngPerM = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180))

  for (let i = 0; i < samplePoints; i++) {
    const angle = (i / samplePoints) * 2 * Math.PI
    const lng = center.lng + radiusM * lngPerM * Math.sin(angle)
    const lat = center.lat + radiusM * latPerM * Math.cos(angle)

    const elev = await sampleElevation(lng, lat)
    if (elev == null) continue
    validSamples++
    passableCount++
  }

  if (validSamples === 0) return 0.3
  return passableCount / validSamples
}

export async function generateSearchZones(req: SearchZonesRequest): Promise<SearchZonesResponse> {
  const { lkp, radii } = req
  const effectiveRadii = radii ?? [500, 1000, 3000, 5000]

  const zones: SearchZone[] = []
  for (const radius of effectiveRadii) {
    const coords = createRing(lkp, radius)
    const probability = await ringProbability(lkp, radius)
    zones.push({ id: `zone-${radius}`, radius, coords, probability })
  }

  return { zones, lkp }
}
