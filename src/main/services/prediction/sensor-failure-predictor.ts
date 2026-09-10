/* Sensor Failure Prediction Predictor — ported from OGOS.
 * Failure probability from sensor health history using a weighted logistic model. */
import type { ClimateStation, PredictionAlert } from '@shared/types'

/** Minimal sensor health interface (OGOS SensorHealth is not in shared types). */
export interface SensorHealth {
  stationId: string
  status: string
  lastTransmission: number
  transmissionCount: number
  transmissionRegularity: number
  fieldsExpected: string[]
  fieldsMissing: string[]
  driftDetected: boolean
  driftDetails: string[]
  calibrationStatus: 'ok' | 'drift' | 'unknown'
  consecutiveFailures: number
  uptimePercent: number
}

type Severity = 'low' | 'moderate' | 'high' | 'critical'

function riskFromProbability(p: number): Severity {
  if (p >= 0.8) return 'critical'
  if (p >= 0.6) return 'high'
  if (p >= 0.3) return 'moderate'
  return 'low'
}

function confidenceFromData(h: SensorHealth): number {
  if (h.transmissionCount >= 20) return 0.9
  if (h.transmissionCount >= 10) return 0.6
  return 0.3
}

function estimateTimeToFailure(p: number, h: SensorHealth): string {
  if (p < 0.1) return 'No imminent failure predicted'
  if (p < 0.3) return 'Possible degradation within 7-14 days'
  const hoursSinceTx = (Date.now() - h.lastTransmission) / (1000 * 60 * 60)
  if (h.consecutiveFailures >= 5) return 'Failure likely within hours'
  if (h.consecutiveFailures >= 3) return 'Failure likely within 1-2 days'
  if (hoursSinceTx > 6) return 'Failure likely within 1-3 days'
  if (p >= 0.8) return 'Failure likely within 1-5 days'
  return 'Degradation expected within 3-7 days'
}

interface Factor {
  factor: string
  weight: number
  score: number
  detail: string
}

export class SensorFailurePredictor {
  /** Predict failure probability for a single sensor, returning a PredictionAlert or null. */
  predict(station: ClimateStation, health: SensorHealth): PredictionAlert | null {
    const factors: Factor[] = []
    const now = Date.now()

    // Factor 1: Drift detection (weight 0.25)
    if (health.driftDetected) {
      const driftSeverity = health.driftDetails.length
      factors.push({ factor: 'Calibration Drift', weight: 0.25, score: Math.min(1, 0.6 + driftSeverity * 0.15), detail: `${driftSeverity} field(s) with drift: ${health.driftDetails.join('; ')}` })
    } else if (health.calibrationStatus === 'unknown') {
      factors.push({ factor: 'Calibration Drift', weight: 0.25, score: 0.2, detail: 'Insufficient baseline for drift detection' })
    } else {
      factors.push({ factor: 'Calibration Drift', weight: 0.25, score: 0, detail: 'No drift detected' })
    }

    // Factor 2: Transmission regularity (weight 0.20)
    if (health.transmissionRegularity < 0.7) {
      factors.push({ factor: 'Transmission Regularity', weight: 0.20, score: Math.min(1, (0.7 - health.transmissionRegularity) * 2), detail: `Regularity: ${(health.transmissionRegularity * 100).toFixed(0)}% (below 70% threshold)` })
    } else {
      factors.push({ factor: 'Transmission Regularity', weight: 0.20, score: 0, detail: `Regularity: ${(health.transmissionRegularity * 100).toFixed(0)}% — normal` })
    }

    // Factor 3: Consecutive failures (weight 0.25)
    if (health.consecutiveFailures > 0) {
      factors.push({ factor: 'Consecutive Failures', weight: 0.25, score: Math.min(1, health.consecutiveFailures * 0.25), detail: `${health.consecutiveFailures} consecutive failed transmissions` })
    } else {
      factors.push({ factor: 'Consecutive Failures', weight: 0.25, score: 0, detail: 'No consecutive failures' })
    }

    // Factor 4: Uptime (weight 0.15)
    if (health.uptimePercent < 80) {
      factors.push({ factor: 'Uptime Decline', weight: 0.15, score: Math.min(1, (80 - health.uptimePercent) / 80), detail: `Uptime: ${health.uptimePercent.toFixed(1)}% (below 80%)` })
    } else {
      factors.push({ factor: 'Uptime Decline', weight: 0.15, score: 0, detail: `Uptime: ${health.uptimePercent.toFixed(1)}% — healthy` })
    }

    // Factor 5: Field completeness (weight 0.15)
    const missingRatio = health.fieldsExpected.length > 0 ? health.fieldsMissing.length / health.fieldsExpected.length : 0
    if (missingRatio > 0) {
      factors.push({ factor: 'Field Completeness', weight: 0.15, score: Math.min(1, missingRatio), detail: `Missing ${health.fieldsMissing.length}/${health.fieldsExpected.length} fields: ${health.fieldsMissing.join(', ')}` })
    } else {
      factors.push({ factor: 'Field Completeness', weight: 0.15, score: 0, detail: 'All expected fields present' })
    }

    // Weighted failure probability
    let probability = 0
    for (const f of factors) probability += f.score * f.weight
    probability = Math.min(1, Math.max(0, probability))

    if (probability < 0.05) return null

    const risk = riskFromProbability(probability)
    const confidence = confidenceFromData(health)
    const topFactors = factors.filter((f) => f.score > 0).sort((a, b) => b.score * b.weight - a.score * a.weight)

    return {
      id: `sensor-failure-${station.id}-${now}`,
      type: 'sensor_failure',
      severity: risk,
      lat: station.lat,
      lon: station.lon,
      title: `Sensor failure risk — ${station.name}`,
      description: `Failure probability ${(probability * 100).toFixed(0)}%. ${estimateTimeToFailure(probability, health)} Top factor: ${topFactors[0]?.factor ?? 'N/A'}`,
      confidence,
      validUntil: now + 48 * 60 * 60 * 1000,
    }
  }

  /** Predict failures for all sensors. */
  predictAll(stations: ClimateStation[], sensorHealth: Map<string, SensorHealth>): PredictionAlert[] {
    const alerts: PredictionAlert[] = []
    for (const station of stations) {
      const health = sensorHealth.get(station.id)
      if (!health) continue
      const alert = this.predict(station, health)
      if (alert) alerts.push(alert)
    }
    // Sort by severity (critical first)
    const riskOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 }
    alerts.sort((a, b) => (riskOrder[a.severity] ?? 5) - (riskOrder[b.severity] ?? 5))
    console.log(`[prediction/sensor-failure] ${alerts.length} sensors at risk`)
    return alerts
  }
}
