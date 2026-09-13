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
import { IPC } from '@shared/ipc'

export async function initHalRenderer(): Promise<void> {
  // Initialize compute dispatcher (probes WebGPU, WebCodecs, WASM SIMD)
  await computeDispatcher.init()

  // Probe WebGPU (already done by dispatcher, but keep for compatibility)
  const webgpuAvailable = gpuCompute.isAvailable()

  // Probe WebCodecs
  const webcodecsAvailable = webCodecs.probe()

  // WASM SIMD capability is tracked by the dispatcher
  const wasmSimdAvailable = computeDispatcher.getCapabilities().wasmSimd

  // Wire image decode bridge — listen for decode requests from main process
  // Main process sends raw PNG bytes, renderer decodes with WebCodecs hardware
  if (webcodecsAvailable) {
    window.api.on(IPC.IMAGE_DECODE_REQUEST, async (request: unknown) => {
      const { id, bytes, format } = request as { id: number; bytes: number[]; format: 'image/png' | 'image/jpeg' }
      try {
        const result = await webCodecs.decodeImageFromBytes(new Uint8Array(bytes), format)
        window.api.send(IPC.IMAGE_DECODE_RESPONSE, {
          id,
          data: result.data,
          width: result.width,
          height: result.height,
        })
      } catch (e) {
        console.warn('[hal/renderer] image decode failed:', e)
        window.api.send(IPC.IMAGE_DECODE_RESPONSE, { id, error: String(e) })
      }
    })
    console.log('[hal/renderer] image decode bridge wired — WebCodecs decode ready for main process')
  }

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
