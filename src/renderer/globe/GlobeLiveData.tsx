import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { IPC } from '@shared/ipc'
import type { LiveUpdate, LiveFeature } from '@shared/types'
import { isPositionInViewport, isLODVisible } from './viewportCulling'

interface GlobeLiveDataProps {
  viewer: Cesium.Viewer
  visibleTypes: Record<string, boolean>
}

const TYPE_COLORS: Record<string, Cesium.Color> = {
  quake: Cesium.Color.fromBytes(249, 115, 22, 255),
  fire: Cesium.Color.fromBytes(255, 74, 74, 255),
  aircraft: Cesium.Color.fromBytes(74, 255, 138, 255),
  vessel: Cesium.Color.fromBytes(57, 255, 213, 255),
  lightning: Cesium.Color.fromBytes(255, 234, 74, 255),
  satellite: Cesium.Color.fromBytes(255, 74, 74, 255),
}

export default function GlobeLiveData({ viewer, visibleTypes }: GlobeLiveDataProps) {
  const dsRef = useRef<Cesium.CustomDataSource | null>(null)
  const featuresRef = useRef<Map<string, LiveFeature>>(new Map())
  const visibleTypesRef = useRef(visibleTypes)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cameraMoveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  visibleTypesRef.current = visibleTypes

  useEffect(() => {
    const dataSource = new Cesium.CustomDataSource('live')
    viewer.dataSources.add(dataSource)
    dsRef.current = dataSource

    const scheduleSync = () => {
      if (syncTimerRef.current) return
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null
        syncEntities()
      }, 1000)
    }

    const syncEntities = () => {
      const ds = dsRef.current
      if (!ds) return
      const features = featuresRef.current
      const vis = visibleTypesRef.current

      // Determine which feature IDs should be visible:
      // 1. Type must be enabled
      // 2. Must pass LOD threshold (zoom level)
      // 3. Must be within viewport + margin
      const visibleIds = new Set<string>()
      for (const [id, feat] of features) {
        if (feat.type === 'satellite') continue
        if (vis[feat.type] === false) continue
        if (!isLODVisible(viewer, feat.type)) continue
        if (!isPositionInViewport(viewer, feat.position.lon, feat.position.lat)) continue
        visibleIds.add(id)
      }

      // Remove entities that are no longer visible
      const toRemove: Cesium.Entity[] = []
      for (const entity of ds.entities.values) {
        const id = (entity as any).liveId
        if (id && !visibleIds.has(id)) toRemove.push(entity)
      }
      for (const e of toRemove) ds.entities.remove(e)

      // Add newly visible entities
      const existingIds = new Set<string>()
      for (const entity of ds.entities.values) {
        const id = (entity as any).liveId
        if (id) existingIds.add(id)
      }

      for (const [id, feat] of features) {
        if (!visibleIds.has(id) || existingIds.has(id)) continue

        const color = TYPE_COLORS[feat.type] ?? Cesium.Color.ORANGE
        const height = feat.position.height ?? 0

        ds.entities.add({
          id: `live:${id}`,
          position: Cesium.Cartesian3.fromDegrees(feat.position.lon, feat.position.lat, height),
          point: {
            pixelSize: feat.type === 'quake' ? 8 : 5,
            color: new Cesium.ConstantProperty(color),
            outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(0.5)),
            outlineWidth: new Cesium.ConstantProperty(1),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            liveId: id,
            type: feat.type,
            ...feat.meta,
          },
        } as any)
      }

    }

    const onLiveUpdate = (update: unknown) => {
      const liveUpdate = update as LiveUpdate
      const features = featuresRef.current

      if (liveUpdate.type === 'full' && liveUpdate.features) {
        features.clear()
        for (const f of liveUpdate.features) {
          if (f.type === 'satellite') continue
          features.set(f.id, f)
        }
        scheduleSync()
      } else if (liveUpdate.type === 'delta') {
        if (liveUpdate.added) {
          for (const f of liveUpdate.added) {
            if (f.type === 'satellite') continue
            features.set(f.id, f)
          }
        }
        if (liveUpdate.removed) {
          for (const f of liveUpdate.removed) features.delete(f.id)
        }
        scheduleSync()
      }
    }

    // Re-cull on camera move (throttled)
    const onCameraMove = () => {
      if (cameraMoveRef.current) return
      cameraMoveRef.current = setTimeout(() => {
        cameraMoveRef.current = null
        syncEntities()
      }, 500)
    }
    viewer.camera.changed.addEventListener(onCameraMove)

    window.api.on(IPC.LIVE_UPDATE, onLiveUpdate)

    return () => {
      window.api.off(IPC.LIVE_UPDATE)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      if (cameraMoveRef.current) clearTimeout(cameraMoveRef.current)
      viewer.camera.changed.removeEventListener(onCameraMove)
      if (!viewer.isDestroyed?.()) viewer.dataSources.remove(dataSource)
      dsRef.current = null
      featuresRef.current.clear()
    }
  }, [viewer])

  // Re-sync when visibility changes
  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      const ds = dsRef.current
      if (!ds) return
      const features = featuresRef.current
      const vis = visibleTypes

      const visibleIds = new Set<string>()
      for (const [id, feat] of features) {
        if (feat.type === 'satellite') continue
        if (vis[feat.type] === false) continue
        if (!isLODVisible(viewer, feat.type)) continue
        if (!isPositionInViewport(viewer, feat.position.lon, feat.position.lat)) continue
        visibleIds.add(id)
      }

      const toRemove: Cesium.Entity[] = []
      for (const entity of ds.entities.values) {
        const id = (entity as any).liveId
        if (id && !visibleIds.has(id)) toRemove.push(entity)
      }
      for (const e of toRemove) ds.entities.remove(e)

      const existingIds = new Set<string>()
      for (const entity of ds.entities.values) {
        const id = (entity as any).liveId
        if (id) existingIds.add(id)
      }

      for (const [id, feat] of features) {
        if (!visibleIds.has(id) || existingIds.has(id)) continue

        const color = TYPE_COLORS[feat.type] ?? Cesium.Color.ORANGE
        const height = feat.position.height ?? 0

        ds.entities.add({
          id: `live:${id}`,
          position: Cesium.Cartesian3.fromDegrees(feat.position.lon, feat.position.lat, height),
          point: {
            pixelSize: feat.type === 'quake' ? 8 : 5,
            color: new Cesium.ConstantProperty(color),
            outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(0.5)),
            outlineWidth: new Cesium.ConstantProperty(1),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            liveId: id,
            type: feat.type,
            ...feat.meta,
          },
        } as any)
      }
    }, 200)
  }, [visibleTypes, viewer])

  return null
}
