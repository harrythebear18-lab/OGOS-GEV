/**
 * Analyst Query Engine — answers questions over live features already loaded
 * in the workstation. Adapted from GEV's analystEngine pattern.
 *
 * Pure query logic over plain record arrays — no fetching, no rendering.
 * Surfaces (AI panel, narration, detection brackets) consume the returned
 * result set.
 *
 * Supports:
 *  - Spatial scope: view, radius, region (bbox), anywhere
 *  - Attribute filters: gt, lt, gte, lte, eq, neq, contains
 *  - Sorting: by any numeric field, or by distance from a reference point
 *  - Limits with truncation
 *  - Follow-up queries ("which of those is closest?") with memory
 */

import type { LiveFeature, LiveFeatureType, LngLat, BBox } from '@shared/types'

export type AnalystLayer = LiveFeatureType

export const ANALYST_LAYERS: AnalystLayer[] = [
  'aircraft', 'vessel', 'fire', 'quake', 'satellite', 'lightning', 'storm', 'station',
]

export interface AnalystFilter {
  field: string
  op: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'contains'
  value: unknown
}

export type AnalystScope =
  | { kind: 'anywhere' }
  | { kind: 'view'; center: LngLat; radiusKm: number }
  | { kind: 'radius'; center: LngLat; radiusKm: number }
  | { kind: 'bbox'; bbox: BBox }

export interface AnalystQuery {
  layers?: AnalystLayer[]
  scope?: AnalystScope
  filters?: AnalystFilter[]
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  limit?: number
  followUp?: boolean
}

export interface AnalystResult {
  ok: boolean
  count: number
  items: (LiveFeature & { distanceKm?: number; layerKey: string })[]
  truncated: boolean
  summary: Record<string, number>
  scopeLabel: string
  error?: string
}

export interface AnalystProviders {
  getRecords(layerKey: string): LiveFeature[]
  getViewContext(): { center: LngLat; viewRadiusKm: number }
  getBbox?(): BBox | null
}

const EARTH_R_KM = 6371

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const d2r = Math.PI / 180
  const dLat = (lat2 - lat1) * d2r
  const dLon = (lon2 - lon1) * d2r
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function applyFilter(records: LiveFeature[], filter: AnalystFilter): LiveFeature[] {
  const { field, op, value } = filter
  if (!field || !op) return records
  return records.filter((r) => {
    const got = field === 'lat' ? r.position.lat
      : field === 'lon' ? r.position.lon
      : field === 'height' ? r.position.height ?? 0
      : field === 'speed' ? r.velocity?.speed ?? 0
      : field === 'heading' ? r.velocity?.heading ?? 0
      : r.meta[field]
    if (got === null || got === undefined) return false
    switch (op) {
      case 'gt': return Number(got) > Number(value)
      case 'gte': return Number(got) >= Number(value)
      case 'lt': return Number(got) < Number(value)
      case 'lte': return Number(got) <= Number(value)
      case 'eq': {
        if (typeof got === 'boolean' || typeof value === 'boolean') return Boolean(got) === Boolean(value)
        return String(got).toLowerCase() === String(value).toLowerCase()
      }
      case 'neq': return String(got).toLowerCase() !== String(value).toLowerCase()
      case 'contains': return String(got).toLowerCase().includes(String(value).toLowerCase())
      default: return true
    }
  })
}

export function applyScope(records: LiveFeature[], scope: AnalystScope): LiveFeature[] {
  if (!scope || scope.kind === 'anywhere') return records

  if (scope.kind === 'bbox') {
    const { west, south, east, north } = scope.bbox
    return records.filter((r) =>
      r.position.lon >= west && r.position.lon <= east &&
      r.position.lat >= south && r.position.lat <= north,
    )
  }

  // radius or view — both use haversine
  const { center, radiusKm } = scope
  return records.filter((r) =>
    haversineKm(center.lat, center.lng, r.position.lat, r.position.lon) <= radiusKm,
  )
}

function summarize(items: LiveFeature[], sortField: string | null): Record<string, number> {
  const summary: Record<string, number> = { count: items.length }
  if (sortField && items.length) {
    const vals = items.map((r) => {
      const v = sortField === 'height' ? r.position.height ?? 0
        : sortField === 'speed' ? r.velocity?.speed ?? 0
        : typeof r.meta[sortField] === 'number' ? r.meta[sortField] as number : NaN
      return v
    }).filter(Number.isFinite)
    if (vals.length) {
      summary[`${sortField}Min`] = Math.min(...vals)
      summary[`${sortField}Max`] = Math.max(...vals)
    }
  }
  return summary
}

export function createAnalystEngine(providers: AnalystProviders) {
  let lastResult: AnalystResult | null = null

  async function query(spec: AnalystQuery = {}): Promise<AnalystResult> {
    const layers = (spec.followUp && lastResult)
      ? null
      : (Array.isArray(spec.layers) && spec.layers.length
        ? spec.layers.filter((l) => ANALYST_LAYERS.includes(l))
        : ['aircraft', 'vessel', 'fire', 'quake'])

    let records: (LiveFeature & { layerKey: string })[] = []
    let layersQueried: string[] = []

    if (layers === null) {
      records = lastResult!.items.slice()
      layersQueried = []
    } else {
      for (const key of layers) {
        const rows = providers.getRecords(key) || []
        layersQueried.push(key)
        for (const row of rows) records.push({ ...row, layerKey: key })
      }
    }

    // Spatial scope
    let scopeLabel = 'anywhere in the loaded data'
    const scope = spec.scope || { kind: 'view', center: providers.getViewContext().center, radiusKm: providers.getViewContext().viewRadiusKm }

    if (scope.kind === 'view') {
      const view = providers.getViewContext()
      scopeLabel = `in view (~${Math.round(view.viewRadiusKm)} km)`
    } else if (scope.kind === 'radius') {
      scopeLabel = `within ${scope.radiusKm} km`
    } else if (scope.kind === 'bbox') {
      scopeLabel = 'in selection bbox'
    }

    let items: (LiveFeature & { distanceKm?: number; layerKey: string })[] = applyScope(records, scope) as any

    // Attribute filters
    for (const f of spec.filters || []) items = applyFilter(items, f) as any

    // Sort
    const sortBy = spec.sortBy || null
    if (sortBy === 'distance') {
      const ref = scope.kind === 'view' || scope.kind === 'radius' ? scope.center : providers.getViewContext().center
      for (const it of items) {
        it.distanceKm = Math.round(haversineKm(ref.lat, ref.lng, it.position.lat, it.position.lon) * 10) / 10
      }
    }
    if (sortBy) {
      const dir = spec.sortDir === 'asc' ? 1 : -1
      const getVal = (r: LiveFeature): number =>
        sortBy === 'distance' ? (r as any).distanceKm ?? Infinity
        : sortBy === 'height' ? r.position.height ?? 0
        : sortBy === 'speed' ? r.velocity?.speed ?? 0
        : typeof r.meta[sortBy] === 'number' ? r.meta[sortBy] as number : NaN
      items.sort((a, b) => {
        const va = getVal(a), vb = getVal(b)
        if (Number.isFinite(va) && Number.isFinite(vb)) return (va - vb) * dir
        return String(a.id).localeCompare(String(b.id))
      })
    }

    const limit = Math.max(1, Math.min(50, spec.limit || 10))
    const top = items.slice(0, limit)

    const result: AnalystResult = {
      ok: true,
      count: items.length,
      items: top,
      truncated: items.length > top.length,
      summary: summarize(items, sortBy && sortBy !== 'distance' ? sortBy : null),
      scopeLabel,
    }
    lastResult = result
    return result
  }

  return {
    query,
    reset() { lastResult = null },
    hasMemory() { return Boolean(lastResult) },
  }
}

export type AnalystEngine = ReturnType<typeof createAnalystEngine>
