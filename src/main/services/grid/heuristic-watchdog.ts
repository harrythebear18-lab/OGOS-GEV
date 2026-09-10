/* Heuristic watchdog — anomaly detection generating GridAlerts.
 * Ported from OGOS heuristicWatchdog.ts. */

import {
  type InternalGridAsset,
  type AssetMeasurement,
  type InternalGridAlert,
  type GridAlertType,
  type CrossVerification,
  type AssetHealth,
} from './grid-data'

const VALID_ALERT_TYPES = new Set<string>([
  'asset_drift', 'data_gap', 'statistical_outlier', 'physical_implausible', 'cross_source_mismatch',
  'temporal_jump', 'pipeline_error', 'calibration_issue', 'new_asset', 'asset_offline', 'stuck_sensor',
  'regional_anomaly', 'capacity_exceeded', 'thermal_stress', 'interconnect_failure',
])

export class HeuristicWatchdog {
  private snoozeUntil = 0

  setSnooze(minutes: number): void {
    this.snoozeUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0
  }

  isSnoozed(): boolean {
    return this.snoozeUntil > Date.now()
  }

  generateAlerts(
    assets: InternalGridAsset[],
    measurements: Map<string, AssetMeasurement>,
    crossVerifications: CrossVerification[],
    assetHealth: Map<string, AssetHealth>,
  ): InternalGridAlert[] {
    if (this.isSnoozed()) return []
    const alerts: InternalGridAlert[] = []

    for (const asset of assets) {
      const m = measurements.get(asset.id)
      const health = assetHealth.get(asset.id)
      const cv = crossVerifications.find((v) => v.assetId === asset.id)

      const baseAlert = {
        assetId: asset.id,
        assetName: asset.name,
        source: asset.source,
        lat: asset.lat,
        lon: asset.lon,
        timestamp: Date.now(),
      }

      if (asset.invalidated) {
        alerts.push({
          ...baseAlert,
          id: `alert-inv-${asset.id}-${Date.now()}`,
          type: 'data_gap' as GridAlertType,
          severity: 'critical' as const,
          message: asset.invalidationReason ?? 'Asset auto-invalidated',
        })
        continue
      }

      if (health?.status === 'failed') {
        alerts.push({
          ...baseAlert,
          id: `alert-tx-${asset.id}-${Date.now()}`,
          type: 'data_gap' as GridAlertType,
          severity: 'critical' as const,
          message: 'Asset not transmitting',
        })
      }

      if (cv) {
        for (const flag of cv.flags) {
          if (!VALID_ALERT_TYPES.has(flag.type)) continue
          alerts.push({
            ...baseAlert,
            id: `alert-${flag.type}-${asset.id}-${Date.now()}`,
            type: flag.type as GridAlertType,
            severity: flag.severity,
            message: flag.message,
            field: flag.field,
          })
        }
      }

      if (asset.type === 'data_center' || asset.type === 'ai_center') {
        const capacity = asset.capacityMw ?? 0
        const load = m?.totalFacilityLoadMw ?? m?.itLoadMw ?? 0
        if (capacity > 0 && load > capacity * 0.95) {
          alerts.push({
            ...baseAlert,
            id: `alert-cap-${asset.id}-${Date.now()}`,
            type: 'capacity_exceeded' as GridAlertType,
            severity: 'warning' as const,
            message: `Load ${load.toFixed(0)} MW near capacity ${capacity} MW`,
          })
        }
      }

      if (m?.temperatureC !== undefined && m.temperatureC > 70) {
        alerts.push({
          ...baseAlert,
          id: `alert-thermal-${asset.id}-${Date.now()}`,
          type: 'thermal_stress' as GridAlertType,
          severity: (m.temperatureC > 85 ? 'critical' : 'warning') as 'critical' | 'warning',
          message: `Thermal stress ${m.temperatureC.toFixed(1)}°C`,
        })
      }
    }

    return alerts.slice(0, 50)
  }
}

export const heuristicWatchdog = new HeuristicWatchdog()
