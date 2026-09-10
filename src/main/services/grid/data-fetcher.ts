/* Data fetcher — generates synthetic assets, measurements, interconnects.
 * Ported from OGOS dataFetcher.ts. */

import type { GridInterconnect } from '@shared/types'
import {
  type InternalGridAsset,
  type AssetMeasurement,
  type DataFlowHealth,
  type GridDataSource,
  BASE_ASSETS,
  SOURCE_NAMES,
  buildInterconnects,
  generateMeasurements,
} from './grid-data'

export interface FetchResult {
  assets: InternalGridAsset[]
  measurements: Map<string, AssetMeasurement>
  interconnects: GridInterconnect[]
  dataFlowHealth: DataFlowHealth[]
  fetchLatencyMs: number
  pendingFetches: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function okChecks() {
  return [
    { check: 'api_reachable', status: 'verified' as const, message: 'API reachable' },
    { check: 'payload_complete', status: 'verified' as const, message: 'Payload complete' },
  ]
}

export class DataFetcher {
  private activeFetches = 0
  private lastResult: FetchResult | null = null

  async fetchAll(): Promise<FetchResult> {
    this.activeFetches++
    const start = Date.now()
    await delay(100 + Math.random() * 200)

    const assets = BASE_ASSETS.map((a) => ({
      ...a,
      lastUpdate: Date.now() - Math.floor(Math.random() * 30000),
    }))

    const measurements = generateMeasurements(assets)
    const interconnects = buildInterconnects(assets)

    const dataFlowHealth: DataFlowHealth[] = (Object.keys(SOURCE_NAMES) as GridDataSource[]).map((ds) => {
      const related = assets.filter((a) => a.source === ds)
      const latency = 50 + Math.random() * 400
      return {
        source: ds,
        sourceName: SOURCE_NAMES[ds],
        status: related.length > 0 ? 'verified' : 'unknown',
        pipelineScore: 85 + Math.random() * 15,
        lastFetchTime: Date.now(),
        fetchLatencyMs: latency,
        avgLatencyMs: 120 + Math.random() * 200,
        payloadSizeBytes: related.length * 512 + Math.floor(Math.random() * 1024),
        assetsExpected: related.length,
        assetsReceived: related.length,
        completenessPercent: 95 + Math.random() * 5,
        duplicateCount: 0,
        outOfOrderCount: 0,
        missingFieldCount: 0,
        totalPackets: related.length,
        droppedPackets: 0,
        pipelineChecks: okChecks(),
        latencyHistory: [latency],
      }
    })

    const latency = Date.now() - start
    this.activeFetches--
    const result: FetchResult = {
      assets,
      measurements,
      interconnects,
      dataFlowHealth,
      fetchLatencyMs: latency,
      pendingFetches: this.activeFetches,
    }
    this.lastResult = result
    return result
  }

  getLastResult(): FetchResult | null {
    return this.lastResult
  }
}

export const dataFetcher = new DataFetcher()
