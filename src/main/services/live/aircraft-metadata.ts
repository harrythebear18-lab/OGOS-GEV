/**
 * Aircraft metadata enrichment — derives aircraft type, operator, origin,
 * and registration from callsign and ICAO24 hex using pattern matching.
 *
 * No external fetch needed. Uses:
 *  - ICAO24 hex → country of registration (ICAO allocation ranges)
 *  - Callsign prefix → airline operator (IATA code mapping)
 *  - Callsign length/pattern → flight type (commercial, private, military, cargo)
 *  - Altitude/heading → flight phase (cruise, climb, descent, approach, taxi)
 *
 * Also maintains a track history store for flight trail visualization.
 */

import type { LiveFeature } from '@shared/types'

// ── ICAO24 hex → country (simplified allocation ranges) ──
const ICAO_COUNTRY_RANGES: { prefix: string; mask: number; country: string }[] = [
  { prefix: 'a0', mask: 0xff00, country: 'United States' },
  { prefix: 'a1', mask: 0xff00, country: 'United States' },
  { prefix: 'a2', mask: 0xff00, country: 'United States' },
  { prefix: 'a3', mask: 0xff00, country: 'United States' },
  { prefix: 'a4', mask: 0xff00, country: 'United States' },
  { prefix: 'a5', mask: 0xff00, country: 'United States' },
  { prefix: 'a6', mask: 0xff00, country: 'United States' },
  { prefix: 'a7', mask: 0xff00, country: 'United States' },
  { prefix: 'a8', mask: 0xff00, country: 'United States' },
  { prefix: 'a9', mask: 0xff00, country: 'United States' },
  { prefix: 'aa', mask: 0xff00, country: 'United States' },
  { prefix: 'ab', mask: 0xff00, country: 'United States' },
  { prefix: 'ac', mask: 0xff00, country: 'United States' },
  { prefix: 'ad', mask: 0xff00, country: 'United States' },
  { prefix: 'ae', mask: 0xff00, country: 'United States' },
  { prefix: 'af', mask: 0xff00, country: 'United States' },
  { prefix: '40', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '43', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '44', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '45', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '46', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '47', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '48', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '49', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '4a', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '4b', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '4c', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '4d', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '4e', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '4f', mask: 0xff00, country: 'United Kingdom' },
  { prefix: '38', mask: 0xff00, country: 'France' },
  { prefix: '39', mask: 0xff00, country: 'France' },
  { prefix: '3a', mask: 0xff00, country: 'France' },
  { prefix: '3b', mask: 0xff00, country: 'France' },
  { prefix: '3c', mask: 0xff00, country: 'France' },
  { prefix: '3d', mask: 0xff00, country: 'France' },
  { prefix: '3e', mask: 0xff00, country: 'France' },
  { prefix: '3f', mask: 0xff00, country: 'France' },
  { prefix: '30', mask: 0xff00, country: 'Germany' },
  { prefix: '31', mask: 0xff00, country: 'Germany' },
  { prefix: '32', mask: 0xff00, country: 'Germany' },
  { prefix: '33', mask: 0xff00, country: 'Germany' },
  { prefix: '34', mask: 0xff00, country: 'Germany' },
  { prefix: '35', mask: 0xff00, country: 'Germany' },
  { prefix: '36', mask: 0xff00, country: 'Germany' },
  { prefix: '37', mask: 0xff00, country: 'Germany' },
  { prefix: '80', mask: 0xff00, country: 'Canada' },
  { prefix: '81', mask: 0xff00, country: 'Canada' },
  { prefix: '82', mask: 0xff00, country: 'Canada' },
  { prefix: '83', mask: 0xff00, country: 'Canada' },
  { prefix: '84', mask: 0xff00, country: 'Canada' },
  { prefix: '85', mask: 0xff00, country: 'Canada' },
  { prefix: '86', mask: 0xff00, country: 'Canada' },
  { prefix: '87', mask: 0xff00, country: 'Canada' },
  { prefix: '88', mask: 0xff00, country: 'Canada' },
  { prefix: '89', mask: 0xff00, country: 'Canada' },
  { prefix: '8a', mask: 0xff00, country: 'Canada' },
  { prefix: '8b', mask: 0xff00, country: 'Canada' },
  { prefix: '7c', mask: 0xff00, country: 'Australia' },
  { prefix: '7d', mask: 0xff00, country: 'Australia' },
  { prefix: '7e', mask: 0xff00, country: 'Australia' },
  { prefix: '7f', mask: 0xff00, country: 'Australia' },
  { prefix: '850', mask: 0xfff0, country: 'Japan' },
  { prefix: '840', mask: 0xfff0, country: 'Japan' },
  { prefix: '860', mask: 0xfff0, country: 'Japan' },
  { prefix: '870', mask: 0xfff0, country: 'Japan' },
  { prefix: '71', mask: 0xff00, country: 'Brazil' },
  { prefix: '72', mask: 0xff00, country: 'Brazil' },
  { prefix: '73', mask: 0xff00, country: 'Brazil' },
  { prefix: '74', mask: 0xff00, country: 'Brazil' },
  { prefix: '75', mask: 0xff00, country: 'Brazil' },
  { prefix: '76', mask: 0xff00, country: 'Brazil' },
  { prefix: '77', mask: 0xff00, country: 'Brazil' },
  { prefix: '78', mask: 0xff00, country: 'Brazil' },
  { prefix: '79', mask: 0xff00, country: 'Brazil' },
  { prefix: '7a', mask: 0xff00, country: 'Brazil' },
  { prefix: '7b', mask: 0xff00, country: 'Brazil' },
  { prefix: 'c0', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c1', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c2', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c3', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c4', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c5', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c6', mask: 0xff00, country: 'Netherlands' },
  { prefix: 'c7', mask: 0xff00, country: 'Netherlands' },
  { prefix: '4ca', mask: 0xfff0, country: 'Switzerland' },
  { prefix: '4cb', mask: 0xfff0, country: 'Switzerland' },
  { prefix: '4cc', mask: 0xfff0, country: 'Switzerland' },
  { prefix: '4cd', mask: 0xfff0, country: 'Switzerland' },
  { prefix: '4ce', mask: 0xfff0, country: 'Switzerland' },
  { prefix: '4cf', mask: 0xfff0, country: 'Switzerland' },
  { prefix: 'e0', mask: 0xff00, country: 'Spain' },
  { prefix: 'e1', mask: 0xff00, country: 'Spain' },
  { prefix: 'e2', mask: 0xff00, country: 'Spain' },
  { prefix: 'e3', mask: 0xff00, country: 'Spain' },
  { prefix: 'e4', mask: 0xff00, country: 'Spain' },
  { prefix: 'e5', mask: 0xff00, country: 'Spain' },
  { prefix: 'e6', mask: 0xff00, country: 'Spain' },
  { prefix: 'e7', mask: 0xff00, country: 'Spain' },
  { prefix: 'e8', mask: 0xff00, country: 'Spain' },
  { prefix: 'e9', mask: 0xff00, country: 'Spain' },
  { prefix: 'ea', mask: 0xff00, country: 'Spain' },
  { prefix: 'eb', mask: 0xff00, country: 'Spain' },
  { prefix: 'ec', mask: 0xff00, country: 'Spain' },
  { prefix: 'ed', mask: 0xff00, country: 'Spain' },
  { prefix: 'ee', mask: 0xff00, country: 'Spain' },
  { prefix: 'ef', mask: 0xff00, country: 'Spain' },
  { prefix: 'dd', mask: 0xff00, country: 'Russia' },
  { prefix: 'de', mask: 0xff00, country: 'Russia' },
  { prefix: 'df', mask: 0xff00, country: 'Russia' },
  { prefix: 'd0', mask: 0xff00, country: 'Russia' },
  { prefix: 'd1', mask: 0xff00, country: 'Russia' },
  { prefix: 'd2', mask: 0xff00, country: 'Russia' },
  { prefix: 'd3', mask: 0xff00, country: 'Russia' },
  { prefix: 'd4', mask: 0xff00, country: 'Russia' },
  { prefix: 'd5', mask: 0xff00, country: 'Russia' },
  { prefix: 'd6', mask: 0xff00, country: 'Russia' },
  { prefix: 'd7', mask: 0xff00, country: 'Russia' },
  { prefix: 'd8', mask: 0xff00, country: 'Russia' },
  { prefix: 'd9', mask: 0xff00, country: 'Russia' },
  { prefix: 'da', mask: 0xff00, country: 'Russia' },
  { prefix: 'db', mask: 0xff00, country: 'Russia' },
  { prefix: 'dc', mask: 0xff00, country: 'Russia' },
  { prefix: 'fa', mask: 0xff00, country: 'Italy' },
  { prefix: 'fb', mask: 0xff00, country: 'Italy' },
  { prefix: 'fc', mask: 0xff00, country: 'Italy' },
  { prefix: 'fd', mask: 0xff00, country: 'Italy' },
  { prefix: 'fe', mask: 0xff00, country: 'Italy' },
  { prefix: 'ff', mask: 0xff00, country: 'Italy' },
  { prefix: 'f0', mask: 0xff00, country: 'Italy' },
  { prefix: 'f1', mask: 0xff00, country: 'Italy' },
  { prefix: 'f2', mask: 0xff00, country: 'Italy' },
  { prefix: 'f3', mask: 0xff00, country: 'Italy' },
  { prefix: 'f4', mask: 0xff00, country: 'Italy' },
  { prefix: 'f5', mask: 0xff00, country: 'Italy' },
  { prefix: 'f6', mask: 0xff00, country: 'Italy' },
  { prefix: 'f7', mask: 0xff00, country: 'Italy' },
  { prefix: 'f8', mask: 0xff00, country: 'Italy' },
  { prefix: 'f9', mask: 0xff00, country: 'Italy' },
]

// ── Callsign prefix → airline operator (IATA code mapping) ──
const AIRLINE_PREFIXES: Record<string, { name: string; country: string }> = {
  AAL: { name: 'American Airlines', country: 'United States' },
  UAL: { name: 'United Airlines', country: 'United States' },
  DAL: { name: 'Delta Air Lines', country: 'United States' },
  SWA: { name: 'Southwest Airlines', country: 'United States' },
  JBU: { name: 'JetBlue Airways', country: 'United States' },
  ASA: { name: 'Alaska Airlines', country: 'United States' },
  FFT: { name: 'Frontier Airlines', country: 'United States' },
  NKS: { name: 'Spirit Airlines', country: 'United States' },
  HA: { name: 'Hawaiian Airlines', country: 'United States' },
  ACA: { name: 'Air Canada', country: 'Canada' },
  JZA: { name: 'Jazz Aviation', country: 'Canada' },
  WJA: { name: 'WestJet', country: 'Canada' },
  BAW: { name: 'British Airways', country: 'United Kingdom' },
  VIR: { name: 'Virgin Atlantic', country: 'United Kingdom' },
  EZY: { name: 'easyJet', country: 'United Kingdom' },
  RYR: { name: 'Ryanair', country: 'Ireland' },
  DLH: { name: 'Lufthansa', country: 'Germany' },
  AFR: { name: 'Air France', country: 'France' },
  KLM: { name: 'KLM Royal Dutch Airlines', country: 'Netherlands' },
  AZA: { name: 'ITA Airways', country: 'Italy' },
  IBE: { name: 'Iberia', country: 'Spain' },
  THY: { name: 'Turkish Airlines', country: 'Turkey' },
  UAE: { name: 'Emirates', country: 'United Arab Emirates' },
  ETD: { name: 'Etihad Airways', country: 'United Arab Emirates' },
  QTR: { name: 'Qatar Airways', country: 'Qatar' },
  SIA: { name: 'Singapore Airlines', country: 'Singapore' },
  ANA: { name: 'All Nippon Airways', country: 'Japan' },
  JAL: { name: 'Japan Airlines', country: 'Japan' },
  KAL: { name: 'Korean Air', country: 'South Korea' },
  AAR: { name: 'Asiana Airlines', country: 'South Korea' },
  CCA: { name: 'Air China', country: 'China' },
  CSN: { name: 'China Southern', country: 'China' },
  CES: { name: 'China Eastern', country: 'China' },
  QFA: { name: 'Qantas', country: 'Australia' },
  VOZ: { name: 'Virgin Australia', country: 'Australia' },
  JST: { name: 'Jetstar', country: 'Australia' },
  GLO: { name: 'Gol Transportes', country: 'Brazil' },
  AZU: { name: 'Azul Airlines', country: 'Brazil' },
  LATAM: { name: 'LATAM Airlines', country: 'Chile' },
  AMX: { name: 'Aeromexico', country: 'Mexico' },
  FDX: { name: 'FedEx', country: 'United States' },
  UPS: { name: 'UPS Airlines', country: 'United States' },
  GTI: { name: 'Atlas Air', country: 'United States' },
  GEC: { name: 'DHL Air', country: 'United Kingdom' },
  PAC: { name: 'Polar Air Cargo', country: 'United States' },
  CKS: { name: 'Kalitta Air', country: 'United States' },
  CLX: { name: 'Cargolux', country: 'Luxembourg' },
  NCA: { name: 'Nippon Cargo Airlines', country: 'Japan' },
  // Military
  RCH: { name: 'US Air Force (Reach)', country: 'United States' },
  PAT: { name: 'US Air Force (Patriot)', country: 'United States' },
  CFC: { name: 'Canadian Forces', country: 'Canada' },
  RAF: { name: 'Royal Air Force', country: 'United Kingdom' },
  GAF: { name: 'German Air Force', country: 'Germany' },
  FAF: { name: 'French Air Force', country: 'France' },
}

// ── Track history store (in-memory, per ICAO24) ──
const trackHistory = new Map<string, { lon: number; lat: number; alt: number; timestamp: number }[]>()
const MAX_TRACK_POINTS = 30
const TRACK_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Derive country of registration from ICAO24 hex code. */
export function deriveCountryFromIcao24(icao24: string): string {
  const hex = icao24.toLowerCase()
  const value = parseInt(hex, 16)
  if (isNaN(value)) return 'Unknown'

  for (const range of ICAO_COUNTRY_RANGES) {
    const prefixVal = parseInt(range.prefix, 16)
    if ((value & range.mask) === (prefixVal & range.mask)) {
      return range.country
    }
  }
  return 'Unknown'
}

/** Derive airline operator from callsign prefix (first 3 chars). */
export function deriveAirlineFromCallsign(callsign: string): { name: string; country: string } | null {
  if (!callsign) return null
  // Try 3-char IATA prefix
  const prefix3 = callsign.substring(0, 3).toUpperCase()
  if (AIRLINE_PREFIXES[prefix3]) return AIRLINE_PREFIXES[prefix3]
  // Try longer prefixes (e.g. LATAM)
  for (let len = 6; len >= 4; len--) {
    const p = callsign.substring(0, len).toUpperCase()
    if (AIRLINE_PREFIXES[p]) return AIRLINE_PREFIXES[p]
  }
  return null
}

/** Derive flight type from callsign pattern. */
export function deriveFlightType(callsign: string, icao24: string): string {
  if (!callsign || callsign === icao24) return 'unknown'
  const cs = callsign.toUpperCase()
  // Military patterns
  if (['RCH', 'RAF', 'PAT', 'CFC', 'GAF', 'FAF'].some((m) => cs.startsWith(m))) return 'military'
  // Cargo patterns
  if (['FDX', 'UPS', 'GTI', 'GEC', 'PAC', 'CKS', 'CLX', 'NCA'].some((m) => cs.startsWith(m))) return 'cargo'
  // General aviation (N-number style)
  if (cs.startsWith('N') && cs.length <= 6) return 'general_aviation'
  // Commercial (3-letter IATA + flight number)
  if (/^[A-Z]{2,3}\d/.test(cs)) return 'commercial'
  return 'unknown'
}

/** Derive flight phase from altitude and velocity. */
export function deriveFlightPhase(alt: number | null | undefined, velocity: number | null | undefined): string {
  const a = alt ?? 0
  const v = velocity ?? 0
  if (a < 100 && v < 5) return 'parked'
  if (a < 100 && v < 30) return 'taxi'
  if (a < 3000 && v > 30) return 'takeoff'
  if (a > 3000 && a < 10000 && v > 50) return 'climb'
  if (a >= 10000 && v > 100) return 'cruise'
  if (a > 3000 && a < 10000 && v < 250) return 'descent'
  if (a < 3000 && v < 100) return 'approach'
  if (a < 100) return 'landed'
  return 'unknown'
}

/** Derive a pseudo-registration from ICAO24 hex (country-specific format). */
export function deriveRegistration(icao24: string, country: string): string {
  const hex = icao24.toUpperCase()
  switch (country) {
    case 'United States':
      return `N${hex.substring(2, 6)}`
    case 'United Kingdom':
      return `G-${hex.substring(2, 5)}`
    case 'France':
      return `F-${hex.substring(2, 5)}`
    case 'Germany':
      return `D-${hex.substring(2, 5)}`
    case 'Canada':
      return `C-F${hex.substring(2, 5)}`
    case 'Australia':
      return `VH-${hex.substring(2, 5)}`
    case 'Japan':
      return `JA${hex.substring(2, 6)}`
    case 'Brazil':
      return `PR-${hex.substring(2, 5)}`
    case 'Netherlands':
      return `PH-${hex.substring(2, 5)}`
    case 'Switzerland':
      return `HB-${hex.substring(2, 5)}`
    case 'Spain':
      return `EC-${hex.substring(2, 5)}`
    case 'Italy':
      return `I-${hex.substring(2, 5)}`
    case 'Russia':
      return `RA-${hex.substring(2, 5)}`
    default:
      return hex
  }
}

/** Update track history for an aircraft. Returns the current trail. */
export function updateTrackHistory(icao24: string, lon: number, lat: number, alt: number, timestamp: number): { lon: number; lat: number; alt: number; timestamp: number }[] {
  let track = trackHistory.get(icao24)
  if (!track) {
    track = []
    trackHistory.set(icao24, track)
  }
  track.push({ lon, lat, alt, timestamp })
  // Trim to max points
  if (track.length > MAX_TRACK_POINTS) {
    track.shift()
  }
  // Prune old entries
  const cutoff = timestamp - TRACK_TTL_MS
  while (track.length > 0 && track[0].timestamp < cutoff) {
    track.shift()
  }
  return track
}

/** Get track history for an aircraft. */
export function getTrackHistory(icao24: string): { lon: number; lat: number; alt: number; timestamp: number }[] {
  return trackHistory.get(icao24) || []
}

/** Enrich a LiveFeature aircraft with derived metadata + track history. */
export function enrichAircraft(feature: LiveFeature): LiveFeature {
  const icao24 = (feature.meta.icao24 as string) || ''
  const callsign = (feature.meta.callsign as string) || icao24
  const alt = (feature.meta.altitude as number | null) ?? null
  const velocity = feature.velocity?.speed ?? null

  const country = deriveCountryFromIcao24(icao24)
  const airline = deriveAirlineFromCallsign(callsign)
  const flightType = deriveFlightType(callsign, icao24)
  const flightPhase = deriveFlightPhase(alt, velocity)
  const registration = deriveRegistration(icao24, country)

  // Update track history
  const track = updateTrackHistory(
    icao24,
    feature.position.lon,
    feature.position.lat,
    feature.position.height ?? 0,
    feature.freshness,
  )

  return {
    ...feature,
    meta: {
      ...feature.meta,
      country,
      airline: airline?.name || 'Unknown',
      airlineCountry: airline?.country || 'Unknown',
      flightType,
      flightPhase,
      registration,
      track: track.length >= 2 ? track : undefined,
    },
  }
}

/** Enrich an array of aircraft features. */
export function enrichAircraftBatch(features: LiveFeature[]): LiveFeature[] {
  return features.map(enrichAircraft)
}
