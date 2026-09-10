/* Results verifier — cross-asset verification (physical plausibility,
 * nearby comparisons, statistical outliers, temporal consistency,
 * cross-source agreement). Ported from OGOS resultsVerifier.ts. */

import type { GridAssetType } from '@shared/types'
import {
  type InternalGridAsset,
  type AssetMeasurement,
  type CrossVerification,
  type VerificationFlag,
  type NearbyComparison,
  type PhysicalCheck,
  type StatisticalCheck,
  type TemporalCheck,
  type CrossSourceCheck,
  type GridIntegrityStatus,
  distanceKm,
} from './grid-data'

export class ResultsVerifier {
  private previousMeasurements = new Map<string, AssetMeasurement>()

  verify(
    asset: InternalGridAsset,
    measurement: AssetMeasurement | undefined,
    allAssets: InternalGridAsset[],
    allMeasurements: Map<string, AssetMeasurement>,
  ): CrossVerification {
    const flags: VerificationFlag[] = []
    const physicalPlausibility: PhysicalCheck[] = []
    const nearbyComparisons: NearbyComparison[] = []
    const crossSourceAgreement: CrossSourceCheck[] = []

    const emptyMeasurement: AssetMeasurement = { assetId: asset.id, timestamp: Date.now() }
    const safeMeasurement = measurement ?? emptyMeasurement

    if (!measurement) {
      flags.push({
        type: 'data_gap',
        severity: 'critical',
        message: 'No measurement available for cross-verification',
      })
    }

    // Physical plausibility
    if (safeMeasurement.temperatureC !== undefined) {
      const passed = safeMeasurement.temperatureC <= 90
      physicalPlausibility.push({
        field: 'temperatureC',
        value: safeMeasurement.temperatureC,
        min: -40,
        max: 90,
        passed,
        message: passed ? 'Temperature within range' : 'Temperature exceeds plausible operating limit',
      })
      if (!passed) {
        flags.push({ type: 'physical_implausible', severity: 'critical', field: 'temperatureC', message: `Temperature ${safeMeasurement.temperatureC.toFixed(1)}°C implausible` })
      }
    }

    if (safeMeasurement.frequencyHz !== undefined) {
      const passed = safeMeasurement.frequencyHz >= 49.5 && safeMeasurement.frequencyHz <= 50.5
      physicalPlausibility.push({
        field: 'frequencyHz',
        value: safeMeasurement.frequencyHz,
        min: 49.5,
        max: 50.5,
        passed,
        message: passed ? 'Frequency within tolerance' : 'Frequency out of grid tolerance',
      })
      if (!passed) {
        flags.push({ type: 'physical_implausible', severity: 'warning', field: 'frequencyHz', message: `Frequency ${safeMeasurement.frequencyHz.toFixed(2)} Hz out of tolerance` })
      }
    }

    if (safeMeasurement.pue !== undefined) {
      const passed = safeMeasurement.pue <= 2.5
      physicalPlausibility.push({
        field: 'pue',
        value: safeMeasurement.pue,
        min: 1.0,
        max: 2.5,
        passed,
        message: passed ? 'PUE within expected range' : 'PUE unusually high',
      })
      if (!passed) {
        flags.push({ type: 'physical_implausible', severity: 'warning', field: 'pue', message: `PUE ${safeMeasurement.pue.toFixed(2)} unusually high` })
      }
    }

    // Nearby comparisons
    const key = this.valueKeyFor(asset.type)
    const myValue = Number(safeMeasurement[key] ?? 0)
    const nearby = this.findNearbyAssets(asset, allAssets, allMeasurements, 300)
    for (const n of nearby) {
      const nm = allMeasurements.get(n.id)
      if (!nm) continue
      const theirValue = Number(nm[key] ?? 0)
      if (myValue === 0 || theirValue === 0) continue
      const delta = Math.abs(myValue - theirValue)
      const withinTolerance = delta / Math.max(myValue, theirValue) < 0.3
      nearbyComparisons.push({
        assetId: n.id,
        assetName: n.name,
        source: n.source,
        distanceKm: distanceKm(asset.lat, asset.lon, n.lat, n.lon),
        field: key,
        theirValue,
        ourValue: myValue,
        delta,
        withinTolerance,
      })
      if (!withinTolerance) {
        flags.push({
          type: 'cross_source_mismatch',
          severity: 'warning',
          field: key,
          message: `Nearby ${n.name} differs by ${(delta / Math.max(myValue, theirValue) * 100).toFixed(0)}%`,
        })
      }
    }

    // Statistical outlier detection
    let statisticalOutlier: StatisticalCheck = {
      status: 'verified',
      zScore: 0,
      mean: 0,
      stdDev: 0,
      sampleSize: 0,
      message: 'Insufficient sample',
    }
    const sameType = allAssets.filter((a) => a.type === asset.type && a.id !== asset.id)
    const sameTypeMeasurements = sameType.map((a) => allMeasurements.get(a.id)).filter((m): m is AssetMeasurement => !!m)
    if (sameTypeMeasurements.length > 3 && myValue !== 0) {
      const values = sameTypeMeasurements.map((m) => Number(m[key] ?? 0)).filter((v) => v !== 0)
      if (values.length > 0) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
        const stdDev = Math.sqrt(variance) || 1
        const zScore = Math.abs((myValue - mean) / stdDev)
        const isOutlier = zScore > 3
        statisticalOutlier = {
          status: isOutlier ? 'warning' : 'verified',
          zScore,
          mean,
          stdDev,
          sampleSize: values.length,
          message: isOutlier ? `Value ${zScore.toFixed(1)}σ from mean` : 'Within normal distribution',
        }
        if (isOutlier) {
          flags.push({ type: 'statistical_outlier', severity: 'warning', field: key, message: `Value ${zScore.toFixed(1)}σ from mean` })
        }
      }
    }

    // Temporal consistency
    const prev = this.previousMeasurements.get(asset.id)
    let temporalConsistency: TemporalCheck = {
      status: 'verified',
      previousValue: prev ? Number(prev[key] ?? 0) : undefined,
      currentValue: myValue,
      rateOfChange: 0,
      maxExpectedRate: 0.5,
      message: 'No previous measurement',
    }
    if (prev && myValue !== 0) {
      const prevValue = Number(prev[key] ?? 0)
      if (prevValue !== 0) {
        const rate = Math.abs((myValue - prevValue) / prevValue)
        temporalConsistency = {
          status: rate > 0.5 ? 'warning' : 'verified',
          previousValue: prevValue,
          currentValue: myValue,
          rateOfChange: rate,
          maxExpectedRate: 0.5,
          message: rate > 0.5 ? `Large jump ${(rate * 100).toFixed(0)}%` : 'Stable',
        }
        if (rate > 0.5) {
          flags.push({ type: 'temporal_jump', severity: 'warning', field: key, message: `Rate of change ${(rate * 100).toFixed(0)}%` })
        }
      }
    }
    this.previousMeasurements.set(asset.id, safeMeasurement)

    // Cross-source agreement for same region
    const sameRegion = allAssets.filter((a) => a.country === asset.country && a.type === asset.type && a.id !== asset.id && a.source !== asset.source)
    if (sameRegion.length > 0 && myValue !== 0) {
      const others = sameRegion.map((a) => Number(allMeasurements.get(a.id)?.[key] ?? 0)).filter((v) => v !== 0)
      if (others.length > 0) {
        const allValues = [myValue, ...others]
        const mean = others.reduce((a, b) => a + b, 0) / others.length
        const spread = mean === 0 ? 0 : Math.abs(myValue - mean) / mean
        crossSourceAgreement.push({
          field: key,
          sources: allValues.map((_, i) => (i === 0 ? asset.source : sameRegion[i - 1]?.source ?? 'other')),
          values: allValues,
          spread,
          agreement: spread < 0.3,
          message: spread < 0.3 ? 'Cross-source agreement' : `Spread ${(spread * 100).toFixed(0)}%`,
        })
        if (spread >= 0.3) {
          flags.push({ type: 'cross_source_mismatch', severity: 'warning', field: key, message: `Cross-source spread ${(spread * 100).toFixed(0)}%` })
        }
      }
    }

    const score = Math.max(0, 100 - flags.length * 15 - physicalPlausibility.filter((p) => !p.passed).length * 10)
    let status: GridIntegrityStatus = 'verified'
    if (flags.some((f) => f.severity === 'critical')) status = 'failed'
    else if (flags.length > 0) status = 'warning'

    return {
      assetId: asset.id,
      assetName: asset.name,
      source: asset.source,
      lat: asset.lat,
      lon: asset.lon,
      status,
      verificationScore: score,
      measurement: safeMeasurement,
      nearbyComparisons,
      physicalPlausibility,
      statisticalOutlier,
      temporalConsistency,
      crossSourceAgreement,
      flags,
    }
  }

  private findNearbyAssets(asset: InternalGridAsset, allAssets: InternalGridAsset[], allMeasurements: Map<string, AssetMeasurement>, radiusKm: number): InternalGridAsset[] {
    return allAssets
      .filter((a) => a.id !== asset.id && a.type === asset.type && allMeasurements.has(a.id))
      .map((a) => ({ a, d: distanceKm(asset.lat, asset.lon, a.lat, a.lon) }))
      .filter((x) => x.d < radiusKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .map((x) => x.a)
  }

  private valueKeyFor(type: GridAssetType): 'loadMw' | 'itLoadMw' | 'generationMw' | 'storedMwh' {
    if (type === 'data_center' || type === 'ai_center' || type === 'edge_node') return 'itLoadMw'
    if (type === 'battery_storage') return 'storedMwh'
    if (type === 'power_plant' || type === 'renewable_farm') return 'generationMw'
    return 'loadMw'
  }
}

export const resultsVerifier = new ResultsVerifier()
