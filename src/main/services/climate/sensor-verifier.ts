/**
 * SensorVerifier — ported from OGOS climate/sensorVerifier.ts.
 *
 * Verifies per-station sensor health: transmission liveness, regularity,
 * field completeness, sensor drift, calibration, and availability.
 * Emits alerts via the supplied onAlert sink.
 */

import type {
  ClimateStation,
  ClimateMeasurement,
  SensorHealth,
  SensorCheck,
  IntegrityStatus,
  ClimateDataSource,
  ClimateAlert,
} from '@shared/types'

const SOURCE_EXPECTED_FIELDS: Record<ClimateDataSource, string[]> = {
  NOAA_NDBC: ['waterTemp', 'airTemp', 'windSpeed', 'windDir', 'waveHeight', 'pressure'],
  ARGO: ['waterTemp', 'salinity', 'depth'],
  BGC_ARGO: ['waterTemp', 'salinity', 'depth', 'oxygen', 'nitrate', 'ph', 'chl'],
  NOAA_ERDDAP: ['waterTemp', 'salinity'],
  GTSPP: ['waterTemp', 'salinity', 'depth'],
  TAO_PIRATA: ['waterTemp', 'salinity', 'currentSpeed', 'currentDir'],
  PMEL_CO2: ['waterTemp', 'salinity', 'co2'],
  NWS_WEATHER: ['airTemp', 'windSpeed', 'windDir', 'pressure'],
  NHC_STORM: ['windSpeed', 'pressure'],
  BLITZORTUNG_LIGHTNING: [],
  NOAA_SWPC: [],
  NASA_FIRMS: [],
}

const SOURCE_EXPECTED_INTERVAL_MS: Record<ClimateDataSource, number> = {
  NOAA_NDBC: 10 * 60 * 1000,
  ARGO: 10 * 24 * 60 * 60 * 1000,
  BGC_ARGO: 10 * 24 * 60 * 60 * 1000,
  NOAA_ERDDAP: 10 * 60 * 1000,
  GTSPP: 24 * 60 * 60 * 1000,
  TAO_PIRATA: 24 * 60 * 60 * 1000,
  PMEL_CO2: 3 * 60 * 60 * 1000,
  NWS_WEATHER: 60 * 60 * 1000,
  NHC_STORM: 2 * 60 * 1000,
  BLITZORTUNG_LIGHTNING: 60 * 1000,
  NOAA_SWPC: 5 * 60 * 1000,
  NASA_FIRMS: 60 * 60 * 1000,
}

const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000
const DRIFT_THRESHOLD = 2.0
const DRIFT_MIN_SAMPLES = 5

interface SensorHistory {
  stationId: string
  transmissions: number[]
  measurements: ClimateMeasurement[]
  fieldHistory: Map<string, number[]>
  lastValue: Map<string, number>
  lastTimestamp: number
  consecutiveFailures: number
  knownFields: string[]
}

export class SensorVerifier {
  private history = new Map<string, SensorHistory>()
  private onAlert: (alert: ClimateAlert) => void

  constructor(onAlert: (alert: ClimateAlert) => void) {
    this.onAlert = onAlert
  }

  verify(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
  ): Map<string, SensorHealth> {
    const results = new Map<string, SensorHealth>()

    for (const station of stations) {
      const m = measurements.get(station.id)
      const history = this.getOrCreateHistory(station.id)

      const checks: SensorCheck[] = []
      let score = 100
      let status: IntegrityStatus = 'verified'

      const now = Date.now()
      const lastTx = m?.timestamp ?? station.lastUpdate
      const timeSinceTx = now - lastTx
      const expectedInterval =
        SOURCE_EXPECTED_INTERVAL_MS[station.source] ?? STALE_THRESHOLD_MS

      if (!m) {
        checks.push({
          check: 'Transmission Liveness',
          status: 'stale',
          message: `No measurement received. Last seen ${Math.round(timeSinceTx / 60000)}m ago.`,
          value: `${Math.round(timeSinceTx / 60000)}m`,
        })
        score -= 30
        history.consecutiveFailures++
      } else {
        history.consecutiveFailures = 0
        checks.push({
          check: 'Transmission Liveness',
          status: timeSinceTx < expectedInterval ? 'verified' : 'stale',
          message: `Last transmission ${Math.round(timeSinceTx / 60000)}m ago (expected every ${Math.round(expectedInterval / 60000)}m)`,
          value: `${Math.round(timeSinceTx / 60000)}m`,
        })
        if (timeSinceTx > expectedInterval * 2) score -= 25
        else if (timeSinceTx > expectedInterval) score -= 10
      }

      if (history.transmissions.length >= 3) {
        const intervals: number[] = []
        for (let i = 1; i < history.transmissions.length; i++) {
          intervals.push(history.transmissions[i] - history.transmissions[i - 1])
        }
        const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
        const variance =
          intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length
        const cv = meanInterval > 0 ? Math.sqrt(variance) / meanInterval : 1
        const regularity = Math.max(0, 1 - cv)

        checks.push({
          check: 'Transmission Regularity',
          status:
            regularity > 0.7 ? 'verified' : regularity > 0.4 ? 'warning' : 'failed',
          message: `Interval CV: ${cv.toFixed(2)}, regularity: ${(regularity * 100).toFixed(0)}%`,
          value: `${(regularity * 100).toFixed(0)}%`,
        })

        if (regularity < 0.4) score -= 15
      } else {
        checks.push({
          check: 'Transmission Regularity',
          status: 'unknown',
          message: 'Insufficient history for regularity analysis',
        })
      }

      const expectedFields = SOURCE_EXPECTED_FIELDS[station.source] ?? []
      const receivedFields = m
        ? Object.keys(m).filter((k) => {
            const val = (m as any)[k]
            return val !== undefined && val !== null && !isNaN(val)
          })
        : []
      const missingFields = expectedFields.filter((f) => !receivedFields.includes(f))

      checks.push({
        check: 'Field Completeness',
        status:
          missingFields.length === 0
            ? 'verified'
            : missingFields.length <= 2
              ? 'warning'
              : 'failed',
        message:
          missingFields.length === 0
            ? `All ${expectedFields.length} expected fields present`
            : `Missing ${missingFields.length}/${expectedFields.length}: ${missingFields.join(', ')}`,
        value: `${receivedFields.length}/${expectedFields.length}`,
      })

      if (missingFields.length > 0) {
        score -= missingFields.length * 5
      }

      let driftDetected = false
      const driftDetails: string[] = []

      if (m) {
        for (const field of ['waterTemp', 'airTemp', 'salinity', 'co2', 'pressure']) {
          const val = (m as any)[field] as number | undefined
          if (val === undefined) continue

          const histArr = history.fieldHistory.get(field) ?? []
          if (histArr.length >= DRIFT_MIN_SAMPLES) {
            const mean = histArr.reduce((a, b) => a + b, 0) / histArr.length
            const stdDev = Math.sqrt(
              histArr.reduce((a, b) => a + (b - mean) ** 2, 0) / histArr.length,
            )
            const zScore = stdDev > 0 ? Math.abs((val - mean) / stdDev) : 0

            if (zScore > DRIFT_THRESHOLD) {
              driftDetected = true
              driftDetails.push(
                `${field}: ${val.toFixed(2)} vs mean ${mean.toFixed(2)} (z=${zScore.toFixed(1)})`,
              )

              if (zScore > 3) {
                score -= 20
                this.fireAlert(
                  station,
                  'sensor_drift',
                  `${field} drift detected: z-score ${zScore.toFixed(1)}`,
                  'critical',
                  field,
                )
              } else {
                score -= 10
                this.fireAlert(
                  station,
                  'sensor_drift',
                  `${field} drift: z-score ${zScore.toFixed(1)}`,
                  'warning',
                  field,
                )
              }
            }
          }
        }
      }

      checks.push({
        check: 'Sensor Drift',
        status: driftDetected
          ? 'failed'
          : history.transmissions.length >= DRIFT_MIN_SAMPLES
            ? 'verified'
            : 'unknown',
        message: driftDetected
          ? `Drift detected: ${driftDetails.join('; ')}`
          : 'No drift detected within statistical bounds',
        value: driftDetected ? 'DRIFT' : 'OK',
      })

      const calibrationStatus = driftDetected
        ? 'drift'
        : history.transmissions.length >= DRIFT_MIN_SAMPLES
          ? 'ok'
          : 'unknown'
      checks.push({
        check: 'Calibration Status',
        status:
          calibrationStatus === 'ok'
            ? 'verified'
            : calibrationStatus === 'drift'
              ? 'failed'
              : 'unknown',
        message:
          calibrationStatus === 'ok'
            ? 'Within calibration bounds'
            : calibrationStatus === 'drift'
              ? 'Calibration drift detected — sensor may need servicing'
              : 'Insufficient baseline for calibration check',
        value: calibrationStatus.toUpperCase(),
      })

      if (history.consecutiveFailures >= 3) {
        checks.push({
          check: 'Sensor Availability',
          status: 'failed',
          message: `${history.consecutiveFailures} consecutive failed transmissions`,
          value: `${history.consecutiveFailures}`,
        })
        score -= 20
        if (history.consecutiveFailures === 3) {
          this.fireAlert(
            station,
            'sensor_offline',
            `Sensor offline: ${history.consecutiveFailures} consecutive failures`,
            'critical',
          )
        }
      } else {
        checks.push({
          check: 'Sensor Availability',
          status: 'verified',
          message:
            history.consecutiveFailures === 0
              ? 'No transmission failures'
              : `${history.consecutiveFailures} recent failure(s)`,
          value: `${history.consecutiveFailures}`,
        })
      }

      if (m) {
        history.transmissions.push(m.timestamp)
        if (history.transmissions.length > 50) history.transmissions.shift()
        history.measurements.push(m)
        if (history.measurements.length > 50) history.measurements.shift()
        history.lastTimestamp = m.timestamp

        for (const field of [
          'waterTemp',
          'airTemp',
          'salinity',
          'co2',
          'pressure',
          'windSpeed',
          'waveHeight',
        ]) {
          const val = (m as any)[field] as number | undefined
          if (val !== undefined && !isNaN(val)) {
            const arr = history.fieldHistory.get(field) ?? []
            arr.push(val)
            if (arr.length > 100) arr.shift()
            history.fieldHistory.set(field, arr)
            history.lastValue.set(field, val)
          }
        }
      }

      const totalExpected = Math.max(
        1,
        Math.floor((now - (history.transmissions[0] ?? now)) / expectedInterval),
      )
      const uptimePercent = Math.min(
        100,
        (history.transmissions.length / totalExpected) * 100,
      )

      let regularityScore = 0
      if (history.transmissions.length >= 3) {
        const intervals: number[] = []
        for (let i = 1; i < history.transmissions.length; i++) {
          intervals.push(history.transmissions[i] - history.transmissions[i - 1])
        }
        const meanInt = intervals.reduce((a, b) => a + b, 0) / intervals.length
        const variance = intervals.reduce((a, b) => a + (b - meanInt) ** 2, 0) / intervals.length
        const stdDevInt = Math.sqrt(variance)
        regularityScore = meanInt > 0 ? Math.max(0, 1 - stdDevInt / meanInt) : 0
      }

      score = Math.max(0, Math.min(100, score))
      if (score >= 80) status = 'verified'
      else if (score >= 50) status = 'warning'
      else status = 'failed'

      results.set(station.id, {
        stationId: station.id,
        status,
        integrityScore: score,
        lastTransmission: lastTx,
        expectedIntervalMs: expectedInterval,
        actualIntervalMs:
          history.transmissions.length >= 2
            ? (history.transmissions[history.transmissions.length - 1] -
                history.transmissions[0]) /
              (history.transmissions.length - 1)
            : 0,
        transmissionCount: history.transmissions.length,
        missedTransmissions: Math.max(0, totalExpected - history.transmissions.length),
        transmissionRegularity: regularityScore,
        fieldsExpected: expectedFields,
        fieldsReceived: receivedFields,
        fieldsMissing: missingFields,
        driftDetected,
        driftDetails,
        calibrationStatus,
        consecutiveFailures: history.consecutiveFailures,
        uptimePercent,
        checks,
      })
    }

    return results
  }

  private getOrCreateHistory(stationId: string): SensorHistory {
    if (!this.history.has(stationId)) {
      this.history.set(stationId, {
        stationId,
        transmissions: [],
        measurements: [],
        fieldHistory: new Map(),
        lastValue: new Map(),
        lastTimestamp: 0,
        consecutiveFailures: 0,
        knownFields: [],
      })
    }
    return this.history.get(stationId)!
  }

  private fireAlert(
    station: ClimateStation,
    type: ClimateAlert['type'],
    message: string,
    severity: ClimateAlert['severity'],
    field?: string,
  ) {
    this.onAlert({
      id: `${type}_${station.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type,
      stationId: station.id,
      stationName: station.name,
      source: station.source,
      lat: station.lat,
      lon: station.lon,
      message,
      severity,
      field,
    })
  }
}
