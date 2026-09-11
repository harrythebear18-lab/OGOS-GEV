import { useEffect, useRef } from 'react'
import * as satellite from 'satellite.js'
import * as Cesium from 'cesium'

interface SatellitesOverlayProps {
  viewer: Cesium.Viewer
  enabled: boolean
}

interface TleData {
  name: string
  satnum: number
  line1: string
  line2: string
}

interface SatEntity {
  satrec: satellite.SatRec
  name: string
  satnum: number
  entity: Cesium.Entity
  orbitEntity?: Cesium.Entity
}

export default function SatellitesOverlay({ viewer, enabled }: SatellitesOverlayProps) {
  const satsRef = useRef<SatEntity[]>([])
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!viewer || viewer.isDestroyed?.() || !enabled) return

    let sats: SatEntity[] = []
    let cleanup = () => {}

    async function loadAndRender() {
      // Fetch TLE strings from main process
      const result = await window.api.imagery.getTle()
      if (!result || result.error || !result.tles || result.tles.length === 0) {
        console.warn('[satellites-overlay] no TLE data available')
        return
      }

      const tles = result.tles as TleData[]
      console.log(`[satellites-overlay] loaded ${tles.length} TLE records`)

      // Build satrecs and entities
      sats = []
      for (const tle of tles) {
        try {
          const satrec = satellite.twoline2satrec(tle.line1, tle.line2)
          if (!satrec) continue

          // Position callback — SGP4 driven by Cesium clock time
          const positionCallback = new Cesium.CallbackProperty(
            (time?: Cesium.JulianDate) => {
              if (!time) return new Cesium.Cartesian3(0, 0, 0)
              const date = Cesium.JulianDate.toDate(time)
              const pv = satellite.propagate(satrec, date)
              if (!pv || !pv.position || typeof pv.position !== 'object' || !('x' in pv.position)) {
                return new Cesium.Cartesian3(0, 0, 0)
              }
              const gmst = satellite.gstime(date)
              const ecf = satellite.eciToEcf(
                pv.position as { x: number; y: number; z: number },
                gmst
              )
              return new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000)
            },
            false
          )

          // Color: ISS gets red, others get cyan
          const isISS = tle.satnum === 25544
          const color = isISS
            ? Cesium.Color.fromBytes(255, 74, 74, 255)
            : Cesium.Color.fromBytes(56, 189, 248, 200)

          const entity = viewer.entities.add({
            name: tle.name,
            position: positionCallback as any,
            point: {
              pixelSize: isISS ? 10 : 6,
              color,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
              outlineWidth: 1,
            },
            label: {
              text: tle.name.slice(0, 20),
              font: '10px monospace',
              fillColor: color,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -14),
              showBackground: false,
            },
            properties: {
              type: 'satellite',
              satnum: tle.satnum,
              name: tle.name,
            },
          })

          // Orbit track for ISS only (too many lines for all sats)
          let orbitEntity: Cesium.Entity | undefined
          if (isISS) {
            const orbitPositions = computeOrbitTrack(satrec, new Date())
            orbitEntity = viewer.entities.add({
              name: 'ISS orbit',
              polyline: {
                positions: new Cesium.ConstantProperty(orbitPositions),
                width: 2,
                material: Cesium.Color.fromBytes(255, 234, 74, 180),
                arcType: Cesium.ArcType.NONE,
              },
            })
          }

          sats.push({ satrec, name: tle.name, satnum: tle.satnum, entity, orbitEntity })
        } catch {
          // skip bad TLE
        }
      }

      satsRef.current = sats
      console.log(`[satellites-overlay] rendered ${sats.length} satellites`)

      // Refresh ISS orbit track every 30s from Cesium clock
      refreshTimerRef.current = setInterval(() => {
        if (viewer.isDestroyed?.()) return
        const current = Cesium.JulianDate.toDate(viewer.clock.currentTime)
        for (const sat of sats) {
          if (sat.satnum === 25544 && sat.orbitEntity) {
            const positions = computeOrbitTrack(sat.satrec, current)
            ;(sat.orbitEntity.polyline as any).positions = new Cesium.ConstantProperty(positions)
          }
        }
      }, 30_000)
    }

    loadAndRender()

    // Ensure clock runs for SGP4 propagation
    viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED
    if (!viewer.clock.shouldAnimate) viewer.clock.shouldAnimate = true

    cleanup = () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      if (!viewer.isDestroyed?.()) {
        for (const sat of sats) {
          try {
            viewer.entities.remove(sat.entity)
            if (sat.orbitEntity) viewer.entities.remove(sat.orbitEntity)
          } catch {}
        }
      }
      sats = []
      satsRef.current = []
    }

    return cleanup
  }, [viewer, enabled])

  return null
}

// Compute one orbit ground track — each point uses its own GMST
function computeOrbitTrack(satrec: satellite.SatRec, epoch: Date): Cesium.Cartesian3[] {
  const orbitPeriodSeconds = 92 * 60
  const stepSeconds = 20
  const positions: Cesium.Cartesian3[] = []

  for (let i = 0; i <= orbitPeriodSeconds; i += stepSeconds) {
    const t = new Date(epoch.getTime() + i * 1000)
    const pv = satellite.propagate(satrec, t)
    if (!pv || !pv.position || typeof pv.position !== 'object' || !('x' in pv.position)) continue

    const gmst = satellite.gstime(t)
    const ecf = satellite.eciToEcf(
      pv.position as { x: number; y: number; z: number },
      gmst
    )
    positions.push(new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000))
  }

  return positions
}
