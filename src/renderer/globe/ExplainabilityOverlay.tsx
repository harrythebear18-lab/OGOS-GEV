/**
 * ExplainabilityOverlay — renders AI hypothesis-suggested zones on the Cesium globe.
 *
 * Ported from OGOS ExplainabilityOverlay.tsx, adapted for Cesium.
 * Each active hypothesis's suggested zones are rendered as translucent
 * polygons with confidence-colored outlines. Clicking a zone shows
 * a popup with the reasoning.
 */

import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'

export interface HypothesisZone {
  id: string
  label: string
  confidence: number // 0-100
  coords: { lng: number; lat: number }[]
  reasons: string[]
}

export interface Hypothesis {
  id: string
  title: string
  confidence: 'low' | 'moderate' | 'high' | 'critical'
  rationale: string
  suggestedZones?: HypothesisZone[]
  createdAt: number
}

interface ExplainabilityOverlayProps {
  viewer: Cesium.Viewer | null
  hypotheses: Hypothesis[]
  onZoneClick?: (zone: HypothesisZone, hypothesis: Hypothesis) => void
}

function confidenceColor(confidence: number): string {
  if (confidence >= 75) return '#4aff8a'
  if (confidence >= 50) return '#ffea4a'
  if (confidence >= 25) return '#ff8a4a'
  return '#ff4a4a'
}

function confidenceToCesiumColor(confidence: number): Cesium.Color {
  const hex = confidenceColor(confidence)
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Cesium.Color(r, g, b, 1.0)
}

export default function ExplainabilityOverlay({
  viewer,
  hypotheses,
  onZoneClick,
}: ExplainabilityOverlayProps) {
  const [selectedZone, setSelectedZone] = useState<{
    zone: HypothesisZone
    hypothesis: Hypothesis
  } | null>(null)
  const entitiesRef = useRef<Cesium.Entity[]>([])
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null)

  // Collect all suggested zones from active hypotheses
  const allZones: { zone: HypothesisZone; hypothesis: Hypothesis }[] = []
  for (const h of hypotheses) {
    for (const z of h.suggestedZones ?? []) {
      if (z.coords.length >= 3) {
        allZones.push({ zone: z, hypothesis: h })
      }
    }
  }

  useEffect(() => {
    if (!viewer) return

    // Clean up previous entities
    for (const e of entitiesRef.current) {
      viewer.entities.remove(e)
    }
    entitiesRef.current = []

    // Clean up previous click handler
    if (handlerRef.current) {
      handlerRef.current.destroy()
      handlerRef.current = null
    }

    if (allZones.length === 0) return

    // Add a polygon entity for each zone
    for (const { zone, hypothesis } of allZones) {
      const color = confidenceToCesiumColor(zone.confidence)
      const positions = zone.coords.map(
        (c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat),
      )

      if (positions.length < 3) continue

      const entity = viewer.entities.add({
        id: `explainability-${zone.id}`,
        name: zone.label,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: color.withAlpha(0.2),
          outline: true,
          outlineColor: color,
          outlineWidth: 2,
        },
        polyline: {
          positions: positions.concat(positions[0]),
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: color,
            dashLength: 8,
          }),
        },
        properties: new Cesium.PropertyBag({
          zoneId: zone.id,
          label: zone.label,
          confidence: zone.confidence,
          hypothesisTitle: hypothesis.title,
          reasons: zone.reasons.join('\n• '),
        }),
      })

      entitiesRef.current.push(entity)
    }

    // Set up click handler
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handlerRef.current = handler

    handler.setInputAction((click: any) => {
      const picked = viewer.scene.pick(click.position)
      if (Cesium.defined(picked) && picked.id) {
        const entity = picked.id as Cesium.Entity
        if (entity.id?.startsWith('explainability-')) {
          const props = entity.properties
          const zoneId = props?.zoneId?.getValue()
          const found = allZones.find((z) => z.zone.id === zoneId)
          if (found) {
            setSelectedZone(found)
            onZoneClick?.(found.zone, found.hypothesis)
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      for (const e of entitiesRef.current) {
        try {
          viewer.entities.remove(e)
        } catch {}
      }
      entitiesRef.current = []
      if (handlerRef.current) {
        handlerRef.current.destroy()
        handlerRef.current = null
      }
    }
  }, [viewer, allZones.length])

  // Render popup for selected zone
  if (selectedZone) {
    const { zone, hypothesis } = selectedZone
    const color = confidenceColor(zone.confidence)
    return (
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          right: 12,
          zIndex: 250,
          maxWidth: 320,
          background: 'rgba(11, 15, 20, 0.95)',
          border: `1px solid ${color}66`,
          borderRadius: 4,
          padding: 10,
          fontFamily: 'monospace',
          fontSize: 11,
          color: '#c0c8d0',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color, fontWeight: 'bold', fontSize: 12 }}>{zone.label}</span>
          <button
            onClick={() => setSelectedZone(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7d92',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 9, color: '#6b7d92', marginBottom: 4 }}>
          From: {hypothesis.title}
        </div>
        <div style={{ fontSize: 10, color, marginBottom: 6 }}>
          Confidence: {zone.confidence}%
        </div>
        {zone.reasons.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: '#6b7d92', marginBottom: 2 }}>Why this zone:</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, lineHeight: 1.5 }}>
              {zone.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return null
}
