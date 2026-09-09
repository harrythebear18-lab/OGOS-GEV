/**
 * Behavior Engine — simulates likely movement of a missing person.
 * Ported concept from OSINT-Global-OS. Uses terrain-aware random walk
 * with downhill bias (lost people tend to descend).
 */

import type { LngLat, BehaviorEngineRequest, BehaviorEngineResponse } from '@shared/types'
import { sampleElevation } from './dem-service'

const NUM_PATHS = 20
const STEPS_PER_PATH = 60
const STEP_SIZE_M = 100 // 100m per step

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function movePoint(lng: number, lat: number, bearingRad: number, distM: number): { lng: number; lat: number } {
  const latPerM = 1 / 111320
  const lngPerM = 1 / (111320 * Math.cos((lat * Math.PI) / 180))
  return {
    lng: lng + distM * lngPerM * Math.sin(bearingRad),
    lat: lat + distM * latPerM * Math.cos(bearingRad),
  }
}

export async function runBehaviorEngine(req: BehaviorEngineRequest): Promise<BehaviorEngineResponse> {
  const { lkp, hours = 4 } = req
  const totalSteps = Math.min(STEPS_PER_PATH, Math.floor(hours * 3600 / (STEP_SIZE_M / 0.8)))

  const paths: LngLat[][] = []
  const densityMap = new Map<string, number>()

  for (let p = 0; p < NUM_PATHS; p++) {
    const path: LngLat[] = [{ lng: lkp.lng, lat: lkp.lat }]
    let curLng = lkp.lng
    let curLat = lkp.lat
    let bearing = (p / NUM_PATHS) * 2 * Math.PI // spread initial directions

    for (let s = 0; s < totalSteps; s++) {
      // Sample 3 candidate directions, pick the one with lowest elevation (downhill bias)
      const candidates: { bearing: number; elev: number | null }[] = []
      for (let db = -0.5; db <= 0.5; db += 0.25) {
        const b = bearing + db + (Math.random() - 0.5) * 0.3
        const next = movePoint(curLng, curLat, b, STEP_SIZE_M)
        const elev = await sampleElevation(next.lng, next.lat)
        candidates.push({ bearing: b, elev })
      }

      // Pick lowest elevation (downhill) with some randomness
      candidates.sort((a, b) => {
        if (a.elev == null) return 1
        if (b.elev == null) return -1
        return a.elev - b.elev
      })
      const chosen = candidates[Math.floor(Math.random() * Math.min(2, candidates.length))]
      bearing = chosen.bearing

      const next = movePoint(curLng, curLat, bearing, STEP_SIZE_M)
      curLng = next.lng
      curLat = next.lat
      path.push({ lng: curLng, lat: curLat })

      // Accumulate density
      const key = `${Math.floor(curLng * 100)},${Math.floor(curLat * 100)}`
      densityMap.set(key, (densityMap.get(key) ?? 0) + 1)
    }

    paths.push(path)
  }

  // Build density zones from heatmap
  const densityZones: BehaviorEngineResponse['densityZones'] = []
  let zoneId = 0
  const sortedDensity = [...densityMap.entries()].sort((a, b) => b[1] - a[1])
  for (const [key, count] of sortedDensity.slice(0, 10)) {
    const [lngStr, latStr] = key.split(',')
    const lng = parseInt(lngStr) / 100
    const lat = parseInt(latStr) / 100
    densityZones.push({
      id: `density-${zoneId++}`,
      coords: [
        { lng: lng - 0.005, lat: lat - 0.005 },
        { lng: lng + 0.005, lat: lat - 0.005 },
        { lng: lng + 0.005, lat: lat + 0.005 },
        { lng: lng - 0.005, lat: lat + 0.005 },
      ],
      density: count / NUM_PATHS,
    })
  }

  return { paths, densityZones }
}
