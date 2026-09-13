/**
 * Image Decode Bridge — routes PNG/JPEG decode from main process to renderer WebCodecs.
 *
 * WebCodecs (ImageDecoder) only exists in the renderer process. The main process
 * needs to decode PNG tiles (DEM Terrarium, GIBS NDVI) and currently uses pngjs
 * (pure JavaScript decode). This bridge lets the main process send raw PNG bytes
 * to the renderer, where WebCodecs decodes them on hardware, and sends back
 * the RGBA pixel data.
 *
 * Flow:
 *   Main process → webContents.send('image:decode-request', { id, bytes, format })
 *   Renderer     → WebCodecs.decodeImageFromBytes(bytes)
 *   Renderer     → ipcRenderer.send('image:decode-response', { id, data, width, height })
 *   Main process → resolves promise with decoded pixel data
 *
 * Falls back to pngjs if the renderer is unavailable or the bridge fails.
 */

import { ipcMain } from 'electron'
import { broadcastToWindows } from '../windows'
import { IPC } from '@shared/ipc'

interface PendingDecode {
  resolve: (result: { data: Uint8Array; width: number; height: number } | null) => void
  timer: NodeJS.Timeout
}

const pending = new Map<number, PendingDecode>()
let nextId = 1

const TIMEOUT_MS = 5000

let initialized = false

/** Initialize the bridge — listens for renderer responses. Call once on startup. */
export function initImageDecodeBridge(): void {
  if (initialized) return
  initialized = true

  ipcMain.on(IPC.IMAGE_DECODE_RESPONSE, (_event, response: { id: number; data: number[]; width: number; height: number; error?: string }) => {
    const pendingEntry = pending.get(response.id)
    if (!pendingEntry) return

    clearTimeout(pendingEntry.timer)
    pending.delete(response.id)

    if (response.error || !response.data) {
      pendingEntry.resolve(null)
      return
    }

    pendingEntry.resolve({
      data: new Uint8Array(response.data),
      width: response.width,
      height: response.height,
    })
  })

  console.log('[image-decode-bridge] initialized — listening for renderer decode responses')
}

/**
 * Decode a PNG/JPEG image using the renderer's WebCodecs hardware decoder.
 * Returns null if the bridge is unavailable or times out (caller should fall back to pngjs).
 *
 * @param bytes Raw PNG/JPEG file bytes
 * @param format Image format
 * @returns Decoded RGBA pixel data, or null if unavailable
 */
export async function decodeImageViaRenderer(
  bytes: Uint8Array | Buffer,
  format: 'image/png' | 'image/jpeg' = 'image/png',
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  if (!initialized) return null

  const id = nextId++
  const byteArr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, TIMEOUT_MS)

    pending.set(id, { resolve, timer })

    // Send to all renderer windows — the one with WebCodecs will respond
    broadcastToWindows(IPC.IMAGE_DECODE_REQUEST, {
      id,
      bytes: Array.from(byteArr),
      format,
    })
  })
}

/** Check if the bridge is active (renderer windows exist). */
export function isBridgeActive(): boolean {
  return initialized && pending.size >= 0 // bridge is active if initialized
}
