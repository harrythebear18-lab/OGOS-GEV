/**
 * Case Profile Service — preloaded scenarios for testing.
 * Ported from OSINT-Global-OS.
 *
 * Currently supports:
 *  - "m-cave": Kenny Veach / M Cave case
 *    Preloaded area, LKP, end point, and known markers around the
 *    Nellis Air Force Range / Sheep Mountain area where Kenny disappeared
 *    while searching for the "M Cave" he described on YouTube.
 *
 *  - "custom": User-defined (default mode)
 */

import type { LngLat } from '@shared/types'

export interface CaseMarker {
  id: string
  label: string
  coord: LngLat
  description: string
  color: string
}

export interface CaseProfile {
  id: string
  name: string
  description: string
  /** Bounding box for the analysis area [SW, NE]. */
  bounds: [LngLat, LngLat]
  /** Last Known Point (trailhead / starting location). */
  lkp: LngLat
  /** Likely destination or end point. */
  endPoint: LngLat
  /** Known markers to display on the map. */
  markers: CaseMarker[]
  /** Initial map center. */
  center: LngLat
  /** Initial zoom. */
  zoom: number
}

/**
 * M Cave / Kenny Veach case profile.
 *
 * Kenny Veach disappeared in November 2014 while searching for a cave
 * he described in a YouTube comment. He was last known to be heading
 * toward the Sheep Mountain area near the Nellis Air Force Range boundary.
 *
 * Coordinates are approximate based on public information.
 */
const M_CAVE_PROFILE: CaseProfile = {
  id: 'm-cave',
  name: 'M Cave (Kenny Veach)',
  description:
    'Kenny Veach disappeared Nov 2014 while searching for the "M Cave" ' +
    'near Sheep Mountain / Nellis Range boundary. Preloaded with approximate ' +
    'LKP, search area, and known points of interest.',
  bounds: [
    { lng: -115.35, lat: 36.45 }, // SW
    { lng: -115.15, lat: 36.62 }, // NE
  ],
  lkp: { lng: -115.24, lat: 36.52 },
  endPoint: { lng: -115.28, lat: 36.58 },
  center: { lng: -115.25, lat: 36.55 },
  zoom: 12,
  markers: [
    {
      id: 'trailhead',
      label: 'Likely Trailhead',
      coord: { lng: -115.24, lat: 36.52 },
      description: 'Approximate starting point where Kenny began his hike',
      color: '#00ff88',
    },
    {
      id: 'sheep-mtn',
      label: 'Sheep Mountain',
      coord: { lng: -115.27, lat: 36.57 },
      description: 'Sheep Mountain area — prominent terrain feature near the search area',
      color: '#ffaa00',
    },
    {
      id: 'nellis-boundary',
      label: 'Nellis Range Boundary',
      coord: { lng: -115.30, lat: 36.55 },
      description: 'Boundary of Nellis Air Force Range — restricted area, may have deterred travel',
      color: '#ff3333',
    },
    {
      id: 'search-area',
      label: 'Reported Search Area',
      coord: { lng: -115.26, lat: 36.55 },
      description: 'General area where search teams focused efforts',
      color: '#00aaff',
    },
  ],
}

const CUSTOM_PROFILE: CaseProfile = {
  id: 'custom',
  name: 'Custom Area',
  description: 'User-defined area. Draw a bounding box and place your own points.',
  bounds: [
    { lng: 0, lat: 0 },
    { lng: 0, lat: 0 },
  ],
  lkp: { lng: 0, lat: 0 },
  endPoint: { lng: 0, lat: 0 },
  center: { lng: 0, lat: 0 },
  zoom: 9,
  markers: [],
}

export const CASE_PROFILES: CaseProfile[] = [CUSTOM_PROFILE, M_CAVE_PROFILE]

export function getCaseProfile(id: string): CaseProfile | null {
  return CASE_PROFILES.find((p) => p.id === id) ?? null
}
