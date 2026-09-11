/**
 * DataFlowMonitor — ported from OGOS climate/dataFlowMonitor.ts.
 *
 * Tracks per-source pipeline health: latency, completeness, duplicates,
 * out-of-order packets, payload anomalies, and reliability.
 * Emits alerts via the supplied onAlert sink.
 */

import type {
  ClimateDataSource,
  DataFlowHealth,
  PipelineCheck,
  IntegrityStatus,
  ClimateAlert,
} from '@shared/types'

const SOURCE_NAMES: Record<ClimateDataSource, string> = {
  NOAA_NDBC: 'NOAA NDBC (ERDDAP cwwcNDBCMet)',
  ARGO: 'Argo Floats (AOML ERDDAP)',
  BGC_ARGO: 'BGC-Argo Floats (Biogeochemical)',
  NOAA_ERDDAP: 'NOAA ERDDAP',
  GTSPP: 'GTSPP (ERDDAP erdGtsppBest)',
  TAO_PIRATA: 'TAO/TRITON/PIRATA (ERDDAP)',
  PMEL_CO2: 'PMEL CO2 Moorings',
  NWS_WEATHER: 'NWS Weather Stations',
  NHC_STORM: 'NHC Tropical Cyclones',
  BLITZORTUNG_LIGHTNING: 'Blitzortung Lightning',
  NOAA_SWPC: 'NOAA SWPC Space Weather',
  NASA_FIRMS: 'NASA FIRMS Wildfires',
}

interface PipelineHistory {
  source: ClimateDataSource
  fetchTimes: number[]
  latencies: number[]
  payloadSizes: number[]
  stationsExpected: number
  totalFetches: number
  failedFetches: number
  duplicateHashes: Set<string>
  lastTimestamps: Map<string, number>
  outOfOrderCount: number
  duplicateCount: number
  totalPackets: number
  droppedPackets: number
}

export class DataFlowMonitor {
  private histories = new Map<ClimateDataSource, PipelineHistory>()
  private onAlert: (alert: ClimateAlert) => void

  constructor(onAlert: (alert: ClimateAlert) => void) {
    this.onAlert = onAlert
  }

  recordFetch(
    source: ClimateDataSource,
    latencyMs: number,
    payloadSizeBytes: number,
    stationsReceived: number,
    stationsExpected: number,
    measurements: Map<string, { timestamp: number; stationId: string }>,
    success: boolean,
  ): DataFlowHealth {
    const hist = this.getOrCreateHistory(source)
    hist.totalFetches++
    hist.fetchTimes.push(Date.now())
    if (hist.fetchTimes.length > 100) hist.fetchTimes.shift()

    hist.latencies.push(latencyMs)
    if (hist.latencies.length > 50) hist.latencies.shift()

    hist.payloadSizes.push(payloadSizeBytes)
    if (hist.payloadSizes.length > 50) hist.payloadSizes.shift()

    hist.stationsExpected = stationsExpected

    if (!success) {
      hist.failedFetches++
      hist.droppedPackets += stationsExpected
    }

    const checks: PipelineCheck[] = []
    let score = 100

    checks.push({
      check: 'API Reachability',
      status: success ? 'verified' : 'failed',
      message: success
        ? `Connected to ${SOURCE_NAMES[source]} in ${latencyMs}ms`
        : `Failed to reach ${SOURCE_NAMES[source]}`,
    })
    if (!success) score -= 40

    const avgLatency =
      hist.latencies.reduce((a, b) => a + b, 0) / hist.latencies.length
    const latencyStatus: IntegrityStatus =
      latencyMs < 1000 ? 'verified' : latencyMs < 5000 ? 'warning' : 'failed'
    checks.push({
      check: 'Fetch Latency',
      status: latencyStatus,
      message: `Current: ${latencyMs}ms, avg: ${avgLatency.toFixed(0)}ms`,
    })
    if (latencyMs > 5000) score -= 15
    else if (latencyMs > 2000) score -= 5

    const completeness =
      stationsExpected > 0 ? (stationsReceived / stationsExpected) * 100 : 0
    const completenessStatus: IntegrityStatus =
      completeness > 90 ? 'verified' : completeness > 60 ? 'warning' : 'failed'
    checks.push({
      check: 'Payload Completeness',
      status: completenessStatus,
      message: `${stationsReceived}/${stationsExpected} stations (${completeness.toFixed(1)}%)`,
    })
    if (completeness < 60) score -= 20
    else if (completeness < 90) score -= 10

    let newDuplicates = 0
    const currentHashes = new Set<string>()
    for (const [, m] of measurements) {
      const hash = `${m.stationId}_${m.timestamp}`
      currentHashes.add(hash)
      if (hist.duplicateHashes.has(hash)) {
        newDuplicates++
      }
    }
    hist.duplicateHashes = currentHashes
    if (hist.duplicateHashes.size > 5000) {
      const arr = Array.from(hist.duplicateHashes)
      hist.duplicateHashes = new Set(arr.slice(-2500))
    }
    hist.duplicateCount = newDuplicates
    hist.totalPackets += measurements.size

    checks.push({
      check: 'Duplicate Detection',
      status:
        newDuplicates === 0 ? 'verified' : newDuplicates < 5 ? 'warning' : 'failed',
      message:
        newDuplicates === 0
          ? 'No duplicate packets detected'
          : `${newDuplicates} duplicate packets in this fetch`,
    })
    if (newDuplicates > 5) score -= 10

    let newOutOfOrder = 0
    for (const [, m] of measurements) {
      const lastTs = hist.lastTimestamps.get(m.stationId)
      if (lastTs !== undefined && m.timestamp < lastTs) {
        newOutOfOrder++
      }
      hist.lastTimestamps.set(m.stationId, m.timestamp)
    }
    hist.outOfOrderCount = newOutOfOrder

    checks.push({
      check: 'Temporal Ordering',
      status:
        newOutOfOrder === 0 ? 'verified' : newOutOfOrder < 3 ? 'warning' : 'failed',
      message:
        newOutOfOrder === 0
          ? 'All measurements in chronological order'
          : `${newOutOfOrder} out-of-order measurements`,
    })
    if (newOutOfOrder > 3) score -= 10

    const missingFields = Math.max(0, stationsExpected - stationsReceived)
    checks.push({
      check: 'Data Gap Detection',
      status:
        missingFields === 0 ? 'verified' : missingFields < 10 ? 'warning' : 'failed',
      message:
        missingFields === 0
          ? 'No gaps in station coverage'
          : `${missingFields} stations missing from payload`,
    })
    if (missingFields > 10) score -= 15

    const successRate =
      hist.totalFetches > 0
        ? ((hist.totalFetches - hist.failedFetches) / hist.totalFetches) * 100
        : 100
    checks.push({
      check: 'Fetch Reliability',
      status: successRate > 95 ? 'verified' : successRate > 80 ? 'warning' : 'failed',
      message: `${successRate.toFixed(1)}% success rate over ${hist.totalFetches} fetches`,
    })
    if (successRate < 80) score -= 15

    const avgPayload =
      hist.payloadSizes.reduce((a, b) => a + b, 0) / (hist.payloadSizes.length || 1)
    const payloadDeviation =
      avgPayload > 0 ? Math.abs(payloadSizeBytes - avgPayload) / avgPayload : 0
    checks.push({
      check: 'Payload Size Anomaly',
      status:
        payloadDeviation < 0.3
          ? 'verified'
          : payloadDeviation < 0.6
            ? 'warning'
            : 'failed',
      message: `${(payloadSizeBytes / 1024).toFixed(1)}KB (avg: ${(avgPayload / 1024).toFixed(1)}KB, deviation: ${(payloadDeviation * 100).toFixed(0)}%)`,
    })
    if (payloadDeviation > 0.6) score -= 10

    if (!success && hist.failedFetches === 1) {
      this.firePipelineAlert(
        source,
        'pipeline_error',
        `${SOURCE_NAMES[source]} API unreachable`,
        'critical',
      )
    }
    if (completeness < 50 && success) {
      this.firePipelineAlert(
        source,
        'pipeline_error',
        `${SOURCE_NAMES[source]} payload severely incomplete: ${completeness.toFixed(0)}%`,
        'critical',
      )
    }

    score = Math.max(0, Math.min(100, score))
    const status: IntegrityStatus =
      score >= 80 ? 'verified' : score >= 50 ? 'warning' : 'failed'

    return {
      source,
      sourceName: SOURCE_NAMES[source],
      status,
      pipelineScore: score,
      lastFetchTime: Date.now(),
      fetchLatencyMs: latencyMs,
      avgLatencyMs: avgLatency,
      payloadSizeBytes,
      stationsExpected,
      stationsReceived,
      completenessPercent: completeness,
      duplicateCount: hist.duplicateCount,
      outOfOrderCount: hist.outOfOrderCount,
      missingFieldCount: missingFields,
      totalPackets: hist.totalPackets,
      droppedPackets: hist.droppedPackets,
      pipelineChecks: checks,
      latencyHistory: [...hist.latencies],
    }
  }

  private getOrCreateHistory(source: ClimateDataSource): PipelineHistory {
    if (!this.histories.has(source)) {
      this.histories.set(source, {
        source,
        fetchTimes: [],
        latencies: [],
        payloadSizes: [],
        stationsExpected: 0,
        totalFetches: 0,
        failedFetches: 0,
        duplicateHashes: new Set(),
        lastTimestamps: new Map(),
        outOfOrderCount: 0,
        duplicateCount: 0,
        totalPackets: 0,
        droppedPackets: 0,
      })
    }
    return this.histories.get(source)!
  }

  private firePipelineAlert(
    source: ClimateDataSource,
    type: ClimateAlert['type'],
    message: string,
    severity: ClimateAlert['severity'],
  ) {
    this.onAlert({
      id: `${type}_${source}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type,
      stationId: source,
      stationName: SOURCE_NAMES[source],
      source,
      lat: 0,
      lon: 0,
      message,
      severity,
    })
  }
}
