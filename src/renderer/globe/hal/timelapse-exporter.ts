/**
 * Timelapse Exporter — captures Cesium canvas frames and encodes them
 * as a WebM video using hardware-accelerated WebCodecs VideoEncoder.
 *
 * Pipeline:
 *   Cesium canvas → VideoFrame → VideoEncoder (VP9, hardware) → webm-muxer → WebM file
 *
 * The VideoEncoder uses `hardwareAcceleration: 'prefer-hardware'` which
 * routes to the GPU's dedicated video engine (NVENC/QuickSync/VAAPI)
 * when available, falling back to software encode if not.
 *
 * Usage:
 *   const exporter = new TimelapseExporter(viewer)
 *   exporter.start({ fps: 30, durationSec: 10, bitrate: 5_000_000 })
 *   // ... Cesium renders frames ...
 *   exporter.stop() // → saves WebM file to disk
 *
 * The exporter captures the Cesium canvas at the specified FPS using
 * requestAnimationFrame, creates VideoFrames, and feeds them to the
 * encoder. The webm-muxer library handles EBML/Matroska container
 * muxing so the output is a valid, playable .webm file.
 */

import * as Cesium from 'cesium'
import { Muxer, ArrayBufferTarget } from 'webm-muxer'

export interface TimelapseOptions {
  /** Target frame rate */
  fps: number
  /** Recording duration in seconds (0 = manual stop) */
  durationSec: number
  /** Video bitrate in bits per second */
  bitrate: number
  /** Codec: VP9 (better quality) or VP8 (faster) */
  codec?: 'vp09.00.10.08' | 'vp8'
  /** Width override (0 = use canvas width) */
  width?: number
  /** Height override (0 = use canvas height) */
  height?: number
}

export interface TimelapseStatus {
  state: 'idle' | 'recording' | 'encoding' | 'done' | 'error'
  framesCaptured: number
  framesEncoded: number
  elapsedMs: number
  estimatedSizeBytes: number
  error?: string
}

class TimelapseExporter {
  private viewer: Cesium.Viewer | null = null
  private encoder: VideoEncoder | null = null
  private muxer: Muxer<ArrayBufferTarget> | null = null
  private rafId: number | null = null
  private startTime = 0
  private frameCount = 0
  private encodedCount = 0
  private options: TimelapseOptions | null = null
  private state: TimelapseStatus['state'] = 'idle'
  private stopRequested = false
  private canvas: HTMLCanvasElement | null = null

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
  }

  /** Check if VideoEncoder is available. */
  isSupported(): boolean {
    return typeof VideoEncoder !== 'undefined'
  }

  /** Check if a specific codec is supported. */
  static async isCodecSupported(codec: string): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined') return false
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec,
        width: 1920,
        height: 1080,
        bitrate: 5_000_000,
        hardwareAcceleration: 'prefer-hardware',
      })
      return result.supported === true
    } catch {
      return false
    }
  }

  /**
   * Start recording a timelapse.
   *
   * Captures frames from the Cesium canvas at the specified FPS,
   * encodes them with hardware VideoEncoder, and muxes into WebM.
   */
  async start(opts: TimelapseOptions): Promise<void> {
    if (!this.viewer || this.viewer.isDestroyed?.()) {
      throw new Error('Viewer not available')
    }
    if (!this.isSupported()) {
      throw new Error('WebCodecs VideoEncoder not available in this browser')
    }
    if (this.state === 'recording') {
      throw new Error('Already recording')
    }

    this.options = opts
    this.frameCount = 0
    this.encodedCount = 0
    this.stopRequested = false
    this.startTime = performance.now()

    // Get the Cesium canvas
    this.canvas = this.viewer.scene.canvas as HTMLCanvasElement
    const width = opts.width || this.canvas.width
    const height = opts.height || this.canvas.height

    // Pick codec — prefer VP9, fall back to VP8
    const codec = opts.codec || 'vp09.00.10.08'
    const codecSupported = await TimelapseExporter.isCodecSupported(codec)
    const useCodec = codecSupported ? codec : 'vp8'

    // Set up the WebM muxer
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: useCodec.startsWith('vp9') ? 'V_VP9' : 'V_VP8',
        width,
        height,
        frameRate: opts.fps,
      },
    })

    // Set up the hardware-accelerated video encoder
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.muxer!.addVideoChunk(chunk, meta)
        this.encodedCount++
      },
      error: (e) => {
        console.error('[timelapse] encoder error:', e)
        this.state = 'error'
      },
    })

    this.encoder.configure({
      codec: useCodec,
      width,
      height,
      bitrate: opts.bitrate,
      framerate: opts.fps,
      hardwareAcceleration: 'prefer-hardware',
    })

    this.state = 'recording'
    console.log(`[timelapse] started — ${width}x${height} @ ${opts.fps}fps, codec=${useCodec}, bitrate=${opts.bitrate}`)

    // Start capture loop
    this.captureLoop()
  }

  /** Internal: capture frames at the target FPS. */
  private captureLoop = (): void => {
    if (this.stopRequested || !this.encoder || !this.canvas) {
      return
    }

    const opts = this.options!
    const elapsed = performance.now() - this.startTime
    const targetFrames = Math.floor((elapsed / 1000) * opts.fps)

    // Check if we've reached the duration limit
    if (opts.durationSec > 0 && elapsed >= opts.durationSec * 1000) {
      this.stop()
      return
    }

    // Capture a frame if we're behind the target frame count
    if (this.frameCount < targetFrames) {
      this.captureFrame()
    }

    this.rafId = requestAnimationFrame(this.captureLoop)
  }

  /** Capture a single frame from the Cesium canvas. */
  private captureFrame(): void {
    if (!this.encoder || !this.canvas || !this.options) return

    try {
      // Force Cesium to render a fresh frame
      this.viewer?.scene.requestRender()

      // Create a VideoFrame from the canvas
      const timestamp = (this.frameCount * 1_000_000) / this.options.fps
      const frame = new VideoFrame(this.canvas, {
        timestamp,
        duration: 1_000_000 / this.options.fps,
      })

      // Encode the frame (keyframe every 2 seconds for seekability)
      const keyFrame = this.frameCount % (this.options.fps * 2) === 0
      this.encoder.encode(frame, { keyFrame })
      frame.close()

      this.frameCount++
    } catch (e) {
      console.warn('[timelapse] frame capture failed:', e)
    }
  }

  /**
   * Stop recording and finalize the video.
   * Returns the encoded WebM as an ArrayBuffer.
   */
  async stop(): Promise<ArrayBuffer | null> {
    if (this.state !== 'recording') return null

    this.stopRequested = true
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    this.state = 'encoding'

    // Flush the encoder
    if (this.encoder) {
      try {
        await this.encoder.flush()
      } catch (e) {
        console.warn('[timelapse] flush failed:', e)
      }
      this.encoder.close()
      this.encoder = null
    }

    // Finalize the muxer
    let result: ArrayBuffer | null = null
    if (this.muxer) {
      this.muxer.finalize()
      const target = this.muxer.target
      result = target.buffer
      this.muxer = null
    }

    const elapsedMs = performance.now() - this.startTime
    console.log(`[timelapse] done — ${this.frameCount} frames captured, ${this.encodedCount} encoded in ${(elapsedMs / 1000).toFixed(1)}s, ${result?.byteLength || 0} bytes`)

    this.state = 'done'
    this.canvas = null

    return result
  }

  /**
   * Stop recording and save the video to disk via IPC.
   */
  async stopAndSave(): Promise<string | null> {
    const buffer = await this.stop()
    if (!buffer) return null

    try {
      const result = await window.api.invoke('export:video', {
        arrayBuffer: buffer,
        extension: 'webm',
      }) as { path: string } | null

      return result?.path || null
    } catch (e) {
      console.error('[timelapse] save failed:', e)
      return null
    }
  }

  /** Get current recording status. */
  getStatus(): TimelapseStatus {
    const elapsedMs = this.startTime ? performance.now() - this.startTime : 0
    const opts = this.options
    const estimatedSizeBytes = opts && this.encodedCount > 0
      ? Math.round((this.encodedCount / Math.max(1, this.frameCount)) * (opts.bitrate / 8) * (elapsedMs / 1000))
      : 0

    return {
      state: this.state,
      framesCaptured: this.frameCount,
      framesEncoded: this.encodedCount,
      elapsedMs,
      estimatedSizeBytes,
    }
  }

  /** Cancel recording without saving. */
  cancel(): void {
    this.stopRequested = true
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.encoder) {
      this.encoder.close()
      this.encoder = null
    }
    this.muxer = null
    this.canvas = null
    this.state = 'idle'
  }
}

export { TimelapseExporter }
export default TimelapseExporter
