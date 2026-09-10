/* Storm Track Prediction Predictor — ported from OGOS.
 * 120-hour tropical cyclone track prediction using inertial persistence +
 * environmental steering flow. */
import type { Storm, StormTrackPoint, StormTrackPrediction, ClimateMeasurement } from '@shared/types'

const HOURS_TO_PREDICT = 120
const HOUR_STEP = 6

/** Confidence label → numeric mapping (0-1). */
const CONFIDENCE_NUM = { high: 0.9, medium: 0.6, low: 0.3 } as const
type ConfidenceLabel = keyof typeof CONFIDENCE_NUM

function classifyIntensity(windSpeedKt: number | undefined): string {
  if (windSpeedKt === undefined) return 'unknown'
  if (windSpeedKt < 34) return 'tropical_depression'
  if (windSpeedKt < 64) return 'tropical_storm'
  if (windSpeedKt < 83) return 'cat_1'
  if (windSpeedKt < 96) return 'cat_2'
  if (windSpeedKt < 113) return 'cat_3'
  if (windSpeedKt < 137) return 'cat_4'
  return 'cat_5'
}

function bearingToDeg(bearing: string | number | undefined): number {
  if (bearing === undefined) return 0
  if (typeof bearing === 'number') return bearing
  const parsed = parseFloat(bearing)
  return isNaN(parsed) ? 0 : parsed
}

/** Great-circle destination from lat/lon given speed (kt), bearing (deg), hours. */
function movePoint(lat: number, lon: number, speedKt: number, bearingDeg: number, hours: number): { lat: number; lon: number } {
  const distanceKm = speedKt * 1.852 * hours
  const R = 6371
  const brng = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const angularDist = distanceKm / R
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng),
  )
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
    Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2),
  )
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((lon2 * 180) / Math.PI + 540) % 360 - 180,
  }
}

export class StormTrackPredictor {
  /** Predict track for a single storm, returning StormTrackPrediction. */
  predict(
    storm: Storm,
    nearbyWaterTemps: { lat: number; lon: number; temp: number }[] = [],
  ): StormTrackPrediction {
    const currentSpeed = storm.movementSpeedKt ?? 10
    const currentBearing = bearingToDeg(storm.movementDir)
    const currentWind = storm.windSpeedKt ?? 0
    const currentPressure = storm.pressureMB ?? 1010

    // Steering flow: blend persistence + ambient
    const steeringSpeed = currentSpeed * 0.8 + 5
    const steeringBearing = currentBearing

    // Ocean heat content proxy from nearby water temps
    const nearbyTemps = nearbyWaterTemps
      .filter((t) => Math.abs(t.lat - storm.lat) < 10 && Math.abs(t.lon - storm.lon) < 10)
      .map((t) => t.temp)
    const avgOceanTemp = nearbyTemps.length > 0
      ? nearbyTemps.reduce((a, b) => a + b, 0) / nearbyTemps.length
      : 26

    let lat = storm.lat
    let lon = storm.lon
    let windSpeed = currentWind
    let pressure = currentPressure
    const positions: StormTrackPoint[] = []
    const now = Date.now()

    for (let h = HOUR_STEP; h <= HOURS_TO_PREDICT; h += HOUR_STEP) {
      // Inertial persistence weight decays over time
      const persistenceWeight = Math.max(0.3, 0.7 - (h / HOURS_TO_PREDICT) * 0.4)
      const steeringWeight = 1 - persistenceWeight

      const effectiveSpeed = currentSpeed * persistenceWeight + steeringSpeed * steeringWeight
      const effectiveBearing = currentBearing + (h / HOURS_TO_PREDICT) * 10 // slight recurve

      const moved = movePoint(lat, lon, effectiveSpeed, effectiveBearing, HOUR_STEP)
      lat = moved.lat
      lon = moved.lon

      // Intensity: persistence + ocean heat modulation
      const intensificationRate = (avgOceanTemp - 26.5) * 0.5
      const decayRate = h > 72 ? -2 : 0
      windSpeed = Math.max(20, windSpeed + intensificationRate + decayRate)
      pressure = Math.min(1020, pressure - intensificationRate * 0.5 + decayRate * 0.5)

      positions.push({
        lat: Math.round(lat * 1000) / 1000,
        lon: Math.round(lon * 1000) / 1000,
        timestamp: now + h * 60 * 60 * 1000,
        windSpeedKt: Math.round(windSpeed),
        pressureMB: Math.round(pressure),
        category: classifyIntensity(windSpeed),
        forecastHour: h,
      })
    }

    // Confidence
    let confidenceLabel: ConfidenceLabel = 'medium'
    if (storm.track.length >= 3 && currentWind > 0) confidenceLabel = 'high'
    if (storm.movementDir === undefined || storm.movementSpeedKt === undefined) {
      confidenceLabel = 'low'
    }

    console.log(`[prediction/storm-track] ${storm.name}: ${positions.length} forecast points, ${classifyIntensity(currentWind)}, confidence ${confidenceLabel}`)

    return {
      stormId: storm.id,
      stormName: storm.name,
      positions,
      confidence: CONFIDENCE_NUM[confidenceLabel],
    }
  }

  /** Predict tracks for all active storms. */
  predictAll(
    storms: Storm[],
    measurements: Map<string, ClimateMeasurement> = new Map(),
  ): StormTrackPrediction[] {
    // Build water temp array from measurements
    const waterTemps: { lat: number; lon: number; temp: number }[] = []
    for (const [, m] of measurements) {
      if (m.waterTemp !== undefined) {
        // Measurements don't carry lat/lon; use station lookup if available
        waterTemps.push({ lat: 0, lon: 0, temp: m.waterTemp })
      }
    }
    return storms.map((s) => this.predict(s, waterTemps))
  }
}
