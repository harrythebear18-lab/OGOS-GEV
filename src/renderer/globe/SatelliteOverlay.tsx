import { useEffect } from 'react'
import * as satellite from 'satellite.js'
import * as Cesium from 'cesium'

interface SatelliteOverlayProps {
  viewer: Cesium.Viewer
}

// ISS (ZARYA) — recent TLE from CelesTrak.
// Epoch: 2026-09-08 ~11:11 UTC (day 251.466 of 2026)
const ISS_TLE_LINE1 = '1 25544U 98067A   26251.46617104  .00001902  00000+0  42648-4 0  9994'
const ISS_TLE_LINE2 = '2 25544  51.6295 247.9233 0004929 112.8116 247.3394 15.49040812584669'

export default function SatelliteOverlay({ viewer }: SatelliteOverlayProps) {
  useEffect(() => {
    if (!viewer || viewer.isDestroyed?.()) return

    const satrec = satellite.twoline2satrec(ISS_TLE_LINE1, ISS_TLE_LINE2)

    // ── Compute orbit ring in ECI, then convert all points to ECF at ONE epoch ──
    // This gives a proper orbit ellipse, not a ground track.
    // ISS orbital period: ~92.68 minutes. Use 92 minutes for one full revolution.
    const orbitPeriodSeconds = 92 * 60
    const stepSeconds = 20 // finer step for smoother ring

    function computeOrbitRing(epoch: Date): Cesium.Cartesian3[] {
      // Use a single GMST for all points — this makes a proper orbit ring
      const gmst = satellite.gstime(epoch)
      const positions: Cesium.Cartesian3[] = []

      for (let i = 0; i <= orbitPeriodSeconds; i += stepSeconds) {
        const t = new Date(epoch.getTime() + i * 1000)
        const pv = satellite.propagate(satrec, t)
        if (!pv) continue
        const pos = pv.position
        if (!pos || typeof pos !== 'object' || !('x' in pos)) continue

        // Convert ECI → ECF using the SAME gmst for all points
        const ecf = satellite.eciToEcf(pos as { x: number; y: number; z: number }, gmst)
        // satellite.js returns km, Cesium expects meters
        positions.push(new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000))
      }

      return positions
    }

    // ── Satellite position: CallbackProperty for real-time SGP4 propagation ──
    // This computes the ISS position from Cesium's clock every frame.
    function computeSatPosition(time: Cesium.JulianDate | undefined): Cesium.Cartesian3 {
      if (!time) return new Cesium.Cartesian3(0, 0, 0)
      const date = Cesium.JulianDate.toDate(time)
      const pv = satellite.propagate(satrec, date)
      if (!pv || !pv.position || typeof pv.position !== 'object' || !('x' in pv.position)) {
        return new Cesium.Cartesian3(0, 0, 0)
      }
      const gmst = satellite.gstime(date)
      const ecf = satellite.eciToEcf(pv.position as { x: number; y: number; z: number }, gmst)
      return new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000)
    }

    // Initial orbit ring at current time
    const now = new Date()
    let orbitPositions = computeOrbitRing(now)

    const orbitEntity = viewer.entities.add({
      name: 'ISS orbit',
      polyline: {
        positions: new Cesium.ConstantProperty(orbitPositions),
        width: 2,
        material: Cesium.Color.fromBytes(255, 234, 74, 180),
        arcType: Cesium.ArcType.NONE,
      },
    })

    // Satellite entity with callback position — real-time SGP4
    const positionCallback = new Cesium.CallbackProperty((time?: Cesium.JulianDate) => {
      return computeSatPosition(time)
    }, false)

    const satEntity = viewer.entities.add({
      name: 'ISS (ZARYA)',
      position: positionCallback as any,
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromBytes(255, 74, 74, 255),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: 'ISS',
        font: '11px monospace',
        fillColor: Cesium.Color.fromBytes(255, 74, 74, 255),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // Refresh orbit ring every 60 seconds to account for Earth's rotation
    // (the ring slowly drifts in ECF as Earth rotates under the orbit)
    const ringRefreshTimer = setInterval(() => {
      if (viewer.isDestroyed?.()) return
      const current = Cesium.JulianDate.toDate(viewer.clock.currentTime)
      orbitPositions = computeOrbitRing(current)
      ;(orbitEntity.polyline as any).positions = new Cesium.ConstantProperty(orbitPositions)
    }, 60_000)

    // Make sure Cesium's clock is at real-time and advancing
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date())
    viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED
    viewer.clock.multiplier = 1.0
    viewer.clock.shouldAnimate = true

    return () => {
      clearInterval(ringRefreshTimer)
      if (viewer.isDestroyed?.()) return
      try {
        viewer.entities.remove(orbitEntity)
        viewer.entities.remove(satEntity)
      } catch {}
    }
  }, [viewer])

  return null
}
