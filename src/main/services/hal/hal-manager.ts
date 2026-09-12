/**
 * HAL — Hardware Abstraction Layer
 *
 * Single entry point that reports what real hardware capabilities are
 * available across main + renderer processes. The renderer queries this
 * on startup to know whether to use WebGPU compute, WebCodecs, etc.
 *
 * This is NOT a stub. It probes actual runtime capabilities.
 */

import { availableParallelism, totalmem, freemem } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'

export interface HalCapabilities {
  cpu: {
    cores: number
    parallelism: number
    totalMemMB: number
    freeMemMB: number
  }
  workerThreads: {
    available: boolean
    sharedArrayBuffer: boolean
  }
  nativeAddons: {
    openxr: boolean
    cuda: boolean
    simd: boolean
  }
  renderer: {
    webgpu: boolean | null       // null = not probed yet (renderer probes + reports back)
    webcodecs: boolean | null
    wasmSimd: boolean | null
  }
}

class HalManager {
  private capabilities: HalCapabilities
  private rendererReported: Partial<HalCapabilities['renderer']> = {}

  constructor() {
    this.capabilities = this.probe()
  }

  private probe(): HalCapabilities {
    // CPU — real hardware probe via os module
    const cores = availableParallelism()
    const totalMemMB = Math.round(totalmem() / 1024 / 1024)
    const freeMemMB = Math.round(freemem() / 1024 / 1024)

    // Worker threads — available in Node 12+, SharedArrayBuffer needs --enable-shared
    // but Electron 32 enables it by default with proper COOP/COEP headers
    const workerThreadsAvailable = true
    const sabAvailable = typeof SharedArrayBuffer !== 'undefined'

    // Native addons — check if built
    const openxrPath = join(__dirname, '..', '..', '..', 'native', 'openxr-bridge', 'build', 'Release', 'openxr_bridge.node')
    const cudaPath = join(__dirname, '..', '..', '..', 'native', 'cuda-bridge', 'build', 'Release', 'cuda_bridge.node')
    const simdPath = join(__dirname, '..', '..', '..', 'native', 'simd-bridge', 'build', 'Release', 'simd_bridge.node')

    return {
      cpu: {
        cores,
        parallelism: cores,
        totalMemMB,
        freeMemMB,
      },
      workerThreads: {
        available: workerThreadsAvailable,
        sharedArrayBuffer: sabAvailable,
      },
      nativeAddons: {
        openxr: existsSync(openxrPath),
        cuda: existsSync(cudaPath),
        simd: existsSync(simdPath),
      },
      renderer: {
        webgpu: null,
        webcodecs: null,
        wasmSimd: null,
      },
    }
  }

  /** Renderer reports its capabilities after probing navigator.gpu, VideoEncoder, etc. */
  setRendererCapabilities(caps: Partial<HalCapabilities['renderer']>): void {
    this.rendererReported = { ...this.rendererReported, ...caps }
    this.capabilities.renderer = {
      webgpu: this.rendererReported.webgpu ?? null,
      webcodecs: this.rendererReported.webcodecs ?? null,
      wasmSimd: this.rendererReported.wasmSimd ?? null,
    }
    console.log('[hal] renderer capabilities:', this.capabilities.renderer)
  }

  getCapabilities(): HalCapabilities {
    return { ...this.capabilities, renderer: { ...this.capabilities.renderer } }
  }

  /** Quick summary for logging */
  summary(): string {
    const c = this.capabilities
    const lines = [
      `[hal] CPU: ${c.cpu.cores} cores, ${c.cpu.freeMemMB}/${c.cpu.totalMemMB} MB free`,
      `[hal] Worker threads: ${c.workerThreads.available ? 'yes' : 'no'}, SAB: ${c.workerThreads.sharedArrayBuffer ? 'yes' : 'no'}`,
      `[hal] Native: openxr=${c.nativeAddons.openxr}, cuda=${c.nativeAddons.cuda}, simd=${c.nativeAddons.simd}`,
      `[hal] Renderer: webgpu=${c.renderer.webgpu}, webcodecs=${c.renderer.webcodecs}, wasmSimd=${c.renderer.wasmSimd}`,
    ]
    return lines.join('\n')
  }
}

export const halManager = new HalManager()
