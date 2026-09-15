/**
 * Compute Dispatcher (Renderer) — routes compute tasks to the best backend.
 *
 * On startup:
 *   1. Probe WebGPU (compile all WGSL kernels)
 *   2. Probe WebCodecs (hardware image/video codecs)
 *   3. Register available backends
 *
 * API:
 *   const result = await computeDispatcher.dispatch("slope", payload)
 *
 * Internally:
 *   1. If WebGPU available + grid large enough → dispatch on GPU
 *   2. If not → IPC to main process → CPU worker pool
 *   3. If WASM SIMD ever lands → slot in as another backend
 *
 * No plugin cares how it ran — only that it did.
 */

import { gpuCompute, type ComputeKernel } from './gpu-compute'
import { webCodecs } from './webcodecs'
import {
  initWasmSimd,
  isWasmReady,
  wasmBandMath,
  wasmSlope,
  wasmHillshade,
  wasmBoxBlur,
} from './wasm/wasm-loader'
import {
  type ComputeTask,
  type ComputePayload,
  type ComputeResult,
  type ComputeBackend,
  type ComputeStats,
  type BackendCapabilities,
  KERNEL_MAP,
  GPU_MIN_CELLS,
} from '@shared/compute-contract'

class ComputeDispatcher {
  private capabilities: BackendCapabilities = {
    webgpu: false,
    cpuWorker: true, // always available via IPC
    wasmSimd: false,
    webcodecs: false,
  }
  private stats: ComputeStats[] = []
  private maxStats = 100
  private initialized = false

  /** Initialize — probe all backends. Call on app startup. */
  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    // Probe WebGPU
    this.capabilities.webgpu = await gpuCompute.init()

    // Probe WebCodecs
    this.capabilities.webcodecs = webCodecs.probe()

    // Probe WASM SIMD
    try {
      const testModule = new WebAssembly.Module(new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07,
        0x01, 0x03, 0x73, 0x69, 0x6d, 0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00,
        0xfd, 0x0c, 0x00, 0x00, 0x00, 0x0b,
      ]))
      new WebAssembly.Instance(testModule)
      this.capabilities.wasmSimd = true
    } catch {
      this.capabilities.wasmSimd = false
    }

    // Load the full WASM SIMD kernel module (band_math, slope, hillshade, box_blur)
    if (this.capabilities.wasmSimd) {
      const loaded = await initWasmSimd()
      if (!loaded) {
        this.capabilities.wasmSimd = false
        console.warn('[hal/dispatcher] WASM SIMD probe passed but kernel module failed to load')
      }
    }

    console.log(`[hal/dispatcher] backends: webgpu=${this.capabilities.webgpu}, cpuWorker=${this.capabilities.cpuWorker}, wasmSimd=${this.capabilities.wasmSimd}, webcodecs=${this.capabilities.webcodecs}`)
  }

  /** Get current backend capabilities. */
  getCapabilities(): BackendCapabilities {
    return { ...this.capabilities }
  }

  /**
   * Dispatch a compute task to the best available backend.
   *
   * @param task What to compute (slope, hillshade, anomaly, etc.)
   * @param payload Input data + dimensions + params
   * @returns Result with output buffer, backend tag, and timing
   */
  async dispatch(task: ComputeTask, payload: ComputePayload): Promise<ComputeResult> {
    const cellCount = payload.width * payload.height
    const start = performance.now()

    // Try WebGPU first if available and grid is large enough
    if (this.capabilities.webgpu && cellCount >= GPU_MIN_CELLS) {
      try {
        const kernel = KERNEL_MAP[task] as ComputeKernel
        const inputs = payload.input2
          ? (payload.input3 ? [payload.input, payload.input2, payload.input3] : [payload.input, payload.input2])
          : [payload.input]

        const result = await gpuCompute.execute(kernel, {
          width: payload.width,
          height: payload.height,
          input: inputs,
          uniforms: payload.params,
          ramp: payload.ramp,
        })

        const computeResult: ComputeResult = {
          output: result.output,
          backend: 'webgpu',
          durationMs: result.durationMs,
          task,
          width: payload.width,
          height: payload.height,
        }
        this.recordStats(task, 'webgpu', result.durationMs, cellCount)
        console.log(`[hal/dispatcher] ${task} → WebGPU — ${cellCount} cells in ${result.durationMs.toFixed(1)}ms`)
        return computeResult
      } catch (e) {
        console.warn(`[hal/dispatcher] WebGPU ${task} failed, falling back to CPU:`, e)
      }
    }

    // Try WASM SIMD backend (faster than CPU worker for SIMD-eligible tasks)
    if (this.capabilities.wasmSimd && isWasmReady()) {
      try {
        let output: Float32Array | null = null

        if (task === 'ndvi' || task === 'ndwi' || task === 'nbr') {
          if (payload.input && payload.input2) {
            output = wasmBandMath(payload.input, payload.input2)
          }
        } else if (task === 'slope') {
          if (payload.input) {
            const cellSize = payload.cellSizeX || 30
            output = wasmSlope(payload.input, payload.width, payload.height, cellSize)
          }
        } else if (task === 'hillshade') {
          if (payload.input && payload.params) {
            const cellSize = payload.cellSizeX || 30
            const azimuth = payload.params[0] || 315
            const elevation = payload.params[1] || 45
            output = wasmHillshade(payload.input, payload.width, payload.height, cellSize, azimuth, elevation)
          }
        } else if (task === 'anomaly') {
          if (payload.input) {
            output = wasmBoxBlur(payload.input, payload.width, payload.height)
          }
        }

        if (output) {
          const durationMs = performance.now() - start
          const computeResult: ComputeResult = {
            output,
            backend: 'wasm-simd',
            durationMs,
            task,
            width: payload.width,
            height: payload.height,
          }
          this.recordStats(task, 'wasm-simd', durationMs, cellCount)
          console.log(`[hal/dispatcher] ${task} → WASM SIMD — ${cellCount} cells in ${durationMs.toFixed(1)}ms`)
          return computeResult
        }
      } catch (e) {
        console.warn(`[hal/dispatcher] WASM SIMD ${task} failed, falling back to CPU worker:`, e)
      }
    }

    // Fall back to CPU worker pool via IPC
    if (this.capabilities.cpuWorker) {
      try {
        const response = await window.api.invoke('compute:task', {
          task,
          payload: {
            width: payload.width,
            height: payload.height,
            input: Array.from(payload.input),
            input2: payload.input2 ? Array.from(payload.input2) : undefined,
            input3: payload.input3 ? Array.from(payload.input3) : undefined,
            params: payload.params ? Array.from(payload.params) : undefined,
            cellSizeX: payload.cellSizeX,
            cellSizeY: payload.cellSizeY,
          },
        }) as { output: number[]; backend: ComputeBackend; durationMs: number; width: number; height: number } | null

        if (response && response.output) {
          const output = new Float32Array(response.output)
          const durationMs = performance.now() - start
          const computeResult: ComputeResult = {
            output,
            backend: response.backend || 'cpu-worker',
            durationMs,
            task,
            width: response.width,
            height: response.height,
          }
          this.recordStats(task, 'cpu-worker', durationMs, cellCount)
          console.log(`[hal/dispatcher] ${task} → CPU worker — ${cellCount} cells in ${durationMs.toFixed(1)}ms`)
          return computeResult
        }
      } catch (e) {
        console.warn(`[hal/dispatcher] CPU worker ${task} failed:`, e)
      }
    }

    // Last resort: return empty (caller must handle inline)
    const durationMs = performance.now() - start
    this.recordStats(task, 'cpu-inline', durationMs, cellCount)
    console.warn(`[hal/dispatcher] ${task} → no backend available, returning empty`)
    return {
      output: new Float32Array(cellCount),
      backend: 'noop',
      durationMs,
      task,
      width: payload.width,
      height: payload.height,
    }
  }

  /** Check if WebGPU is available for a given grid size. */
  shouldUseGpu(width: number, height: number): boolean {
    return this.capabilities.webgpu && width * height >= GPU_MIN_CELLS
  }

  /** Get compute telemetry for HUD display. */
  getStats(): ComputeStats[] {
    return this.stats.slice(-20)
  }

  /** Get a summary of which backends are being used. */
  getBackendSummary(): Record<ComputeBackend, number> {
    const summary: Record<ComputeBackend, number> = {
      webgpu: 0,
      'wasm-simd': 0,
      'cpu-worker': 0,
      'cpu-inline': 0,
      noop: 0,
    }
    for (const s of this.stats) {
      summary[s.backend]++
    }
    return summary
  }

  private recordStats(task: ComputeTask, backend: ComputeBackend, durationMs: number, gridSize: number): void {
    this.stats.push({ task, backend, durationMs, gridSize, timestamp: Date.now() })
    if (this.stats.length > this.maxStats) {
      this.stats.shift()
    }
  }
}

export const computeDispatcher = new ComputeDispatcher()
