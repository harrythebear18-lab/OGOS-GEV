/* Data flow monitor — monitors transmission regularity of data pipelines.
 * Ported from OGOS dataFlowMonitor.ts. */

import {
  type DataFlowHealth,
  type PipelineCheck,
  type GridIntegrityStatus,
} from './grid-data'

export class DataFlowMonitor {
  private previous = new Map<string, DataFlowHealth>()

  monitor(current: DataFlowHealth[]): DataFlowHealth[] {
    return current.map((flow) => {
      const prev = this.previous.get(flow.source)
      const checks: PipelineCheck[] = []

      if (flow.fetchLatencyMs > 3000) {
        checks.push({ check: 'latency', status: 'warning', message: `Latency ${flow.fetchLatencyMs.toFixed(0)}ms` })
      } else {
        checks.push({ check: 'latency', status: 'verified', message: `Latency ${flow.fetchLatencyMs.toFixed(0)}ms` })
      }

      if (flow.assetsReceived < flow.assetsExpected) {
        checks.push({ check: 'completeness', status: 'failed', message: `Received ${flow.assetsReceived}/${flow.assetsExpected}` })
      } else {
        checks.push({ check: 'completeness', status: 'verified', message: 'All assets received' })
      }

      if (flow.duplicateCount > 0) {
        checks.push({ check: 'duplicates', status: 'warning', message: `${flow.duplicateCount} duplicates` })
      }
      if (flow.outOfOrderCount > 0) {
        checks.push({ check: 'ordering', status: 'warning', message: `${flow.outOfOrderCount} out of order` })
      }
      if (flow.missingFieldCount > 0) {
        checks.push({ check: 'field_integrity', status: 'warning', message: `${flow.missingFieldCount} missing fields` })
      }

      if (checks.length === 0 || checks.every((c) => c.status === 'verified')) {
        checks.push({ check: 'pipeline', status: 'verified', message: 'Pipeline healthy' })
      }

      const latencyHistory = prev ? [...prev.latencyHistory.slice(-9), flow.fetchLatencyMs] : [flow.fetchLatencyMs]
      const avgLatency = latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length

      let status: GridIntegrityStatus = 'verified'
      if (checks.some((c) => c.status === 'failed')) status = 'failed'
      else if (checks.some((c) => c.status === 'warning')) status = 'warning'

      const score = Math.max(0, Math.min(100,
        100
        - (flow.fetchLatencyMs > 1000 ? 10 : 0)
        - (flow.assetsReceived < flow.assetsExpected ? 20 : 0)
        - (flow.duplicateCount > 0 ? 5 : 0)
        - (flow.outOfOrderCount > 0 ? 5 : 0)
        - (flow.missingFieldCount > 0 ? 5 : 0),
      ))

      const updated: DataFlowHealth = {
        ...flow,
        status,
        pipelineScore: score,
        avgLatencyMs: avgLatency,
        latencyHistory,
        pipelineChecks: checks,
      }
      this.previous.set(flow.source, updated)
      return updated
    })
  }
}

export const dataFlowMonitor = new DataFlowMonitor()
