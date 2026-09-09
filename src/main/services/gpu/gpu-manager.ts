import { IPC } from '@shared/ipc'

class GpuManager {
  async render(scene: unknown): Promise<{
    textureHandle: string | null
    filePath: string | null
    sharedKey: string | null
  }> {
    console.log('[gpu] render requested for scene:', scene)
    // v1: stub. Later this spawns a native child process, runs WebGPU/DX, or writes to disk.
    return {
      textureHandle: null,
      filePath: null,
      sharedKey: null,
    }
  }

  async tileRequest(bbox: unknown, resolution: number): Promise<{
    textureHandle: string | null
    filePath: string | null
  }> {
    console.log('[gpu] tile requested for bbox:', bbox, 'resolution:', resolution)
    return { textureHandle: null, filePath: null }
  }
}

export const gpuManager = new GpuManager()
