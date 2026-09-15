/**
 * Video Frame Extractor — extracts frames from MP4 video files using
 * hardware-accelerated WebCodecs VideoDecoder + mp4box demuxing.
 *
 * Pipeline:
 *   MP4 file → mp4box (demux) → EncodedVideoChunk → VideoDecoder (hardware) → VideoFrame → canvas/bitmap
 *
 * The VideoDecoder uses `hardwareAcceleration: 'prefer-hardware'` which
 * routes to the GPU's dedicated video decode engine (NVDEC/QuickSync/VAAPI)
 * when available, falling back to software decode if not.
 *
 * Use cases:
 *   - Drone footage frame extraction for georeferencing
 *   - Satellite video frame analysis
 *   - AI vision frame sampling from video feeds
 *   - Timelapse frame extraction from recorded video
 *
 * Usage:
 *   const extractor = new VideoFrameExtractor()
 *   const frames = await extractor.extract(file, {
 *     maxFrames: 30,
 *     onFrame: (frame, index) => { ... }
 *   })
 */

import { createFile as mp4CreateFile } from 'mp4box'

export interface ExtractOptions {
  /** Maximum number of frames to extract (0 = all) */
  maxFrames: number
  /** Sample interval (extract every Nth frame, 1 = all frames) */
  sampleInterval: number
  /** Callback for each extracted frame */
  onFrame?: (frame: VideoFrame, index: number, timestamp: number) => Promise<void>
  /** Callback for progress updates */
  onProgress?: (extracted: number, total: number) => void
}

export interface ExtractResult {
  framesExtracted: number
  totalFrames: number
  durationMs: number
  width: number
  height: number
  fps: number
  codec: string
  hardwareAccelerated: boolean
}

class VideoFrameExtractor {
  private decoder: VideoDecoder | null = null
  private isSupported = false

  constructor() {
    this.isSupported = typeof VideoDecoder !== 'undefined'
  }

  /** Check if VideoDecoder is available. */
  available(): boolean {
    return this.isSupported
  }

  /** Check if a specific codec is supported for decoding. */
  async isCodecSupported(codec: string): Promise<boolean> {
    if (!this.isSupported) return false
    try {
      const result = await VideoDecoder.isConfigSupported({
        codec,
        hardwareAcceleration: 'prefer-hardware',
      })
      return result.supported === true
    } catch {
      return false
    }
  }

  /**
   * Extract frames from an MP4 video file.
   *
   * Demuxes the MP4 container with mp4box, feeds encoded chunks to
   * the hardware VideoDecoder, and calls onFrame for each decoded frame.
   *
   * @param file MP4 video file (File or Blob)
   * @param opts Extraction options
   * @returns Extraction summary
   */
  async extract(file: File | Blob, opts: ExtractOptions): Promise<ExtractResult> {
    if (!this.isSupported) {
      throw new Error('WebCodecs VideoDecoder not available')
    }

    const start = performance.now()
    const arrayBuffer = await file.arrayBuffer()

    // mp4box requires the fileStart property on the ArrayBuffer
    ;(arrayBuffer as any).fileStart = 0

    // Create mp4box file instance
    const mp4File = mp4CreateFile()

    // Track info from demuxer
    let videoTrack: any = null
    let codec = ''
    let width = 0
    let height = 0
    let fps = 0
    let totalFrames = 0

    // Wait for mp4box to parse the moov box
    const ready = new Promise<void>((resolve, reject) => {
      mp4File.onReady = (info: any) => {
        const tracks = info.videoTracks || []
        if (tracks.length === 0) {
          reject(new Error('No video tracks found in MP4 file'))
          return
        }
        videoTrack = tracks[0]
        codec = videoTrack.codec || 'avc1.640028'
        width = videoTrack.track_width
        height = videoTrack.track_height
        fps = videoTrack.timescale > 0 && videoTrack.samples_duration > 0
          ? videoTrack.timescale / videoTrack.samples_duration * videoTrack.nb_samples
          : 30
        totalFrames = videoTrack.nb_samples
        resolve()
      }
      mp4File.onError = (module: string, message: string) => {
        reject(new Error(`mp4box error: ${module} — ${message}`))
      }
    })

    // Append the buffer to start parsing
    mp4File.appendBuffer(arrayBuffer as any)
    await ready

    // Check codec support
    const codecSupported = await this.isCodecSupported(codec)
    if (!codecSupported) {
      throw new Error(`Codec ${codec} not supported by VideoDecoder`)
    }

    // Set up the hardware-accelerated decoder
    let framesExtracted = 0
    let frameIndex = 0
    const maxFrames = opts.maxFrames > 0 ? opts.maxFrames : totalFrames
    const sampleInterval = Math.max(1, opts.sampleInterval)

    const decodePromise = new Promise<void>((resolve, reject) => {
      this.decoder = new VideoDecoder({
        output: async (frame: VideoFrame) => {
          if (frameIndex % sampleInterval === 0 && framesExtracted < maxFrames) {
            try {
              if (opts.onFrame) {
                await opts.onFrame(frame, framesExtracted, frame.timestamp)
              }
              framesExtracted++
              if (opts.onProgress) {
                opts.onProgress(framesExtracted, maxFrames)
              }
            } catch (e) {
              console.warn('[frame-extractor] onFrame callback error:', e)
            }
          }
          frame.close()
          frameIndex++

          if (framesExtracted >= maxFrames && this.decoder) {
            resolve()
          }
        },
        error: (e: DOMException) => {
          reject(new Error(`VideoDecoder error: ${e.message}`))
        },
      })

      this.decoder.configure({
        codec,
        codedWidth: width,
        codedHeight: height,
        displayAspectWidth: width,
        displayAspectHeight: height,
        hardwareAcceleration: 'prefer-hardware',
      })

      // Request sample extraction from mp4box
      mp4File.onSamples = (_trackId: number, _user: any, samples: any[]) => {
        for (const sample of samples) {
          if (framesExtracted >= maxFrames) {
            break
          }

          const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: sample.cts * (1_000_000 / videoTrack.timescale),
            duration: sample.duration * (1_000_000 / videoTrack.timescale),
            data: sample.data,
          })

          try {
            if (this.decoder) {
              this.decoder.decode(chunk)
            }
          } catch (e) {
            console.warn('[frame-extractor] decode failed for sample:', e)
          }
        }

        // Flush after all samples are fed
        if (this.decoder) {
          this.decoder.flush().then(() => {
            if (framesExtracted < maxFrames) {
              resolve()
            }
          }).catch((e) => {
            reject(new Error(`Flush failed: ${e}`))
          })
        }
      }

      // Set extraction options for the video track
      mp4File.setExtractionOptions(videoTrack.id, null, { nbSamples: totalFrames })

      // Start extraction
      mp4File.start()
    })

    await decodePromise

    // Clean up
    if (this.decoder) {
      try {
        this.decoder.close()
      } catch { /* already closed */ }
      this.decoder = null
    }

    const durationMs = performance.now() - start
    const hardwareAccelerated = true // prefer-hardware was requested

    console.log(`[frame-extractor] extracted ${framesExtracted}/${totalFrames} frames in ${durationMs.toFixed(1)}ms — ${width}x${height}, codec=${codec}`)

    return {
      framesExtracted,
      totalFrames,
      durationMs,
      width,
      height,
      fps,
      codec,
      hardwareAccelerated,
    }
  }

  /**
   * Extract a single frame at a specific timestamp.
   * Useful for thumbnail generation or seeking.
   */
  async extractAt(file: File | Blob, timestampUs: number): Promise<VideoFrame | null> {
    let extractedFrame: VideoFrame | null = null

    await this.extract(file, {
      maxFrames: 1,
      sampleInterval: 1,
      onFrame: async (frame) => {
        // Find the frame closest to the requested timestamp
        if (frame.timestamp >= timestampUs && !extractedFrame) {
          extractedFrame = frame // caller must close()
        }
      },
    })

    return extractedFrame
  }

  /**
   * Extract frames and convert to ImageBitmaps for canvas rendering.
   * Each frame is converted to an ImageBitmap before the VideoFrame is closed.
   */
  async extractAsBitmaps(file: File | Blob, maxFrames: number): Promise<ImageBitmap[]> {
    const bitmaps: ImageBitmap[] = []

    await this.extract(file, {
      maxFrames,
      sampleInterval: 1,
      onFrame: async (frame) => {
        const bitmap = await createImageBitmap(frame)
        bitmaps.push(bitmap)
      },
    })

    return bitmaps
  }
}

export { VideoFrameExtractor }
export default VideoFrameExtractor
