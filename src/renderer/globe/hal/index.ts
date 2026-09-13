/**
 * HAL Init (renderer) — probes WebGPU, WebCodecs, WASM SIMD availability
 * and reports back to the main process.
 *
 * Also initializes the compute dispatcher which routes compute tasks
 * to the best available backend (WebGPU → CPU worker → inline).
 *
 * Call this on app startup, after the globe is ready.
 */

import { gpuCompute } from './gpu-compute'
import { webCodecs } from './webcodecs'
import { computeDispatcher } from './compute-dispatcher'

export async function initHalRenderer(): Promise<void> {
  // Initialize compute dispatcher (probes WebGPU, WebCodecs, WASM SIMD)
  await computeDispatcher.init()

  // Probe WebGPU (already done by dispatcher, but keep for compatibility)
  const webgpuAvailable = gpuCompute.isAvailable()

  // Probe WebCodecs
  const webcodecsAvailable = webCodecs.probe()

  // WASM SIMD capability is tracked by the dispatcher
  const wasmSimdAvailable = computeDispatcher.getCapabilities().wasmSimd

  // Report to main process
  try {
    await window.api.invoke('hal:renderer-report', {
      webgpu: webgpuAvailable,
      webcodecs: webcodecsAvailable,
      wasmSimd: wasmSimdAvailable,
    })
  } catch (e) {
    console.warn('[hal/renderer] failed to report capabilities:', e)
  }

  const caps = computeDispatcher.getCapabilities()
  console.log(`[hal/renderer] WebGPU=${caps.webgpu}, WebCodecs=${caps.webcodecs}, WASM SIMD=${caps.wasmSimd}, CPU worker=${caps.cpuWorker}`)
}

export { gpuCompute, webCodecs, computeDispatcher }
