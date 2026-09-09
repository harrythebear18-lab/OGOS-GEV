import * as Cesium from 'cesium'
import { useEffect, useRef } from 'react'
import type { LngLat } from '@shared/types'

export interface AnalysisOverlayProps {
  viewer: Cesium.Viewer | null
  slopeBands: { id: string; coords: LngLat[]; slopeDeg: number; class: string }[]
  anomalyZones: { id: string; coords: LngLat[]; strength: number; type: string }[]
  searchZones: { id: string; radius: number; coords: LngLat[]; probability: number }[]
  restPoints: { id: string; lng: number; lat: number; score: number; reasons: string[] }[]
  waterFeatures: { id: string; type: string; coords: LngLat[]; name?: string }[]
  behaviorPaths: LngLat[][]
  fallRiskZones: { id: string; coords: LngLat[]; risk: string }[]
  runoffPaths: LngLat[][]
}

const SOURCE_NAME = 'analysis-overlays'

function lngLatToCartesian3(p: LngLat, height = 0): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(p.lng, p.lat, height)
}

function coordsToCartesian3Array(coords: LngLat[], height = 0): Cesium.Cartesian3[] {
  return coords.map((c) => lngLatToCartesian3(c, height))
}

export default function AnalysisOverlay(props: AnalysisOverlayProps) {
  const dataSourceRef = useRef<Cesium.CustomDataSource | null>(null)

  useEffect(() => {
    const v = props.viewer
    if (!v) return

    // Remove old data source
    if (dataSourceRef.current) {
      v.dataSources.remove(dataSourceRef.current, true)
    }

    const ds = new Cesium.CustomDataSource(SOURCE_NAME)
    v.dataSources.add(ds)
    dataSourceRef.current = ds

    // Slope bands — red for impassable, orange for steep
    for (const band of props.slopeBands) {
      const color = band.class === 'impassable'
        ? Cesium.Color.RED.withAlpha(0.4)
        : Cesium.Color.ORANGE.withAlpha(0.3)
      ds.entities.add({
        id: band.id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(coordsToCartesian3Array(band.coords, 10)),
          material: color,
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
        },
      })
    }

    // Anomaly zones — blue for depression, yellow for prominence
    for (const zone of props.anomalyZones) {
      const color = zone.type === 'depression'
        ? Cesium.Color.CYAN.withAlpha(0.4)
        : Cesium.Color.YELLOW.withAlpha(0.4)
      ds.entities.add({
        id: zone.id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(coordsToCartesian3Array(zone.coords, 15)),
          material: color,
          outline: true,
          outlineColor: Cesium.Color.WHITE,
        },
      })
    }

    // Search zones — green rings with probability-based opacity
    for (const zone of props.searchZones) {
      ds.entities.add({
        id: zone.id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(coordsToCartesian3Array(zone.coords, 5)),
          material: Cesium.Color.LIME.withAlpha(0.15 + zone.probability * 0.25),
          outline: true,
          outlineColor: Cesium.Color.LIME,
        },
      })
    }

    // Rest points — blue dots (no labels to avoid clutter)
    for (const pt of props.restPoints) {
      ds.entities.add({
        id: pt.id,
        position: lngLatToCartesian3({ lng: pt.lng, lat: pt.lat }, 20),
        point: {
          pixelSize: 8 + pt.score * 8,
          color: Cesium.Color.DODGERBLUE,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }

    // Water features — blue lines/polygons (no labels)
    for (const wf of props.waterFeatures) {
      if (wf.coords.length < 2) continue
      const isArea = wf.type === 'lake' || wf.type === 'pond' || wf.type === 'reservoir'
      if (isArea && wf.coords.length >= 3) {
        ds.entities.add({
          id: wf.id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(coordsToCartesian3Array(wf.coords, 2)),
            material: Cesium.Color.STEELBLUE.withAlpha(0.5),
          },
        })
      } else {
        ds.entities.add({
          id: wf.id,
          polyline: {
            positions: coordsToCartesian3Array(wf.coords, 2),
            width: 2,
            material: Cesium.Color.STEELBLUE,
            clampToGround: true,
          },
        })
      }
    }

    // Behavior paths — semi-transparent white lines
    for (let i = 0; i < props.behaviorPaths.length; i++) {
      const path = props.behaviorPaths[i]
      if (path.length < 2) continue
      ds.entities.add({
        id: `behavior-${i}`,
        polyline: {
          positions: coordsToCartesian3Array(path, 5),
          width: 1.5,
          material: Cesium.Color.WHITE.withAlpha(0.3),
          clampToGround: true,
        },
      })
    }

    // Fall risk zones
    for (const zone of props.fallRiskZones) {
      const color = zone.risk === 'high'
        ? Cesium.Color.RED.withAlpha(0.5)
        : Cesium.Color.ORANGE.withAlpha(0.3)
      ds.entities.add({
        id: zone.id,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(coordsToCartesian3Array(zone.coords, 12)),
          material: color,
          outline: true,
          outlineColor: Cesium.Color.WHITE,
        },
      })
    }

    // Runoff flow paths
    for (let i = 0; i < props.runoffPaths.length; i++) {
      const path = props.runoffPaths[i]
      if (path.length < 2) continue
      ds.entities.add({
        id: `runoff-${i}`,
        polyline: {
          positions: coordsToCartesian3Array(path, 3),
          width: 1,
          material: Cesium.Color.AQUA.withAlpha(0.4),
          clampToGround: true,
        },
      })
    }

    return () => {
      v.dataSources.remove(ds, true)
      dataSourceRef.current = null
    }
  }, [props.viewer, props.slopeBands, props.anomalyZones, props.searchZones, props.restPoints, props.waterFeatures, props.behaviorPaths, props.fallRiskZones, props.runoffPaths])

  return null
}
