/**
 * HAL Compute Benchmarks — inline JS, worker, WASM SIMD, and WebGPU.
 *
 * This module provides real inline JavaScript reference implementations
 * of the dispatcher's supported kernels so we can benchmark them against
 * the hardware-backed paths. It also produces a JSON benchmark report
 * that the benchmark plugin can display and export.
 *
 * Workloads: ndvi, ndwi, nbr, slope, hillshade, anomaly (box_blur)
 */

import type { ComputeTask, ComputePayload } from '@shared/compute-contract'
import type { ComputeResult } from '@shared/compute-contract'

export interface BenchSample {
  backend: 'inline' | 'worker' | 'wasm-simd' | 'webgpu'
  durationMs: number
  throughputMCells: number
  samples: number[]
  error?: string
}

export interface BenchReport {
  workload: string
  task: ComputeTask
  width: number
  height: number
  cesiumFps: number
  results: BenchSample[]
  preferred: BenchSample['backend']
  generatedAt: string
}

/** Run a compute task inline in the renderer thread (no GPU, no worker). */
export function computeInline(task: ComputeTask, payload: ComputePayload): ComputeResult {
  const { width, height } = payload
  const n = width * height
  const start = performance.now()

  if (task === 'ndvi' || task === 'ndwi' || task === 'nbr') {
    if (!payload.input || !payload.input2) {
      throw new Error('Band math requires two inputs')
    }
    const a = payload.input
    const b = payload.input2
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const denom = a[i] + b[i]
      out[i] = denom > 0 ? (b[i] - a[i]) / denom : 0
    }
    return { output: out, backend: 'cpu-inline', durationMs: performance.now() - start, task, width, height }
  }

  if (task === 'slope') {
    if (!payload.input) throw new Error('Slope requires DEM input')
    const out = inlineSlope(payload.input, width, height, payload.cellSizeX || 30, payload.cellSizeY || 30)
    return { output: out, backend: 'cpu-inline', durationMs: performance.now() - start, task, width, height }
  }

  if (task === 'hillshade') {
    if (!payload.input) throw new Error('Hillshade requires DEM input')
    const cell = payload.cellSizeX || 30
    const az = payload.params?.[0] ?? 315
    const el = payload.params?.[1] ?? 45
    const out = inlineHillshade(payload.input, width, height, cell, az, el)
    return { output: out, backend: 'cpu-inline', durationMs: performance.now() - start, task, width, height }
  }

  if (task === 'anomaly') {
    if (!payload.input) throw new Error('Anomaly requires input')
    const out = inlineBoxBlur(payload.input, width, height)
    return { output: out, backend: 'cpu-inline', durationMs: performance.now() - start, task, width, height }
  }

  throw new Error(`No inline implementation for task: ${task}`)
}

/** Pick a workload size and input data for a task. */
export function makeBenchPayload(task: ComputeTask, width: number, height: number): ComputePayload {
  const n = width * height
  if (task === 'ndvi' || task === 'ndwi' || task === 'nbr') {
    const a = new Float32Array(n)
    const b = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      a[i] = Math.random() * 0.4 + 0.1
      b[i] = Math.random() * 0.5 + 0.1
    }
    return { width, height, input: a, input2: b }
  }
  const dem = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    dem[i] = Math.random() * 100
  }
  if (task === 'slope') return { width, height, input: dem, cellSizeX: 30, cellSizeY: 30 }
  if (task === 'hillshade') return { width, height, input: dem, cellSizeX: 30, cellSizeY: 30, params: new Float32Array([315, 45]) }
  return { width, height, input: dem }
}

/**
 * Benchmark a single workload across as many backends as possible.
 *
 * @param task     Compute task to benchmark
 * @param payload  Input payload
 * @param runner   Object with backend dispatchers (all optional)
 * @param samples  Number of timed samples after a warm-up run
 */
export async function benchmarkWorkload(
  task: ComputeTask,
  payload: ComputePayload,
  runner: {
    inline?: (p: ComputePayload) => ComputeResult
    wasm?: (p: ComputePayload) => ComputeResult
    worker?: (p: ComputePayload) => Promise<ComputeResult>
    webgpu?: (p: ComputePayload) => Promise<ComputeResult>
  },
  samples = 5,
): Promise<BenchReport> {
  const results: BenchSample[] = []

  const backends: { key: BenchSample['backend']; fn: () => ComputeResult | Promise<ComputeResult> | undefined }[] = [
    { key: 'inline', fn: () => runner.inline?.(payload) },
    { key: 'wasm-simd', fn: () => runner.wasm?.(payload) },
    { key: 'worker', fn: () => runner.worker?.(payload) },
    { key: 'webgpu', fn: () => runner.webgpu?.(payload) },
  ]

  for (const { key, fn } of backends) {
    const timings: number[] = []
    let error: string | undefined

    try {
      // Warm-up
      const warmup = fn()
      if (warmup) await warmup

      for (let i = 0; i < samples; i++) {
        const s = performance.now()
        const r = fn()
        if (r) await r
        timings.push(performance.now() - s)
      }

      const avg = timings.reduce((a, b) => a + b, 0) / timings.length
      const throughput = (payload.width * payload.height / avg) / 1_000_000
      results.push({ backend: key, durationMs: avg, throughputMCells: throughput, samples: timings })
    } catch (e) {
      error = String(e)
      results.push({ backend: key, durationMs: 0, throughputMCells: 0, samples: [], error })
    }
  }

  const preferred = results
    .filter((r) => !r.error)
    .sort((a, b) => a.durationMs - b.durationMs)[0]?.backend ?? 'inline'

  const cesiumFps = (window as any).__cesiumFps ?? 0

  return {
    workload: `${task}_${payload.width}x${payload.height}`,
    task,
    width: payload.width,
    height: payload.height,
    cesiumFps,
    results,
    preferred,
    generatedAt: new Date().toISOString(),
  }
}

/** Export a benchmark report as a downloadable JSON file. */
export function downloadReport(reports: BenchReport[]): void {
  const blob = new Blob([JSON.stringify({ reports, generatedAt: new Date().toISOString() }, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hal-benchmark-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Inline reference kernels ──

function inlineSlope(dem: Float32Array, width: number, height: number, cellX: number, cellY: number): Float32Array {
  const out = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const dzdx = ((dem[i - width + 1] + 2 * dem[i + 1] + dem[i + width + 1]) -
                    (dem[i - width - 1] + 2 * dem[i - 1] + dem[i + width - 1])) / (8 * cellX)
      const dzdy = ((dem[i + width - 1] + 2 * dem[i + width] + dem[i + width + 1]) -
                    (dem[i - width - 1] + 2 * dem[i - width] + dem[i - width + 1])) / (8 * cellY)
      out[i] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI)
    }
  }
  return out
}

function inlineHillshade(dem: Float32Array, width: number, height: number, cell: number, az: number, el: number): Float32Array {
  const out = new Float32Array(width * height)
  const azRad = (az * Math.PI) / 180
  const elRad = (el * Math.PI) / 180
  const cosZ = Math.cos(elRad)
  const sinZ = Math.sin(elRad)
  const cosA = Math.cos(azRad)
  const sinA = Math.sin(azRad)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const dzdx = ((dem[i - width + 1] + 2 * dem[i + 1] + dem[i + width + 1]) -
                    (dem[i - width - 1] + 2 * dem[i - 1] + dem[i + width - 1])) / (8 * cell)
      const dzdy = ((dem[i + width - 1] + 2 * dem[i + width] + dem[i + width + 1]) -
                    (dem[i - width - 1] + 2 * dem[i - width] + dem[i - width + 1])) / (8 * cell)
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)
      const cosAsp = Math.cos(aspect)
      const sinAsp = Math.sin(aspect)
      out[i] = 255 * ((cosZ * Math.cos(slope)) + (sinZ * Math.sin(slope) * (cosA * cosAsp + sinA * sinAsp)))
    }
  }
  return out
}

function inlineBoxBlur(data: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      let sum = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += data[i + ky * width + kx]
        }
      }
      out[i] = sum / 9
    }
  }
  return out
}
