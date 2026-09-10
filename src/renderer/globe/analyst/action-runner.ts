/**
 * Action Runner — tool functions the LLM can call to interact with the globe.
 * Adapted from GEV's gevActions pattern.
 *
 * Each action returns a structured result the LLM can reason about.
 * The runner is bound to a Cesium viewer + plugin manager + context store.
 */

import * as Cesium from 'cesium'
import type { LngLat } from '@shared/types'
import type { pluginManager } from '../plugins/plugin-manager'
import { contextStore, type EntityContext } from './context-store'
import { resolveAnnotationTarget } from './annotation-resolver'
import { createAnalystEngine, type AnalystEngine, type AnalystProviders } from './analyst-engine'

export interface ActionResult {
  ok: boolean
  action: string
  [key: string]: unknown
}

export interface ActionRunnerBindings {
  viewer: Cesium.Viewer
  pluginManager: typeof import('../plugins/plugin-manager').pluginManager
  getLiveFeatures: (layerKey: string) => any[]
  getViewContext: () => { center: LngLat; viewRadiusKm: number }
  getBbox?: () => { west: number; south: number; east: number; north: number } | null
  setSelection?: (bbox: { west: number; south: number; east: number; north: number }) => void
}

const LAYER_ALIASES: Record<string, string> = {
  planes: 'aircraft',
  flights: 'aircraft',
  ships: 'vessel',
  ais: 'vessel',
  fires: 'fire',
  firms: 'fire',
  quakes: 'quake',
  earthquakes: 'quake',
  satellites: 'satellite',
  lightning: 'lightning',
  storms: 'storm',
  stations: 'station',
}

function normalizeLayerId(input: string): string {
  return LAYER_ALIASES[input.toLowerCase()] || input.toLowerCase()
}

export function createActionRunner(bindings: ActionRunnerBindings): {
  run: (name: string, args?: Record<string, unknown>) => Promise<ActionResult>
  getTools: () => any[]
  getAnalyst: () => AnalystEngine
} {
  const { viewer, pluginManager, getLiveFeatures, getViewContext, getBbox, setSelection } = bindings

  const analystProviders: AnalystProviders = {
    getRecords: (layerKey) => getLiveFeatures(layerKey) || [],
    getViewContext: () => getViewContext(),
    getBbox: () => getBbox?.() ?? null,
  }
  const analyst = createAnalystEngine(analystProviders)

  async function run(name: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
    try {
      switch (name) {
        // ── Navigation ──
        case 'fly_to': {
          const target = await resolveAnnotationTarget({
            target: args.target as string | undefined,
            latitude: args.latitude as number | undefined,
            longitude: args.longitude as number | undefined,
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve location' }
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, (args.height as number) || 50000),
            duration: 2,
          })
          return { ok: true, action: name, lon: target.lon, lat: target.lat, label: target.label }
        }

        case 'zoom_to_globe': {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(0, 20, 30000000),
            duration: 2,
          })
          return { ok: true, action: name }
        }

        case 'set_view_height': {
          const height = Number(args.height) || 100000
          const center = viewer.camera.positionCartographic
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, height),
            duration: 1.5,
          })
          return { ok: true, action: name, height }
        }

        // ── Layer management ──
        case 'set_layer_visibility': {
          const layerId = normalizeLayerId(String(args.layerId || ''))
          const enabled = Boolean(args.enabled)
          if (enabled) pluginManager.activate(layerId)
          else pluginManager.deactivate(layerId)
          return { ok: true, action: name, layerId, enabled: pluginManager.isActive(layerId) }
        }

        case 'list_layers': {
          const active = Array.from((pluginManager as any).activePlugins as Set<string>)
          return { ok: true, action: name, activeLayers: active }
        }

        // ── Selection ──
        case 'set_selection_bbox': {
          const bbox = args.bbox as { west: number; south: number; east: number; north: number } | undefined
          if (!bbox) return { ok: false, action: name, error: 'No bbox provided' }
          setSelection?.(bbox)
          return { ok: true, action: name, bbox }
        }

        case 'clear_selection': {
          setSelection?.({ west: 0, south: 0, east: 0, north: 0 })
          contextStore.clearSelection()
          return { ok: true, action: name }
        }

        // ── Entity selection / tracking ──
        case 'select_nearest': {
          const layerId = normalizeLayerId(String(args.layerId || 'aircraft'))
          const result = await analyst.query({
            layers: [layerId as any],
            scope: { kind: 'view', center: getViewContext().center, radiusKm: getViewContext().viewRadiusKm },
            sortBy: 'distance',
            sortDir: 'asc',
            limit: 1,
          })
          const nearest = result.items[0]
          if (!nearest) return { ok: false, action: name, error: `No ${layerId} in view` }
          contextStore.register(nearest.id, layerId, String(nearest.meta.callsign || nearest.id), nearest)
          contextStore.select(nearest.id)
          return { ok: true, action: name, entity: { id: nearest.id, label: nearest.meta.callsign || nearest.id, distanceKm: nearest.distanceKm } }
        }

        case 'track_entity': {
          const id = String(args.entityId || '')
          const ctx = contextStore.getAll().find((e) => e.id === id)
          if (!ctx) return { ok: false, action: name, error: 'Entity not found' }
          contextStore.track(id)
          return { ok: true, action: name, entity: { id: ctx.id, label: ctx.label } }
        }

        case 'stop_tracking': {
          contextStore.stopTracking()
          return { ok: true, action: name }
        }

        // ── Analyst queries ──
        case 'query_data': {
          const result = await analyst.query({
            layers: (args.layers as any[]) || undefined,
            scope: args.scope as any || undefined,
            filters: args.filters as any[] || undefined,
            sortBy: args.sortBy as string || undefined,
            sortDir: args.sortDir as 'asc' | 'desc' || undefined,
            limit: args.limit as number || 10,
            followUp: Boolean(args.followUp),
          })
          return {
            ok: result.ok,
            action: name,
            count: result.count,
            items: result.items.map((it) => ({
              id: it.id,
              type: it.type,
              label: it.meta.callsign || it.meta.name || it.id,
              lat: it.position.lat,
              lon: it.position.lon,
              height: it.position.height,
              distanceKm: it.distanceKm,
            })),
            summary: result.summary,
            scopeLabel: result.scopeLabel,
          }
        }

        // ── Annotation ──
        case 'resolve_place': {
          const target = await resolveAnnotationTarget({
            target: args.target as string,
            footprint: Boolean(args.footprint),
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve place' }
          return { ok: true, action: name, lon: target.lon, lat: target.lat, label: target.label, hasOutline: Boolean(target.ring) }
        }

        default:
          return { ok: false, action: name, error: `Unknown action: ${name}` }
      }
    } catch (err) {
      return { ok: false, action: name, error: err instanceof Error ? err.message : String(err) }
    }
  }

  function getTools(): any[] {
    return [
      {
        type: 'function',
        function: {
          name: 'fly_to',
          description: 'Fly the camera to a named place or coordinate.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Place name (e.g. "Tokyo", "Grand Canyon")' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              height: { type: 'number', description: 'Camera height in meters (default 50000)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zoom_to_globe',
          description: 'Zoom out to see the whole globe.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'set_layer_visibility',
          description: 'Enable or disable a data layer plugin.',
          parameters: {
            type: 'object',
            properties: {
              layerId: { type: 'string', description: 'Layer ID: aircraft, vessel, fire, quake, satellite, etc.' },
              enabled: { type: 'boolean' },
            },
            required: ['layerId', 'enabled'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'query_data',
          description: 'Query live data already loaded in the workstation. Answer questions like "how many aircraft in view?", "nearest fire?", "biggest earthquake?"',
          parameters: {
            type: 'object',
            properties: {
              layers: { type: 'array', items: { type: 'string' }, description: 'Layers to query: aircraft, vessel, fire, quake, satellite' },
              scope: { type: 'object', description: 'Spatial scope: {kind:"view"} or {kind:"radius", center:{lng,lat}, radiusKm:N}' },
              filters: { type: 'array', items: { type: 'object' }, description: 'Filters: {field, op, value}' },
              sortBy: { type: 'string', description: 'Sort field: distance, height, speed, magnitude, etc.' },
              sortDir: { type: 'string', enum: ['asc', 'desc'] },
              limit: { type: 'number', description: 'Max results (default 10, max 50)' },
              followUp: { type: 'boolean', description: 'Re-filter the previous result set' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'select_nearest',
          description: 'Select the nearest entity of a given type in the current view.',
          parameters: {
            type: 'object',
            properties: {
              layerId: { type: 'string', description: 'Layer to search: aircraft, vessel, fire, quake' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'track_entity',
          description: 'Track an entity by ID (follow camera).',
          parameters: {
            type: 'object',
            properties: { entityId: { type: 'string' } },
            required: ['entityId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'stop_tracking',
          description: 'Stop tracking the current entity.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'resolve_place',
          description: 'Resolve a place name to coordinates, optionally with an OSM outline.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Place name to geocode' },
              footprint: { type: 'boolean', description: 'Also fetch the OSM outline ring' },
            },
            required: ['target'],
          },
        },
      },
    ]
  }

  return { run, getTools, getAnalyst: () => analyst }
}

export type ActionRunner = ReturnType<typeof createActionRunner>
