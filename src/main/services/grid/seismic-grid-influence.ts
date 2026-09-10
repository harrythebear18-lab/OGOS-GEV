/* Cross-domain influence: seismic events → grid/infrastructure risk alerts.
 * Ported from OGOS seismicGridInfluence.ts. */

import {
  type InternalGridAsset,
  type InternalGridAlert,
  type GridAlertType,
  type InternalSeverity,
  distanceKm,
} from './grid-data'

/** Minimal earthquake shape for seismic influence. */
export interface EarthquakeInput {
  id: string
  mag: number
  lat: number
  lon: number
  tsunami?: boolean
}

function seismicRadiusKm(mag: number): number {
  if (mag >= 7) return 1000
  if (mag >= 6) return 500
  if (mag >= 5) return 200
  if (mag >= 4) return 100
  return 50
}

/** Generate grid risk alerts from earthquakes + grid assets. */
export function generateSeismicGridAlerts(
  earthquakes: EarthquakeInput[],
  assets: InternalGridAsset[],
): InternalGridAlert[] {
  const alerts: InternalGridAlert[] = []
  const now = Date.now()

  const significant = earthquakes.filter((e) => e.mag >= 4.0)

  for (const eq of significant) {
    const radiusKm = seismicRadiusKm(eq.mag)

    for (const asset of assets) {
      if (!asset.active) continue

      const dist = distanceKm(eq.lat, eq.lon, asset.lat, asset.lon)
      if (dist > radiusKm) continue

      const proximityFactor = 1 - dist / radiusKm
      let alertSeverity: InternalSeverity = 'info'

      if (eq.mag >= 7) {
        alertSeverity = proximityFactor > 0.3 ? 'critical' : 'warning'
      } else if (eq.mag >= 6) {
        alertSeverity = proximityFactor > 0.5 ? 'critical' : 'warning'
      } else if (eq.mag >= 5) {
        alertSeverity = proximityFactor > 0.7 ? 'warning' : 'info'
      } else {
        alertSeverity = 'info'
      }

      let message = ''
      let alertType: GridAlertType = 'regional_anomaly'

      const magStr = `M${eq.mag.toFixed(1)}`
      const distStr = dist < 50 ? 'directly nearby' : `${dist.toFixed(0)}km away`
      const tsunamiStr = eq.tsunami ? ' — TSUNAMI RISK' : ''

      if (asset.type === 'power_plant') {
        message = `${magStr} earthquake ${distStr}${tsunamiStr} — risk of generation shutdown, turbine damage`
        alertType = 'capacity_exceeded'
      } else if (asset.type === 'substation' || asset.type === 'transformer') {
        message = `${magStr} earthquake ${distStr} — risk of transformer damage, breaker trip`
        alertType = 'interconnect_failure'
      } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
        message = `${magStr} earthquake ${distStr}${tsunamiStr} — risk of facility damage, cooling failure`
        alertType = 'pipeline_error'
      } else if (asset.type === 'renewable_farm') {
        message = `${magStr} earthquake ${distStr} — risk of structural damage to turbines/panels`
        alertType = 'capacity_exceeded'
      } else if (asset.type === 'battery_storage') {
        message = `${magStr} earthquake ${distStr} — risk of thermal runaway, structural damage`
        alertType = 'thermal_stress'
      } else {
        message = `${magStr} earthquake ${distStr}${tsunamiStr}`
      }

      if (!message) continue

      alerts.push({
        id: `seismic-${eq.id}-${asset.id}-${now}`,
        timestamp: now,
        type: alertType,
        assetId: asset.id,
        assetName: asset.name,
        source: asset.source,
        lat: asset.lat,
        lon: asset.lon,
        message,
        severity: alertSeverity,
        seismicCorrelated: true,
      })
    }
  }

  return alerts
}
