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
  worldOverlay?: import('../WorldOverlay').WorldOverlay
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
  const { viewer, pluginManager, getLiveFeatures, getViewContext, getBbox, setSelection, worldOverlay } = bindings

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

        // ── Camera intent tools ──
        case 'camera_pan': {
          // Pan the camera by a delta in degrees (lat/lng offset from current center)
          const dLng = Number(args.deltaLng) || 0
          const dLat = Number(args.deltaLat) || 0
          const center = viewer.camera.positionCartographic
          const newLng = Cesium.Math.toDegrees(center.longitude) + dLng
          const newLat = Cesium.Math.toDegrees(center.latitude) + dLat
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(newLng, newLat, center.height),
            duration: 1.5,
          })
          return { ok: true, action: name, center: { lng: newLng, lat: newLat, height: center.height } }
        }

        case 'camera_orbit': {
          // Rotate camera heading by N degrees around current focus point
          const deltaHeading = Cesium.Math.toRadians(Number(args.deltaDegrees) || 45)
          const currentHeading = viewer.camera.heading
          viewer.camera.flyTo({
            destination: viewer.camera.position,
            orientation: {
              heading: currentHeading + deltaHeading,
              pitch: viewer.camera.pitch,
              roll: 0,
            },
            duration: 1.5,
          })
          return { ok: true, action: name, heading: Cesium.Math.toDegrees(currentHeading + deltaHeading) }
        }

        case 'camera_look_at': {
          // Point the camera at a specific coordinate, keeping current distance
          const target = await resolveAnnotationTarget({
            target: args.target as string | undefined,
            latitude: args.latitude as number | undefined,
            longitude: args.longitude as number | undefined,
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve location' }
          const targetPos = Cesium.Cartesian3.fromDegrees(target.lon, target.lat)
          const offset = new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(-45),
            viewer.camera.positionCartographic.height,
          )
          viewer.camera.flyTo({
            destination: viewer.camera.position,
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
            complete: () => viewer.camera.lookAt(targetPos, offset),
            duration: 1.5,
          })
          return { ok: true, action: name, target: { lon: target.lon, lat: target.lat, label: target.label } }
        }

        case 'describe_viewport': {
          // Return structured metadata about what's currently visible
          const cam = viewer.camera.positionCartographic
          const center = { lng: Cesium.Math.toDegrees(cam.longitude), lat: Cesium.Math.toDegrees(cam.latitude), height: cam.height }
          const viewRadiusKm = getViewContext().viewRadiusKm
          const activeLayers = Array.from((pluginManager as any).activePlugins as Set<string>)
          const bbox = getBbox?.() ?? null
          const selectedEntity = contextStore.getSelected()

          // Count visible live features
          const layerCounts: Record<string, number> = {}
          for (const layer of activeLayers) {
            const features = getLiveFeatures(layer)
            if (features && features.length > 0) {
              layerCounts[layer] = features.length
            }
          }

          return {
            ok: true,
            action: name,
            camera: {
              center,
              heading: Cesium.Math.toDegrees(viewer.camera.heading),
              pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
              roll: Cesium.Math.toDegrees(viewer.camera.roll),
              viewRadiusKm,
            },
            bbox,
            activeLayers,
            layerCounts,
            selectedEntity: selectedEntity ? { id: selectedEntity.id, label: selectedEntity.label, layer: selectedEntity.layerId } : null,
          }
        }

        case 'whats_in_view': {
          // Return a structured list of all visible entities with screen coordinates
          const maxResults = Number(args.limit) || 50
          const includeScreen = Boolean(args.includeScreenCoords ?? true)
          const canvas = viewer.canvas
          const viewWidth = canvas.width
          const viewHeight = canvas.height

          interface VisibleItem {
            id: string
            type: string
            label: string
            lat: number
            lon: number
            height?: number
            screenX?: number
            screenY?: number
            distanceKm?: number
          }

          const items: VisibleItem[] = []
          const cameraPos = viewer.camera.positionCartographic
          const camCartesian = viewer.camera.position

          // Check all entities in the viewer's entity collection
          const entities = viewer.entities.values
          for (const entity of entities) {
            if (items.length >= maxResults) break

            // Skip AI-created annotations
            if (typeof entity.id === 'string' && entity.id.startsWith('ai-')) continue

            let position: Cesium.Cartesian3 | undefined
            try {
              position = entity.position?.getValue(Cesium.JulianDate.now())
            } catch { continue }
            if (!position) continue

            // Check if entity is in front of the globe (not occluded)
            const screenPos = viewer.scene.cartesianToCanvasCoordinates(position)
            if (!screenPos) continue

            // Check if within viewport bounds
            if (screenPos.x < 0 || screenPos.x > viewWidth || screenPos.y < 0 || screenPos.y > viewHeight) continue

            // Convert to geographic coords
            let carto: Cesium.Cartographic
            try {
              carto = Cesium.Cartographic.fromCartesian(position)
            } catch { continue }

            const lng = Cesium.Math.toDegrees(carto.longitude)
            const lat = Cesium.Math.toDegrees(carto.latitude)
            const height = carto.height

            // Calculate distance from camera
            const distance = Cesium.Cartesian3.distance(position, camCartesian)
            const distanceKm = distance / 1000

            // Get label from entity
            let label = entity.id
            if (entity.label?.text) {
              try {
                const text = entity.label.text.getValue(Cesium.JulianDate.now())
                if (text) label = text
              } catch { /* use id */ }
            }

            const item: VisibleItem = {
              id: String(entity.id),
              type: 'entity',
              label,
              lat,
              lon: lng,
              height,
              distanceKm: Math.round(distanceKm * 10) / 10,
            }

            if (includeScreen) {
              item.screenX = Math.round(screenPos.x)
              item.screenY = Math.round(screenPos.y)
            }

            items.push(item)
          }

          // Also check live features from active layers
          for (const layer of Array.from((pluginManager as any).activePlugins as Set<string>)) {
            if (items.length >= maxResults) break
            const features = getLiveFeatures(layer)
            if (!features) continue

            for (const f of features) {
              if (items.length >= maxResults) break
              if (!f.lat && !f.latitude) continue

              const lat = f.lat ?? f.latitude
              const lng = f.lon ?? f.lng ?? f.longitude
              if (typeof lat !== 'number' || typeof lng !== 'number') continue

              const cart = Cesium.Cartesian3.fromDegrees(lng, lat, f.alt ?? f.height ?? 0)
              const screenPos = viewer.scene.cartesianToCanvasCoordinates(cart)
              if (!screenPos) continue
              if (screenPos.x < 0 || screenPos.x > viewWidth || screenPos.y < 0 || screenPos.y > viewHeight) continue

              const distance = Cesium.Cartesian3.distance(cart, camCartesian)
              const item: VisibleItem = {
                id: String(f.id ?? f.icao24 ?? f.mmsi ?? `${layer}-${lat}-${lng}`),
                type: layer,
                label: String(f.callsign ?? f.name ?? f.id ?? `${layer} item`),
                lat,
                lon: lng,
                height: f.alt ?? f.height,
                distanceKm: Math.round((distance / 1000) * 10) / 10,
              }
              if (includeScreen) {
                item.screenX = Math.round(screenPos.x)
                item.screenY = Math.round(screenPos.y)
              }
              items.push(item)
            }
          }

          // Sort by distance
          items.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))

          return {
            ok: true,
            action: name,
            count: items.length,
            items,
            camera: {
              center: {
                lng: Cesium.Math.toDegrees(cameraPos.longitude),
                lat: Cesium.Math.toDegrees(cameraPos.latitude),
                height: cameraPos.height,
              },
              viewRadiusKm: getViewContext().viewRadiusKm,
            },
          }
        }

        // ── Layer management ──
        // ── Pixel-to-world grounding ──
        case 'pick_at': {
          // Pick the globe at screen coordinates (x, y) and return world coords + nearby entities
          const screenX = Number(args.x)
          const screenY = Number(args.y)
          if (isNaN(screenX) || isNaN(screenY)) {
            return { ok: false, action: name, error: 'x and y must be numbers' }
          }

          // Pick the globe terrain at screen position
          const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(screenX, screenY))
          if (!ray) return { ok: false, action: name, error: 'No ray for screen position' }

          const cartesian = viewer.scene.globe.pick(ray, viewer.scene)
          if (!cartesian) {
            // Ray missed the globe — return sky/space
            return {
              ok: true,
              action: name,
              world: null,
              screenX,
              screenY,
              note: 'Ray did not intersect the globe (sky/space)',
            }
          }

          const carto = Cesium.Cartographic.fromCartesian(cartesian)
          const lng = Cesium.Math.toDegrees(carto.longitude)
          const lat = Cesium.Math.toDegrees(carto.latitude)
          const height = carto.height

          // Also try picking entities at this screen position
          const picked = viewer.scene.pick(new Cesium.Cartesian2(screenX, screenY))
          let pickedEntity: { id: string; label?: string } | null = null
          if (Cesium.defined(picked)) {
            const entity = (picked as any).id
            if (entity && entity.id) {
              let label = String(entity.id)
              if (entity.label?.text) {
                try {
                  const text = entity.label.text.getValue(Cesium.JulianDate.now())
                  if (text) label = text
                } catch { /* use id */ }
              }
              pickedEntity = { id: String(entity.id), label }
            }
          }

          // Find nearest visible entities within a radius
          const radiusKm = Number(args.radiusKm) || 50
          const nearby: Array<{ id: string; type: string; label: string; lat: number; lon: number; distanceKm: number }> = []
          const pickCartesian = cartesian
          for (const entity of viewer.entities.values) {
            if (nearby.length >= 10) break
            if (typeof entity.id === 'string' && entity.id.startsWith('ai-')) continue
            let pos: Cesium.Cartesian3 | undefined
            try {
              pos = entity.position?.getValue(Cesium.JulianDate.now())
            } catch { continue }
            if (!pos) continue
            const dist = Cesium.Cartesian3.distance(pos, pickCartesian)
            const distKm = dist / 1000
            if (distKm > radiusKm) continue
            let label = String(entity.id)
            if (entity.label?.text) {
              try {
                const text = entity.label.text.getValue(Cesium.JulianDate.now())
                if (text) label = text
              } catch { /* use id */ }
            }
            const entityCarto = Cesium.Cartographic.fromCartesian(pos)
            nearby.push({
              id: String(entity.id),
              type: 'entity',
              label,
              lat: Cesium.Math.toDegrees(entityCarto.latitude),
              lon: Cesium.Math.toDegrees(entityCarto.longitude),
              distanceKm: Math.round(distKm * 10) / 10,
            })
          }
          nearby.sort((a, b) => a.distanceKm - b.distanceKm)

          return {
            ok: true,
            action: name,
            world: { lng, lat, height: Math.round(height * 10) / 10 },
            screenX,
            screenY,
            pickedEntity,
            nearby,
          }
        }

        case 'pick_object': {
          // Select an entity by ID, register it in context store, and return its details
          const id = String(args.entityId || '')
          if (!id) return { ok: false, action: name, error: 'No entityId provided' }

          const entity = viewer.entities.getById(id)
          if (!entity) return { ok: false, action: name, error: `Entity ${id} not found` }

          let position: Cesium.Cartesian3 | undefined
          try {
            position = entity.position?.getValue(Cesium.JulianDate.now())
          } catch { /* no position */ }

          let lat = 0, lon = 0, height = 0
          if (position) {
            const carto = Cesium.Cartographic.fromCartesian(position)
            lat = Cesium.Math.toDegrees(carto.latitude)
            lon = Cesium.Math.toDegrees(carto.longitude)
            height = carto.height
          }

          let label = String(entity.id)
          if (entity.label?.text) {
            try {
              const text = entity.label.text.getValue(Cesium.JulianDate.now())
              if (text) label = text
            } catch { /* use id */ }
          }

          // Register in context store and select
          contextStore.register(id, 'entity', label, { id, type: 'entity' as any, position: { lon, lat, height }, meta: {}, freshness: Date.now() } as any)
          contextStore.select(id)

          // Get screen coordinates if visible
          let screenX: number | undefined, screenY: number | undefined
          if (position) {
            const screenPos = viewer.scene.cartesianToCanvasCoordinates(position)
            if (screenPos) {
              screenX = Math.round(screenPos.x)
              screenY = Math.round(screenPos.y)
            }
          }

          return {
            ok: true,
            action: name,
            entity: { id, label, lat, lon, height, screenX, screenY },
          }
        }

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

        case 'add_marker': {
          // Add a labeled point marker on the globe
          const target = await resolveAnnotationTarget({
            target: args.target as string | undefined,
            latitude: args.latitude as number | undefined,
            longitude: args.longitude as number | undefined,
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve location' }
          const label = String(args.label || target.label || 'Marker')
          const color = String(args.color || '#FFD700')
          const id = `ai-marker-${Date.now()}`
          viewer.entities.add({
            id,
            position: Cesium.Cartesian3.fromDegrees(target.lon, target.lat),
            point: {
              pixelSize: 12,
              color: Cesium.Color.fromCssColorString(color),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: label,
              font: '14px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
          return { ok: true, action: name, markerId: id, lon: target.lon, lat: target.lat, label }
        }

        case 'draw_bbox': {
          // Draw a bounding box rectangle on the globe
          const bbox = args.bbox as { west: number; south: number; east: number; north: number } | undefined
          if (!bbox) return { ok: false, action: name, error: 'No bbox provided' }
          const label = String(args.label || 'AI BBox')
          const color = String(args.color || '#FF6600')
          const id = `ai-bbox-${Date.now()}`
          viewer.entities.add({
            id,
            rectangle: {
              coordinates: Cesium.Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north),
              material: Cesium.Color.fromCssColorString(color).withAlpha(0.2),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString(color),
              outlineWidth: 2,
            },
          })
          // Add label as separate entity at bbox center
          viewer.entities.add({
            id: `${id}-label`,
            position: Cesium.Cartesian3.fromDegrees((bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2),
            label: {
              text: label,
              font: '14px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
          return { ok: true, action: name, bboxId: id, bbox, label }
        }

        case 'highlight_area': {
          // Highlight a circular area on the globe
          const target = await resolveAnnotationTarget({
            target: args.target as string | undefined,
            latitude: args.latitude as number | undefined,
            longitude: args.longitude as number | undefined,
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve location' }
          const radiusKm = Number(args.radiusKm) || 10
          const label = String(args.label || 'Highlighted Area')
          const color = String(args.color || '#00FFFF')
          const id = `ai-highlight-${Date.now()}`
          viewer.entities.add({
            id,
            position: Cesium.Cartesian3.fromDegrees(target.lon, target.lat),
            ellipse: {
              semiMajorAxis: radiusKm * 1000,
              semiMinorAxis: radiusKm * 1000,
              material: Cesium.Color.fromCssColorString(color).withAlpha(0.2),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString(color),
              outlineWidth: 2,
            },
            label: {
              text: label,
              font: '14px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
          return { ok: true, action: name, highlightId: id, lon: target.lon, lat: target.lat, radiusKm, label }
        }

        case 'clear_annotations': {
          // Remove all AI-created annotations (markers, bboxes, highlights, labels)
          const entities = viewer.entities.values
          const toRemove: string[] = []
          for (const e of entities) {
            if (e.id && typeof e.id === 'string' && (
              e.id.startsWith('ai-marker-') ||
              e.id.startsWith('ai-bbox-') ||
              e.id.startsWith('ai-highlight-') ||
              e.id.endsWith('-label')
            )) {
              toRemove.push(e.id)
            }
          }
          for (const id of toRemove) {
            viewer.entities.removeById(id)
          }
          return { ok: true, action: name, removed: toRemove.length }
        }

        // ── WorldOverlay tools ──
        case 'add_label': {
          if (!worldOverlay) return { ok: false, action: name, error: 'WorldOverlay not available' }
          const target = await resolveAnnotationTarget({
            target: args.target as string | undefined,
            latitude: args.latitude as number | undefined,
            longitude: args.longitude as number | undefined,
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve location' }
          const id = `ai-label-${Date.now()}`
          worldOverlay.registerLabel({
            id,
            lat: target.lat,
            lon: target.lon,
            height: Number(args.height) || 0,
            text: String(args.text || args.label || 'Label'),
            category: String(args.category || 'ai'),
            priority: Number(args.priority) || 5,
            color: String(args.color || '#4affd4'),
            fontSize: Number(args.fontSize) || 12,
          })
          return { ok: true, action: name, labelId: id, lon: target.lon, lat: target.lat }
        }

        case 'add_card': {
          if (!worldOverlay) return { ok: false, action: name, error: 'WorldOverlay not available' }
          const target = await resolveAnnotationTarget({
            target: args.target as string | undefined,
            latitude: args.latitude as number | undefined,
            longitude: args.longitude as number | undefined,
          })
          if (!target) return { ok: false, action: name, error: 'Could not resolve location' }
          const id = `ai-card-${Date.now()}`
          worldOverlay.registerCard({
            id,
            lat: target.lat,
            lon: target.lon,
            height: Number(args.height) || 0,
            title: String(args.title || 'AI Card'),
            subtitle: String(args.subtitle || ''),
            category: String(args.category || 'ai'),
            priority: Number(args.priority) || 5,
            color: String(args.color || '#4affd4'),
          })
          return { ok: true, action: name, cardId: id, lon: target.lon, lat: target.lat }
        }

        case 'remove_overlay': {
          if (!worldOverlay) return { ok: false, action: name, error: 'WorldOverlay not available' }
          const id = String(args.overlayId || '')
          if (!id) return { ok: false, action: name, error: 'No overlayId provided' }
          // Try removing as label first, then as card
          worldOverlay.removeLabel(id)
          worldOverlay.removeCard(id)
          return { ok: true, action: name, overlayId: id }
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
      // ── Camera intent tools ──
      {
        type: 'function',
        function: {
          name: 'camera_pan',
          description: 'Pan the camera by a lat/lng delta from the current center.',
          parameters: {
            type: 'object',
            properties: {
              deltaLng: { type: 'number', description: 'Longitude offset in degrees' },
              deltaLat: { type: 'number', description: 'Latitude offset in degrees' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'camera_orbit',
          description: 'Rotate the camera heading by N degrees around the current focus point.',
          parameters: {
            type: 'object',
            properties: {
              deltaDegrees: { type: 'number', description: 'Heading rotation in degrees (positive = clockwise)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'camera_look_at',
          description: 'Point the camera at a specific location, keeping current distance.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Place name' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'describe_viewport',
          description: 'Return structured metadata about what is currently visible: camera position, active layers, feature counts, selection, and bbox.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'whats_in_view',
          description: 'Return a structured list of all visible entities and live features with screen-space coordinates, geographic coordinates, and distance from camera. Use this to answer "what am I looking at?" or "what\'s near the center of the screen?"',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max results (default 50)' },
              includeScreenCoords: { type: 'boolean', description: 'Include screen X/Y pixel coordinates (default true)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'pick_at',
          description: 'Pick the globe at screen coordinates (x, y) and return world coordinates, the entity at that position (if any), and nearby entities. This is how the AI can reference "that ridge" or "that anomaly" — by screen position.',
          parameters: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'Screen X pixel coordinate' },
              y: { type: 'number', description: 'Screen Y pixel coordinate' },
              radiusKm: { type: 'number', description: 'Search radius for nearby entities (default 50 km)' },
            },
            required: ['x', 'y'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'pick_object',
          description: 'Select an entity by its ID. Returns the entity\'s geographic coordinates, screen position, and label. Registers it in the context store as the selected entity.',
          parameters: {
            type: 'object',
            properties: {
              entityId: { type: 'string', description: 'Entity ID (from whats_in_view or query_data results)' },
            },
            required: ['entityId'],
          },
        },
      },
      // ── Annotation tools ──
      {
        type: 'function',
        function: {
          name: 'add_marker',
          description: 'Add a labeled point marker on the globe at a location.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Place name' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              label: { type: 'string', description: 'Marker label text' },
              color: { type: 'string', description: 'Hex color (default #FFD700 gold)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'draw_bbox',
          description: 'Draw a bounding box rectangle on the globe to highlight a region.',
          parameters: {
            type: 'object',
            properties: {
              bbox: { type: 'object', properties: {
                west: { type: 'number' }, south: { type: 'number' },
                east: { type: 'number' }, north: { type: 'number' },
              }, required: ['west', 'south', 'east', 'north'] },
              label: { type: 'string' },
              color: { type: 'string', description: 'Hex color (default #FF6600 orange)' },
            },
            required: ['bbox'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'highlight_area',
          description: 'Highlight a circular area on the globe at a location.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              radiusKm: { type: 'number', description: 'Radius in km (default 10)' },
              label: { type: 'string' },
              color: { type: 'string', description: 'Hex color (default #00FFFF cyan)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'clear_annotations',
          description: 'Remove all AI-created markers, bounding boxes, and highlights from the globe.',
          parameters: { type: 'object', properties: {} },
        },
      },
      // ── WorldOverlay tools ──
      {
        type: 'function',
        function: {
          name: 'add_label',
          description: 'Add a persistent label on the globe at a location using the WorldOverlay system (with collision management and culling). Labels survive camera moves and are managed by the overlay system.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Place name' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              height: { type: 'number', description: 'Height in meters (default 0)' },
              text: { type: 'string', description: 'Label text' },
              label: { type: 'string', description: 'Alias for text' },
              category: { type: 'string', description: 'Category for grouping (default "ai")' },
              priority: { type: 'number', description: 'Priority 0-10, higher = more visible (default 5)' },
              color: { type: 'string', description: 'Hex color (default #4affd4 cyan)' },
              fontSize: { type: 'number', description: 'Font size in px (default 12)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'add_card',
          description: 'Add an info card on the globe at a location using the WorldOverlay system. Cards show title + subtitle and are managed with collision/culling.',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string' },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              height: { type: 'number' },
              title: { type: 'string', description: 'Card title' },
              subtitle: { type: 'string', description: 'Card subtitle (optional)' },
              category: { type: 'string' },
              priority: { type: 'number' },
              color: { type: 'string' },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'remove_overlay',
          description: 'Remove a specific label or card from the WorldOverlay by its ID.',
          parameters: {
            type: 'object',
            properties: {
              overlayId: { type: 'string', description: 'ID of the label or card to remove' },
            },
            required: ['overlayId'],
          },
        },
      },
    ]
  }

  return { run, getTools, getAnalyst: () => analyst }
}

export type ActionRunner = ReturnType<typeof createActionRunner>
