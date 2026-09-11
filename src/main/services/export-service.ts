/**
 * Export Service — converts analysis results to GeoJSON and KML.
 * Ported from OSINT-Global-OS and adapted to the workstation's types.
 *
 * GeoJSON: standard FeatureCollection format, importable by QGIS, Google Earth, etc.
 * KML: Keyhole Markup Language for direct Google Earth import.
 */

import type {
  LngLat,
  SearchZonesResponse,
  RestPointsResponse,
  RunoffAnalysisResponse,
  RoutePlanResponse,
  FallRiskResponse,
  RemainsCorridorResponse,
  SlopeAnalysisResponse,
  AnomalyAnalysisResponse,
} from '@shared/types'

interface GeoJSONFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/** Convert a list of analysis results into a GeoJSON FeatureCollection. */
export function toGeoJSON(results: Record<string, unknown>): string {
  const features: GeoJSONFeature[] = []

  // Search zones
  const zones = results.zones as SearchZonesResponse | undefined
  if (zones) {
    for (const z of zones.zones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'search-zone', radius: z.radius, probability: z.probability },
      })
    }
  }

  // Rest points
  const rest = results.restPoints as RestPointsResponse | undefined
  if (rest) {
    for (const p of rest.points) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { type: 'rest-point', score: p.score, reasons: p.reasons?.join('; ') },
      })
    }
  }

  // Runoff / hydrology
  const runoff = results.runoff as RunoffAnalysisResponse | undefined
  if (runoff) {
    for (const p of runoff.flowPaths) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: p.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'flow-path', dischargeLps: p.dischargeLps },
      })
    }
    for (const p of runoff.pools) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [p.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'pooling-area', volumeL: p.volumeL, depthM: p.depthM },
      })
    }
    for (const z of runoff.floodZones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: z.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'flood-risk', risk: z.risk, reason: z.reason },
      })
    }
    for (const d of runoff.watershedDivides ?? []) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [d.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'watershed-divide', label: d.label, areaKm2: d.areaKm2 },
      })
    }
  }

  // Route
  const route = results.route as RoutePlanResponse | undefined
  if (route) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.primary.map((c) => [c.lng, c.lat]) },
      properties: { type: 'route-primary', distanceM: route.distanceM, ascentM: route.ascentM, descentM: route.descentM },
    })
    for (const alt of route.alternatives) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: alt.map((c) => [c.lng, c.lat]) },
        properties: { type: 'route-alternative' },
      })
    }
  }

  // Fall risk
  const fallRisk = results.fallRisk as FallRiskResponse | undefined
  if (fallRisk) {
    for (const z of fallRisk.zones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'fall-risk', risk: z.risk },
      })
    }
  }

  // Remains corridor
  const corridor = results.corridor as RemainsCorridorResponse | undefined
  if (corridor) {
    for (const p of corridor.paths) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: p.coords.map((c) => [c.lng, c.lat]) },
        properties: { type: 'corridor-path', primary: p.primary, accumulation: p.accumulation },
      })
    }
    for (const z of corridor.depositionZones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'deposition-zone', priority: z.priority, depositionType: z.type, reason: z.reason },
      })
    }
    for (const c of corridor.chokePoints) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.coord.lng, c.coord.lat] },
        properties: { type: 'choke-point', reason: c.reason },
      })
    }
    if (corridor.terminalZone) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [corridor.terminalZone.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'terminal-zone', areaKm2: corridor.terminalZone.areaKm2 },
      })
    }
  }

  // Slope bands
  const slope = results.slope as SlopeAnalysisResponse | undefined
  if (slope) {
    for (const b of slope.bands) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [b.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'slope-band', slopeDeg: b.slopeDeg, class: b.class },
      })
    }
  }

  // Anomaly zones
  const anomaly = results.anomaly as AnomalyAnalysisResponse | undefined
  if (anomaly) {
    for (const z of anomaly.zones) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [z.coords.map((c) => [c.lng, c.lat])] },
        properties: { type: 'anomaly', strength: z.strength, anomalyType: z.type, sizeM: z.sizeM },
      })
    }
  }

  // Roads
  const roads = results.roads as { segments: any[] } | undefined
  if (roads) {
    for (const s of roads.segments) {
      if (s.coords && s.coords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: s.coords.map((c: any) => [c.lng, c.lat]) },
          properties: { type: 'road', name: s.name ?? '', highway: s.highway ?? '' },
        })
      }
    }
  }

  // Water features
  const water = results.water as { features: any[] } | undefined
  if (water) {
    for (const f of water.features) {
      if (f.coords && f.coords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: f.coords.map((c: any) => [c.lng, c.lat]) },
          properties: { type: 'water', name: f.name ?? '', waterType: f.type ?? '' },
        })
      }
    }
  }

  // Infrastructure
  const infra = results.infrastructure as { features: any[] } | undefined
  if (infra) {
    for (const f of infra.features) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lng ?? f.lon ?? 0, f.lat ?? 0] },
        properties: { type: 'infrastructure', name: f.name ?? '', infraType: f.type ?? '' },
      })
    }
  }

  // CLIP similarity results
  const clip = results.clip as { results: any[] } | undefined
  if (clip) {
    for (const r of clip.results) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng ?? r.lon ?? 0, r.lat ?? 0] },
        properties: { type: 'clip-match', score: r.score ?? r.similarity ?? 0, label: r.label ?? '' },
      })
    }
  }

  // Web search results
  const webSearch = results.webSearch as { results: any[] } | undefined
  if (webSearch) {
    for (const r of webSearch.results) {
      if (r.lat && r.lng) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
          properties: { type: 'web-result', title: r.title ?? '', url: r.url ?? '', snippet: r.snippet ?? '' },
        })
      }
    }
  }

  const fc: GeoJSONFeatureCollection = { type: 'FeatureCollection', features }
  return JSON.stringify(fc, null, 2)
}

/** Convert analysis results to KML for Google Earth. */
export function toKML(results: Record<string, unknown>): string {
  const features = JSON.parse(toGeoJSON(results)) as GeoJSONFeatureCollection
  const styles = `
    <Style id="search-zone"><LineStyle><color>ff00aaff</color><width>2</width></LineStyle><PolyStyle><color>3300aaff</color></PolyStyle></Style>
    <Style id="rest-point"><IconStyle><color>ffff6644</color><scale>1.0</scale></IconStyle></Style>
    <Style id="flow-path"><LineStyle><color>ff00b4d8</color><width>2</width></LineStyle></Style>
    <Style id="pooling-area"><LineStyle><color>ff4a8aff</color><width>1</width></LineStyle><PolyStyle><color>334a8aff</color></PolyStyle></Style>
    <Style id="flood-risk"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>
    <Style id="watershed-divide"><LineStyle><color>ffb48c3c</color><width>2</width></LineStyle><PolyStyle><color>33b48c3c</color></PolyStyle></Style>
    <Style id="route-primary"><LineStyle><color>ff00ff88</color><width>3</width></LineStyle></Style>
    <Style id="route-alternative"><LineStyle><color>ff888888</color><width>2</width></LineStyle></Style>
    <Style id="fall-risk"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle><PolyStyle><color>330000ff</color></PolyStyle></Style>
    <Style id="corridor-path"><LineStyle><color>ff8a4aff</color><width>3</width></LineStyle></Style>
    <Style id="deposition-zone"><LineStyle><color>ff00ffff</color><width>2</width></LineStyle><PolyStyle><color>3300ffff</color></PolyStyle></Style>
    <Style id="choke-point"><IconStyle><color>ff8a4aff</color><scale>1.0</scale></IconStyle></Style>
    <Style id="terminal-zone"><LineStyle><color>ffffd24a</color><width>2</width></LineStyle><PolyStyle><color>33ffd24a</color></PolyStyle></Style>
    <Style id="slope-band"><LineStyle><color>ff3636d9</color><width>1</width></LineStyle><PolyStyle><color>333636d9</color></PolyStyle></Style>
    <Style id="anomaly"><LineStyle><color>ffffff00</color><width>1</width></LineStyle><PolyStyle><color>33ffff00</color></PolyStyle></Style>
  `

  let placemarks = ''
  for (const f of features.features) {
    const type = f.properties.type as string
    const styleUrl = `#${type}`
    const desc = Object.entries(f.properties)
      .filter(([k]) => k !== 'type')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')

    if (f.geometry.type === 'Point') {
      const coords = f.geometry.coordinates as number[]
      placemarks += `<Placemark><name>${type}</name><styleUrl>${styleUrl}</styleUrl><description>${desc}</description><Point><coordinates>${coords[0]},${coords[1]},0</coordinates></Point></Placemark>`
    } else if (f.geometry.type === 'LineString') {
      const coords = f.geometry.coordinates as number[][]
      const kmlCoords = coords.map((c) => `${c[0]},${c[1]},0`).join(' ')
      placemarks += `<Placemark><name>${type}</name><styleUrl>${styleUrl}</styleUrl><description>${desc}</description><LineString><coordinates>${kmlCoords}</coordinates></LineString></Placemark>`
    } else if (f.geometry.type === 'Polygon') {
      const rings = f.geometry.coordinates as number[][][]
      const kmlCoords = rings[0].map((c) => `${c[0]},${c[1]},0`).join(' ')
      placemarks += `<Placemark><name>${type}</name><styleUrl>${styleUrl}</styleUrl><description>${desc}</description><Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>Sentinel Workstation Export</name>
${styles}
${placemarks}
</Document>
</kml>`
}
