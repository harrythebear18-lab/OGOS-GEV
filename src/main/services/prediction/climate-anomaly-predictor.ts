/* Climate Anomaly Prediction Predictor — ported from OGOS.
 * Per-station z-score/trend anomaly detection with linear trend extrapolation. */
import type { ClimateStation, ClimateMeasurement, PredictionAlert } from '@shared/types'

const FIELDS_TO_MONITOR = ['waterTemp', 'airTemp', 'salinity', 'co2', 'pressure', 'windSpeed', 'waveHeight']
const HOURS_AHEAD = 24
const ZSCORE_THRESHOLDS = { low: 1.5, moderate: 2.0, high: 2.5, critical: 3.0 }

type Severity = 'low' | 'moderate' | 'high' | 'critical'

function computeStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 }
  const m = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length
  return { mean: m, stdDev: Math.sqrt(variance) }
}

function computeTrend(values: number[], timestamps: number[]): number {
  if (values.length < 3) return 0
  const n = values.length
  const xMean = timestamps.reduce((a, b) => a + b, 0) / n
  const yMean = values.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (timestamps[i] - xMean) * (values[i] - yMean)
    den += (timestamps[i] - xMean) ** 2
  }
  const slopePerMs = den > 0 ? num / den : 0
  return slopePerMs * (24 * 60 * 60 * 1000) // per-day
}

function riskFromZScore(z: number, trendPerDay: number): Severity {
  const absZ = Math.abs(z)
  const trendAmplifies = (z > 0 && trendPerDay > 0) || (z < 0 && trendPerDay < 0)
  const effectiveZ = trendAmplifies ? absZ + Math.abs(trendPerDay) * 0.1 : absZ
  if (effectiveZ >= ZSCORE_THRESHOLDS.critical) return 'critical'
  if (effectiveZ >= ZSCORE_THRESHOLDS.high) return 'high'
  if (effectiveZ >= ZSCORE_THRESHOLDS.moderate) return 'moderate'
  return 'low'
}

function confidenceFromSamples(n: number): number {
  if (n >= 20) return 0.9
  if (n >= 10) return 0.6
  return 0.3
}

interface FieldHistory {
  values: number[]
  timestamps: number[]
}

export class ClimateAnomalyPredictor {
  private history = new Map<string, Map<string, FieldHistory>>()
  private maxHistory = 100

  /** Update internal history with new measurements. */
  updateHistory(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): void {
    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m) continue
      let stationHist = this.history.get(station.id)
      if (!stationHist) {
        stationHist = new Map()
        this.history.set(station.id, stationHist)
      }
      for (const field of FIELDS_TO_MONITOR) {
        const val = (m as unknown as Record<string, unknown>)[field] as number | undefined
        if (val === undefined || isNaN(val)) continue
        let fh = stationHist.get(field)
        if (!fh) {
          fh = { values: [], timestamps: [] }
          stationHist.set(field, fh)
        }
        fh.values.push(val)
        fh.timestamps.push(m.timestamp)
        if (fh.values.length > this.maxHistory) {
          fh.values.shift()
          fh.timestamps.shift()
        }
      }
    }
  }

  /** Generate anomaly predictions for all stations with sufficient history. */
  predict(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): PredictionAlert[] {
    const alerts: PredictionAlert[] = []
    const now = Date.now()

    for (const station of stations) {
      const m = measurements.get(station.id)
      if (!m) continue
      const stationHist = this.history.get(station.id)
      if (!stationHist) continue

      for (const field of FIELDS_TO_MONITOR) {
        const fh = stationHist.get(field)
        if (!fh || fh.values.length < 5) continue

        const currentValue = (m as unknown as Record<string, unknown>)[field] as number
        if (currentValue === undefined || isNaN(currentValue)) continue

        const baselineValues = fh.values.slice(0, -1)
        const { mean: bMean, stdDev } = computeStats(baselineValues)
        if (stdDev === 0) continue

        const currentZScore = (currentValue - bMean) / stdDev
        if (Math.abs(currentZScore) < 1.0) continue

        const recentN = Math.min(fh.values.length, 20)
        const trendPerDay = computeTrend(fh.values.slice(-recentN), fh.timestamps.slice(-recentN))
        const risk = riskFromZScore(currentZScore, trendPerDay)
        const confidence = confidenceFromSamples(baselineValues.length)

        const direction = currentZScore > 0 ? 'above' : 'below'
        const trendDir = trendPerDay > 0 ? 'increasing' : trendPerDay < 0 ? 'decreasing' : 'stable'

        alerts.push({
          id: `anomaly-${station.id}-${field}-${now}`,
          type: 'climate_anomaly',
          severity: risk,
          lat: station.lat,
          lon: station.lon,
          title: `${field} anomaly — ${station.name}`,
          description: `${field} ${direction} baseline (z=${currentZScore.toFixed(1)}), trend ${trendDir}. Current: ${currentValue.toFixed(2)}, baseline: ${bMean.toFixed(2)}`,
          confidence,
          validUntil: now + 24 * 60 * 60 * 1000,
        })
      }
    }

    // Sort by severity (critical first)
    const riskOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 }
    alerts.sort((a, b) => (riskOrder[a.severity] ?? 5) - (riskOrder[b.severity] ?? 5))

    console.log(`[prediction/climate-anomaly] ${alerts.length} anomalies detected`)
    return alerts
  }
}
