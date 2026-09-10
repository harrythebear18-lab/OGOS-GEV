/* Asset verifier — verifies asset health (transmission liveness, field
 * completeness, drift detection). Ported from OGOS assetVerifier.ts. */

import type { GridAssetType } from '@shared/types'
import {
  type InternalGridAsset,
  type AssetMeasurement,
  type AssetHealth,
  type AssetCheck,
  type GridIntegrityStatus,
} from './grid-data'

interface AssetHistory {
  measurements: AssetMeasurement[]
  lastUpdate: number
  transmissionCount: number
  missedTransmissions: number
  lastInterval: number
}

export class AssetVerifier {
  private history = new Map<string, AssetHistory>()
  private expectedIntervalMs = 60_000
  private maxHistory = 20

  verify(asset: InternalGridAsset, measurement: AssetMeasurement | undefined, now: number): AssetHealth {
    const hist = this.history.get(asset.id) ?? {
      measurements: [],
      lastUpdate: 0,
      transmissionCount: 0,
      missedTransmissions: 0,
      lastInterval: 0,
    }

    const hasMeasurement = measurement !== undefined
    const timeSinceLast = hasMeasurement ? now - measurement.timestamp : now - hist.lastUpdate
    const isStale = timeSinceLast > this.expectedIntervalMs * 2
    const isFailed = timeSinceLast > this.expectedIntervalMs * 5 || !asset.active

    if (hasMeasurement) {
      hist.measurements.push(measurement!)
      if (hist.measurements.length > this.maxHistory) hist.measurements.shift()
      hist.transmissionCount++
      hist.lastInterval = measurement!.timestamp - hist.lastUpdate
      hist.lastUpdate = measurement!.timestamp
    } else {
      hist.missedTransmissions++
    }
    this.history.set(asset.id, hist)

    const checks: AssetCheck[] = []

    if (isFailed) {
      checks.push({ check: 'transmission_liveness', status: 'failed', message: 'No recent transmission' })
    } else if (isStale) {
      checks.push({ check: 'transmission_liveness', status: 'stale', message: 'Transmission delayed' })
    } else {
      checks.push({ check: 'transmission_liveness', status: 'verified', message: 'Transmitting normally' })
    }

    const fieldsExpected = this.fieldsExpectedFor(asset.type)
    const fieldsReceived = measurement ? Object.keys(measurement).filter((k) => measurement[k as keyof AssetMeasurement] !== undefined) : []
    const missing = fieldsExpected.filter((f) => !fieldsReceived.includes(f))
    if (missing.length > 0) {
      checks.push({ check: 'field_completeness', status: 'warning', message: `Missing fields: ${missing.join(', ')}` })
    } else {
      checks.push({ check: 'field_completeness', status: 'verified', message: 'All fields present' })
    }

    const drift = this.detectDrift(hist.measurements, asset.type)
    if (drift.detected) {
      checks.push({ check: 'drift', status: 'warning', message: drift.reason })
    } else {
      checks.push({ check: 'drift', status: 'verified', message: 'No drift detected' })
    }

    const status: GridIntegrityStatus = isFailed ? 'failed' : isStale ? 'stale' : drift.detected ? 'warning' : missing.length > 0 ? 'warning' : 'verified'

    const integrityScore = Math.max(0, Math.min(100,
      100
      - (isFailed ? 50 : isStale ? 25 : 0)
      - (missing.length > 0 ? 15 : 0)
      - (drift.detected ? 15 : 0),
    ))

    return {
      assetId: asset.id,
      status,
      integrityScore,
      lastTransmission: hist.lastUpdate || now,
      expectedIntervalMs: this.expectedIntervalMs,
      actualIntervalMs: hist.lastInterval,
      transmissionCount: hist.transmissionCount,
      missedTransmissions: hist.missedTransmissions,
      transmissionRegularity: Math.max(0, 1 - Math.abs(hist.lastInterval - this.expectedIntervalMs) / this.expectedIntervalMs),
      fieldsExpected,
      fieldsReceived,
      fieldsMissing: missing,
      driftDetected: drift.detected,
      driftDetails: drift.detected ? [drift.reason] : [],
      calibrationStatus: 'ok',
      consecutiveFailures: isFailed ? Math.min(10, this.history.get(asset.id)?.missedTransmissions ?? 0) : 0,
      uptimePercent: Math.max(0, 100 - (hist.missedTransmissions / Math.max(1, hist.transmissionCount + hist.missedTransmissions)) * 100),
      checks,
    }
  }

  private fieldsExpectedFor(type: GridAssetType): string[] {
    switch (type) {
      case 'power_plant':
      case 'renewable_farm':
        return ['assetId', 'timestamp', 'loadMw', 'generationMw', 'voltageKv', 'frequencyHz', 'temperatureC']
      case 'substation':
      case 'transformer':
        return ['assetId', 'timestamp', 'loadMw', 'voltageKv', 'frequencyHz']
      case 'battery_storage':
        return ['assetId', 'timestamp', 'loadMw', 'storedMwh', 'maxStorageMwh']
      case 'data_center':
      case 'ai_center':
        return ['assetId', 'timestamp', 'itLoadMw', 'totalFacilityLoadMw', 'utilizationPercent', 'pue']
      case 'edge_node':
        return ['assetId', 'timestamp', 'itLoadMw']
      default:
        return ['assetId', 'timestamp']
    }
  }

  private detectDrift(measurements: AssetMeasurement[], type: GridAssetType): { detected: boolean; reason: string } {
    if (measurements.length < 5) return { detected: false, reason: '' }
    const recent = measurements.slice(-5)
    const key = this.driftKeyFor(type)
    const values = recent.map((m) => Number(m[key] ?? 0)).filter((v) => v !== 0)
    if (values.length < 3) return { detected: false, reason: '' }
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const last = values[values.length - 1]
    const prev = values[values.length - 2]
    if (avg === 0) return { detected: false, reason: '' }
    const change = Math.abs((last - prev) / avg)
    if (change > 0.5) {
      return { detected: true, reason: `Large ${key} jump (${(change * 100).toFixed(0)}% vs avg)` }
    }
    return { detected: false, reason: '' }
  }

  private driftKeyFor(type: GridAssetType): 'loadMw' | 'itLoadMw' | 'storedMwh' {
    if (type === 'data_center' || type === 'ai_center') return 'itLoadMw'
    if (type === 'battery_storage') return 'storedMwh'
    return 'loadMw'
  }
}

export const assetVerifier = new AssetVerifier()
