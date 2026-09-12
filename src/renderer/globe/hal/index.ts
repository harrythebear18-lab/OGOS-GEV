/**
 * HAL Init (renderer) — probes WebGPU, WebCodecs, WASM SIMD availability
 * and reports back to the main process.
 *
 * Call this on app startup, after the globe is ready.
 */

import { gpuCompute } from './gpu-compute'
import { webCodecs } from './webcodecs'

export async function initHalRenderer(): Promise<void> {
  // Probe WebGPU
  const webgpuAvailable = await gpuCompute.init()

  // Probe WebCodecs
  const webcodecsAvailable = webCodecs.probe()

  // Probe WASM SIMD
  let wasmSimdAvailable = false
  try {
    // Test for WASM SIMD support by checking for the simd feature
    const testModule = new WebAssembly.Module(new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // wasm magic + version
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07,
      0x01, 0x03, 0x73, 0x69, 0x6d, 0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00,
      0xfd, 0x0c, 0x00, 0x00, 0x00, 0x0b, // v128.const + drop
    ]))
    new WebAssembly.Instance(testModule)
    wasmSimdAvailable = true
  } catch {
    wasmSimdAvailable = false
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

  console.log(`[hal/renderer] WebGPU=${webgpuAvailable}, WebCodecs=${webcodecsAvailable}, WASM SIMD=${wasmSimdAvailable}`)
}

export { gpuCompute, webCodecs }
