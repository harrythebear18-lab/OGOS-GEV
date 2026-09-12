/**
 * Fire feed — kanari.io free fire API (no key required).
 * Aggregated fire clusters from VIIRS, GOES, and Meteosat MTG satellite detections.
 * Attribution required: "Source: kanari.io" with a link.
 *
 * Endpoint: https://kanari.io/api/events?hours=24
 * Fallback: NASA FIRMS with MAP_KEY env var (register at firms.modaps.eosdis.nasa.gov/api/map_key/)
 */

import type { LiveFeature } from '@shared/types'

const KANARI_URL = 'https://kanari.io/api/events?hours=24'
const FIRMS_MAP_KEY = process.env.FIRMS_MAP_KEY || ''

interface KanariEvent {
  id: string
  centroid: [number, number]  // [lon, lat]
  bbox: [number, number, number, number]
  count: number
  viirsCount: number
  goesCount: number
  mtgCount: number
  firstSeen: string
  lastSeen: string
  maxFrp: number  // MW
  maxConf: string
  confidence: string  // 'possible' | 'probable' | 'corrobore'
}

interface KanariResponse {
  events: KanariEvent[]
  meta: { truncated?: boolean }
}

export async function getFireFeatures(): Promise<LiveFeature[]> {
  // Try kanari.io first (free, no key)
  try {
    const res = await fetch(KANARI_URL, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const data = (await res.json()) as KanariResponse
      const features: LiveFeature[] = data.events.slice(0, 500).map((e) => ({
        id: `fire:${e.id}`,
        type: 'fire',
        position: { lon: e.centroid[0], lat: e.centroid[1], height: 0 },
        meta: {
          brightness: e.maxFrp > 100 ? 360 : e.maxFrp > 50 ? 330 : 300,
          confidence: e.confidence,
          frp: e.maxFrp,
          satellite: e.viirsCount > 0 ? 'VIIRS' : e.goesCount > 0 ? 'GOES' : 'MTG',
          acq_time: e.lastSeen,
          count: e.count,
          color: e.maxFrp > 100 ? '#ff4a4a' : e.maxFrp > 50 ? '#ff8a4a' : '#f9c74a',
        },
        freshness: Date.now(),
      }))
      console.log(`[live/fires] ${features.length} fire clusters from kanari.io`)
      return features
    }
  } catch (err) {
    console.warn('[live/fires] kanari.io failed:', err)
  }

  // Fallback: FIRMS with MAP_KEY (if set)
  if (FIRMS_MAP_KEY) {
    try {
      // FIRMS area endpoint expects [west,south,east,north] bbox, not "world"
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/-180,-90,180,90/1`
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (res.ok) {
        const csv = await res.text()
        if (!csv.startsWith('<') && !csv.startsWith('{')) {
          return parseFirmsCsv(csv)
        }
      }
    } catch (err) {
      console.warn('[live/fires] FIRMS fallback failed:', err)
    }
  }

  return []
}

function parseFirmsCsv(csv: string): LiveFeature[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  const idx = (name: string) => headers.indexOf(name)

  const latI = idx('latitude')
  const lonI = idx('longitude')
  const briI = idx('bright_ti4') !== -1 ? idx('bright_ti4') : idx('brightness')
  const confI = idx('confidence')
  const frpI = idx('frp')
  const satI = idx('satellite')
  const dateI = idx('acq_date')
  const timeI = idx('acq_time')

  if (latI < 0 || lonI < 0) return []

  const features: LiveFeature[] = []
  for (let i = 1; i < lines.length && features.length < 500; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 5) continue
    const lat = parseFloat(cols[latI])
    const lon = parseFloat(cols[lonI])
    if (isNaN(lat) || isNaN(lon)) continue
    const brightness = parseFloat(cols[briI]) || 0
    features.push({
      id: `fire:${cols[dateI]}:${cols[timeI]}:${lat.toFixed(4)}:${lon.toFixed(4)}`,
      type: 'fire',
      position: { lon, lat, height: 0 },
      meta: {
        brightness,
        confidence: cols[confI] || 'nominal',
        frp: parseFloat(cols[frpI]) || 0,
        satellite: cols[satI] || '',
        acq_time: `${cols[dateI]} ${cols[timeI]}`,
        color: brightness > 350 ? '#ff4a4a' : brightness > 320 ? '#ff8a4a' : '#f9c74a',
      },
      freshness: Date.now(),
    })
  }
  console.log(`[live/fires] ${features.length} fires from FIRMS`)
  return features
}
