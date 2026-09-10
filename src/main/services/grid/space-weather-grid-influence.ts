/* Cross-domain influence: space weather → grid risk alerts.
 * Ported from OGOS spaceWeatherGridInfluence.ts. Adapted to shared SpaceWeather type.
 *
 * Geomagnetic storms (G2+) can cause transformer damage, voltage instability,
 * and GPS degradation. Solar flares (M/X class) can cause radio blackouts
 * and GPS degradation. */

import type { SpaceWeather } from '@shared/types'
import {
  type InternalGridAsset,
  type InternalGridAlert,
  type GridAlertType,
  type InternalSeverity,
} from './grid-data'

/** Generate grid risk alerts from space weather conditions. */
export function generateSpaceWeatherGridAlerts(
  spaceWx: SpaceWeather,
  assets: InternalGridAsset[],
): InternalGridAlert[] {
  const alerts: InternalGridAlert[] = []
  const now = Date.now()

  const kp = spaceWx.kpIndex ?? 0
  const flareClass = spaceWx.xrayFlareClass ?? ''
  const flareIntensity = spaceWx.xrayFlareIntensity ?? 0
  const hasMajorFlare = flareClass.startsWith('X') || (flareClass.startsWith('M') && flareIntensity >= 5)

  // Only generate alerts for significant space weather
  if (kp < 5 && !hasMajorFlare) return alerts

  // Determine severity from Kp index
  let severity: InternalSeverity = 'info'
  let stormScale = 'G1'
  if (kp >= 9) { severity = 'critical'; stormScale = 'G5' }
  else if (kp >= 8) { severity = 'critical'; stormScale = 'G4' }
  else if (kp >= 7) { severity = 'warning'; stormScale = 'G3' }
  else if (kp >= 6) { severity = 'warning'; stormScale = 'G2' }
  else if (kp >= 5) { severity = 'info'; stormScale = 'G1' }

  const affectedTypes = ['power_plant', 'substation', 'transformer', 'data_center', 'ai_center']

  for (const asset of assets) {
    if (!asset.active) continue
    if (!affectedTypes.includes(asset.type)) continue

    let message = ''
    let alertType: GridAlertType = 'regional_anomaly'

    if (asset.type === 'power_plant' || asset.type === 'substation' || asset.type === 'transformer') {
      message = `${stormScale} geomagnetic storm (Kp=${kp.toFixed(1)}) — risk of GIC-induced transformer damage, voltage instability`
      alertType = 'interconnect_failure'
    } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
      message = `${stormScale} geomagnetic storm (Kp=${kp.toFixed(1)}) — risk of GPS timing errors, power quality issues`
      alertType = 'pipeline_error'
    }

    if (!message) continue

    alerts.push({
      id: `spacewx-${stormScale}-${asset.id}-${now}`,
      timestamp: now,
      type: alertType,
      assetId: asset.id,
      assetName: asset.name,
      source: asset.source,
      lat: asset.lat,
      lon: asset.lon,
      message,
      severity,
      spaceWeatherCorrelated: true,
    })
  }

  // Major solar flares: alert data centers about radio/GPS degradation
  if (hasMajorFlare) {
    const flareLabel = `${flareClass}${flareIntensity.toFixed(1)}`
    for (const asset of assets) {
      if (!asset.active) continue
      if (asset.type !== 'data_center' && asset.type !== 'ai_center') continue

      alerts.push({
        id: `solarflare-${flareLabel}-${asset.id}-${now}`,
        timestamp: now,
        type: 'pipeline_error',
        assetId: asset.id,
        assetName: asset.name,
        source: asset.source,
        lat: asset.lat,
        lon: asset.lon,
        message: `${flareLabel} solar flare detected — risk of GPS timing degradation, HF radio blackout`,
        severity: flareClass.startsWith('X') ? 'warning' : 'info',
        spaceWeatherCorrelated: true,
      })
    }
  }

  return alerts
}
