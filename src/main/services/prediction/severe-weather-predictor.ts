/* Severe Weather + Precipitation Predictor — ported from OGOS.
 * Fuses lightning, pressure gradients, wind, storms, SST, air temp, wave height
 * into spatial severe-weather alerts. Also has forecastPrecipitation(). */
import type { ClimateStation, ClimateMeasurement, Storm, PredictionAlert } from '@shared/types'
import type { CouplingResult } from './ocean-atmosphere-coupler'
import type { RadarNowcastCell } from './radar-nowcast-predictor'

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

type Severity = 'low' | 'moderate' | 'high' | 'critical'

function riskFromScore(score: number): Severity {
  if (score >= 0.8) return 'critical'
  if (score >= 0.6) return 'high'
  if (score >= 0.4) return 'moderate'
  return 'low'
}

/** Confidence label → numeric (0-1). */
function confidenceNum(stations: number): number {
  if (stations >= 3) return 0.9
  if (stations >= 1) return 0.6
  return 0.3
}

interface AtmosphericGridCell {
  centerLat: number
  centerLon: number
  stations: { lat: number; lon: number; pressure?: number; windSpeed?: number; airTemp?: number; waterTemp?: number; waveHeight?: number }[]
  lightningCount: number
  stormCount: number
}

function buildSpatialGrid(
  stations: ClimateStation[],
  measurements: Map<string, ClimateMeasurement>,
  lightning: { lat: number; lon: number; timestamp: number }[],
  storms: Storm[],
  cellSizeDeg = 5,
): AtmosphericGridCell[] {
  const grid = new Map<string, AtmosphericGridCell>()

  for (const s of stations) {
    const m = measurements.get(s.id)
    if (!m) continue
    const gridLat = Math.round(s.lat / cellSizeDeg) * cellSizeDeg
    const gridLon = Math.round(s.lon / cellSizeDeg) * cellSizeDeg
    const key = `${gridLat},${gridLon}`
    let cell = grid.get(key)
    if (!cell) {
      cell = { centerLat: gridLat, centerLon: gridLon, stations: [], lightningCount: 0, stormCount: 0 }
      grid.set(key, cell)
    }
    cell.stations.push({
      lat: s.lat, lon: s.lon,
      pressure: m.pressure, windSpeed: m.windSpeed,
      airTemp: m.airTemp, waterTemp: m.waterTemp, waveHeight: m.waveHeight,
    })
  }

  const now = Date.now()
  const twoHoursAgo = now - 2 * 60 * 60 * 1000
  for (const strike of lightning) {
    if (strike.timestamp < twoHoursAgo) continue
    const gridLat = Math.round(strike.lat / cellSizeDeg) * cellSizeDeg
    const gridLon = Math.round(strike.lon / cellSizeDeg) * cellSizeDeg
    const key = `${gridLat},${gridLon}`
    let cell = grid.get(key)
    if (!cell) {
      cell = { centerLat: gridLat, centerLon: gridLon, stations: [], lightningCount: 0, stormCount: 0 }
      grid.set(key, cell)
    }
    cell.lightningCount++
  }

  for (const storm of storms) {
    const gridLat = Math.round(storm.lat / cellSizeDeg) * cellSizeDeg
    const gridLon = Math.round(storm.lon / cellSizeDeg) * cellSizeDeg
    const key = `${gridLat},${gridLon}`
    let cell = grid.get(key)
    if (!cell) {
      cell = { centerLat: gridLat, centerLon: gridLon, stations: [], lightningCount: 0, stormCount: 0 }
      grid.set(key, cell)
    }
    cell.stormCount++
  }

  return Array.from(grid.values())
}

export class SevereWeatherPredictor {
  /** Generate severe weather alerts from the unified data network. */
  predict(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    lightning: { lat: number; lon: number; timestamp: number }[],
    storms: Storm[],
    coupling: CouplingResult | null,
  ): PredictionAlert[] {
    const alerts: PredictionAlert[] = []
    const now = Date.now()
    const grid = buildSpatialGrid(stations, measurements, lightning, storms)

    const ensoIndex = coupling?.ensoIndex ?? 0
    const ensoCategory = coupling?.ensoCategory ?? 'Neutral'
    const ensoBoost = Math.abs(ensoIndex) * 0.15

    for (const cell of grid) {
      if (cell.stations.length === 0 && cell.lightningCount === 0 && cell.stormCount === 0) continue

      const pressures = cell.stations.map((s) => s.pressure).filter((p): p is number => p !== undefined)
      const windSpeeds = cell.stations.map((s) => s.windSpeed).filter((w): w is number => w !== undefined)
      const airTemps = cell.stations.map((s) => s.airTemp).filter((t): t is number => t !== undefined)
      const waterTemps = cell.stations.map((s) => s.waterTemp).filter((t): t is number => t !== undefined)
      const waveHeights = cell.stations.map((s) => s.waveHeight).filter((w): w is number => w !== undefined)

      const avgPressure = pressures.length > 0 ? mean(pressures) : 1013
      const maxWind = windSpeeds.length > 0 ? Math.max(...windSpeeds) : 0
      const avgAirTemp = airTemps.length > 0 ? mean(airTemps) : 20
      const avgWaterTemp = waterTemps.length > 0 ? mean(waterTemps) : 20
      const maxWave = waveHeights.length > 0 ? Math.max(...waveHeights) : 0
      const regionName = `${cell.centerLat.toFixed(0)},${cell.centerLon.toFixed(0)}`

      // === Thunderstorm risk ===
      let thunderstormScore = 0
      if (cell.lightningCount > 0) {
        thunderstormScore += Math.min(cell.lightningCount / 20, 1) * 0.4 + ensoBoost
      }
      if (avgPressure < 1005) {
        thunderstormScore += Math.min((1005 - avgPressure) / 25, 1) * 0.3
      }
      if (maxWind > 20) {
        thunderstormScore += Math.min(maxWind / 50, 1) * 0.2
      }
      if (avgWaterTemp > 26 && avgAirTemp > 25) {
        thunderstormScore += 0.15
      }

      if (thunderstormScore >= 0.3) {
        const severity = riskFromScore(thunderstormScore)
        alerts.push({
          id: `thunderstorm-${cell.centerLat}-${cell.centerLon}-${now}`,
          type: 'thunderstorm_risk',
          severity,
          lat: cell.centerLat,
          lon: cell.centerLon,
          radiusKm: 200,
          title: `${severity === 'critical' ? 'Severe' : severity === 'high' ? 'Significant' : 'Possible'} Thunderstorm Risk — ${regionName}`,
          description: `${cell.lightningCount} lightning strikes in 2h, pressure ${avgPressure.toFixed(0)} hPa, max wind ${maxWind.toFixed(0)} m/s.${Math.abs(ensoIndex) >= 0.5 ? ` Influenced by ${ensoCategory} conditions.` : ''}`,
          confidence: confidenceNum(cell.stations.length),
          validUntil: now + 6 * 60 * 60 * 1000,
        })
      }

      // === High wind risk ===
      if (maxWind > 25) {
        const windRiskScore = Math.min(maxWind / 60, 1)
        const severity = riskFromScore(windRiskScore)
        if (severity === 'moderate' || severity === 'high' || severity === 'critical') {
          alerts.push({
            id: `highwind-${cell.centerLat}-${cell.centerLon}-${now}`,
            type: 'high_wind_risk',
            severity,
            lat: cell.centerLat,
            lon: cell.centerLon,
            radiusKm: 150,
            title: `High Wind Risk — ${regionName}`,
            description: `Sustained winds ${maxWind.toFixed(0)} m/s detected.${cell.stormCount > 0 ? ' Storm system in area.' : ''}`,
            confidence: 0.9,
            validUntil: now + 3 * 60 * 60 * 1000,
          })
        }
      }

      // === Hurricane/tropical cyclone risk ===
      if (cell.stormCount > 0) {
        const nearbyStorms = storms.filter((s) => haversineKm(s.lat, s.lon, cell.centerLat, cell.centerLon) < 300)
        for (const storm of nearbyStorms) {
          const windKt = storm.windSpeedKt ?? 0
          if (windKt < 34) continue
          const stormScore = Math.min(windKt / 137, 1)
          const severity = riskFromScore(stormScore)
          alerts.push({
            id: `hurricane-${storm.id}-${now}`,
            type: 'hurricane_risk',
            severity,
            lat: storm.lat,
            lon: storm.lon,
            radiusKm: 300 + windKt * 2,
            title: `${storm.classification || 'Tropical System'} — ${storm.name}`,
            description: `${storm.intensity} with ${windKt} kt winds, pressure ${storm.pressureMB ?? 'unknown'} hPa. SST in region: ${avgWaterTemp.toFixed(1)}°C. ${avgWaterTemp > 26.5 ? 'Warm waters may support intensification.' : 'Cool waters may weaken system.'}`,
            confidence: 0.9,
            validUntil: now + 24 * 60 * 60 * 1000,
          })
        }
      }

      // === Flood risk (coastal) ===
      if (maxWave > 3 || (maxWave > 2 && avgPressure < 1000)) {
        const floodScore = Math.min(maxWave / 8, 1) + (avgPressure < 1000 ? 0.2 : 0)
        const severity = riskFromScore(floodScore)
        if (severity === 'moderate' || severity === 'high' || severity === 'critical') {
          alerts.push({
            id: `flood-${cell.centerLat}-${cell.centerLon}-${now}`,
            type: 'flood_risk',
            severity,
            lat: cell.centerLat,
            lon: cell.centerLon,
            radiusKm: 100,
            title: `Coastal Flood Risk — ${regionName}`,
            description: `Wave height ${maxWave.toFixed(1)} m, pressure ${avgPressure.toFixed(0)} hPa.${cell.stormCount > 0 ? ' Storm surge possible.' : ''}`,
            confidence: 0.6,
            validUntil: now + 12 * 60 * 60 * 1000,
          })
        }
      }

      // === Heatwave risk ===
      if (avgAirTemp > 35) {
        const heatScore = Math.min((avgAirTemp - 35) / 10, 1)
        const ensoContribution = ensoIndex > 0.5 ? 0.2 : 0
        const severity = riskFromScore(heatScore + ensoContribution)
        alerts.push({
          id: `heatwave-${cell.centerLat}-${cell.centerLon}-${now}`,
          type: 'heatwave_risk',
          severity,
          lat: cell.centerLat,
          lon: cell.centerLon,
          radiusKm: 200,
          title: `Heatwave Risk — ${regionName}`,
          description: `Air temperature ${avgAirTemp.toFixed(1)}°C.${ensoIndex > 0.5 ? ` Amplified by ${ensoCategory} conditions.` : ''}`,
          confidence: 0.9,
          validUntil: now + 48 * 60 * 60 * 1000,
        })
      }

      // === Cold spell risk ===
      if (avgAirTemp < -15) {
        const coldScore = Math.min((-15 - avgAirTemp) / 25, 1)
        const severity = riskFromScore(coldScore)
        alerts.push({
          id: `coldspell-${cell.centerLat}-${cell.centerLon}-${now}`,
          type: 'cold_spell_risk',
          severity,
          lat: cell.centerLat,
          lon: cell.centerLon,
          radiusKm: 200,
          title: `Cold Spell Risk — ${regionName}`,
          description: `Air temperature ${avgAirTemp.toFixed(1)}°C.${ensoIndex < -0.5 ? ` Amplified by ${ensoCategory} conditions.` : ''}`,
          confidence: 0.9,
          validUntil: now + 48 * 60 * 60 * 1000,
        })
      }
    }

    // Sort by severity (critical first)
    const riskOrder: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 }
    alerts.sort((a, b) => (riskOrder[a.severity] ?? 5) - (riskOrder[b.severity] ?? 5))

    console.log(`[prediction/severe-weather] ${alerts.length} alerts from ${grid.length} grid cells, ENSO boost: ${ensoBoost.toFixed(2)}`)
    return alerts
  }

  /** Forecast precipitation using atmospheric moisture + pressure tendencies + radar nowcast. */
  forecastPrecipitation(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    coupling: CouplingResult | null,
    radarNowcastCells: RadarNowcastCell[],
  ): PredictionAlert[] {
    const alerts: PredictionAlert[] = []
    const now = Date.now()
    const grid = buildSpatialGrid(stations, measurements, [], [], 5)

    for (const cell of grid) {
      const pressures = cell.stations.map((s) => s.pressure).filter((p): p is number => p !== undefined)
      const windSpeeds = cell.stations.map((s) => s.windSpeed).filter((w): w is number => w !== undefined)
      const airTemps = cell.stations.map((s) => s.airTemp).filter((t): t is number => t !== undefined)
      const waterTemps = cell.stations.map((s) => s.waterTemp).filter((t): t is number => t !== undefined)

      if (pressures.length === 0 && airTemps.length === 0) continue

      const avgPressure = pressures.length > 0 ? mean(pressures) : 1013
      const avgWind = windSpeeds.length > 0 ? mean(windSpeeds) : 0
      const avgAirTemp = airTemps.length > 0 ? mean(airTemps) : 15
      const avgWaterTemp = waterTemps.length > 0 ? mean(waterTemps) : 15

      // Precipitation probability model
      let prob = 0.1
      if (avgPressure < 1010) prob += Math.min((1010 - avgPressure) / 30, 1) * 0.3
      if (avgWind > 5) prob += Math.min(avgWind / 30, 1) * 0.15
      if (avgWaterTemp > avgAirTemp + 3) prob += 0.15
      if (coupling && coupling.ensoIndex > 0.5) prob += 0.1

      const nearbyRadar = radarNowcastCells.filter((c) => haversineKm(c.lat, c.lon, cell.centerLat, cell.centerLon) < 200)
      if (nearbyRadar.length > 0) {
        prob += Math.max(...nearbyRadar.map((c) => c.intensity)) * 0.3
      }
      prob = Math.min(prob, 0.95)

      if (prob < 0.2) continue

      // Estimate intensity (mm/h)
      let intensityMm = 0
      if (avgPressure < 1005) intensityMm += (1005 - avgPressure) * 0.3
      intensityMm += avgWind * 0.1
      if (avgWaterTemp > avgAirTemp + 3) intensityMm += 2
      if (nearbyRadar.length > 0) intensityMm += Math.max(...nearbyRadar.map((c) => c.intensity)) * 10
      intensityMm = Math.max(intensityMm, prob * 5)

      const severity: Severity = intensityMm > 20 ? 'critical' : intensityMm > 10 ? 'high' : intensityMm > 5 ? 'moderate' : 'low'

      alerts.push({
        id: `precip-${cell.centerLat}-${cell.centerLon}-${now}`,
        type: 'precipitation_forecast',
        severity,
        lat: cell.centerLat,
        lon: cell.centerLon,
        radiusKm: 50,
        title: `Precipitation Forecast — ${cell.centerLat.toFixed(0)},${cell.centerLon.toFixed(0)}`,
        description: `Intensity ${intensityMm.toFixed(1)} mm/h, probability ${(prob * 100).toFixed(0)}%. ${nearbyRadar.length > 0 ? 'Blended with radar nowcast.' : ''}`,
        confidence: Math.round(prob * 100) / 100,
        validUntil: now + 6 * 60 * 60 * 1000,
      })
    }

    console.log(`[prediction/precipitation] ${alerts.length} forecast cells, ${radarNowcastCells.length} radar cells blended`)
    return alerts
  }
}
