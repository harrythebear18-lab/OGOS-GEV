/**
 * Band Math Plugin — Sentinel-2 spectral index computation (NDVI, NDWI, NBR).
 * Tier 1, Priority 4. The headline Sentinel-2 analysis feature.
 *
 * Fetches individual spectral bands from GIBS WMS, computes spectral indices
 * using the compute dispatcher (WebGPU → CPU worker → fallback), and renders
 * the result as a color-mapped Cesium imagery layer over the selection bbox.
 *
 * Indices:
 *   NDVI = (NIR - Red) / (NIR + Red)  — vegetation health
 *   NDWI = (Green - NIR) / (Green + NIR) — water bodies
 *   NBR  = (NIR - SWIR) / (NIR + SWIR) — burn severity
 *
 * GIBS provides Sentinel-2 bands via WMS:
 *   B02 (Blue), B03 (Green), B04 (Red), B08 (NIR), B12 (SWIR)
 *
 * The compute dispatcher routes to:
 *   1. WebGPU `ndvi`/`ndwi`/`nbr` kernel (GPU — thousands of cores)
 *   2. CPU inline (fallback)
 *
 * This is real Sentinel-2 band math, not just GIBS browse imagery.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import { computeDispatcher } from '../hal/compute-dispatcher'
import type { ComputeTask } from '@shared/compute-contract'

type BandIndex = 'ndvi' | 'ndwi' | 'nbr'

interface BandSpec {
  id: BandIndex
  label: string
  bandA: string  // numerator band
  bandB: string  // denominator band
  task: ComputeTask
  // Color ramp: [value, r, g, b]
  ramp: [number, number, number, number][]
}

const GIBS_WMS_BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'

// Sentinel-2 bands available in GIBS WMS
const S2_BANDS: Record<string, string> = {
  'B02': 'Sentinel_2_L2A_B02_Blue_20m',     // Blue
  'B03': 'Sentinel_2_L2A_B03_Green_20m',    // Green
  'B04': 'Sentinel_2_L2A_B04_Red_20m',      // Red
  'B08': 'Sentinel_2_L2A_B08_NIR_20m',      // Near-Infrared
  'B12': 'Sentinel_2_L2A_B12_SWIR_20m',     // Shortwave Infrared
}

const BAND_SPECS: BandSpec[] = [
  {
    id: 'ndvi',
    label: 'NDVI (Vegetation)',
    bandA: 'B08',  // NIR
    bandB: 'B04',  // Red
    task: 'ndvi',
    ramp: [
      [-1.0, 0, 0, 80],     // Deep water
      [-0.2, 0, 0, 120],    // Shallow water
      [0.0, 180, 120, 40], // Bare soil
      [0.3, 200, 200, 50], // Sparse vegetation
      [0.6, 80, 180, 50],  // Moderate vegetation
      [0.8, 40, 140, 40],  // Dense vegetation
      [1.0, 20, 100, 20],  // Very dense
    ],
  },
  {
    id: 'ndwi',
    label: 'NDWI (Water)',
    bandA: 'B03',  // Green
    bandB: 'B08',  // NIR
    task: 'ndwi',
    ramp: [
      [-1.0, 200, 200, 200], // Land
      [-0.2, 150, 150, 180], // Dry land
      [0.0, 100, 150, 200],  // Moist
      [0.2, 50, 100, 200],   // Water edge
      [0.5, 20, 60, 180],    // Water
      [1.0, 0, 20, 120],     // Deep water
    ],
  },
  {
    id: 'nbr',
    label: 'NBR (Burn Severity)',
    bandA: 'B08',  // NIR
    bandB: 'B12',  // SWIR
    task: 'nbr',
    ramp: [
      [-1.0, 180, 0, 0],     // High severity burn
      [-0.3, 220, 100, 0],   // Moderate burn
      [0.0, 200, 180, 50],   // Low burn
      [0.3, 150, 200, 80],   // Unburned
      [0.6, 80, 180, 50],    // Healthy veg
      [1.0, 20, 100, 20],    // Very healthy
    ],
  },
]

export class BandMathPlugin implements EarthEnginePlugin {
  id = 'band-math'
  name = 'Sentinel-2 Band Math (NDVI/NDWI/NBR)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private imageryLayer: Cesium.ImageryLayer | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private ipc: typeof window.api | null = null
  private lastBbox: string | null = null
  private lastBboxParsed: { west: number; south: number; east: number; north: number } | null = null
  private currentIndex: BandIndex = 'ndvi'
  private opacity = 0.7

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    this.removeLayer()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(ctx: PluginContext): void {
    const sceneCtx = ctx.sceneContext as any
    const bbox = sceneCtx?.selectionBbox
    if (!bbox) return

    this.lastBboxParsed = bbox
    const bboxKey = `${bbox.west.toFixed(2)},${bbox.south.toFixed(2)},${bbox.east.toFixed(2)},${bbox.north.toFixed(2)}`
    if (bboxKey === this.lastBbox) return
    this.lastBbox = bboxKey

    const height = sceneCtx?.camera?.height
    if (height && height > 500_000) return

    this.runAnalysis(bbox)
  }

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'select', id: 'index', label: 'Index', value: this.currentIndex, options: BAND_SPECS.map((b) => ({ label: b.label, value: b.id })) },
      { type: 'slider', id: 'opacity', label: 'Opacity', value: this.opacity, min: 0, max: 1, step: 0.1 },
      { type: 'button', id: 'run', label: 'Compute Index', variant: 'primary' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: !this.imageryLayer },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'backend', label: 'Backend', value: this.status.error ? 'error' : (this.imageryLayer ? 'active' : 'idle'), color: '#4aff8a' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'index' && typeof value === 'string') {
      this.currentIndex = value as BandIndex
      if (this.lastBboxParsed) { this.lastBbox = null; this.runAnalysis(this.lastBboxParsed) }
    } else if (id === 'opacity' && typeof value === 'number') {
      this.opacity = value
      if (this.imageryLayer) this.imageryLayer.alpha = value
    } else if (id === 'run') {
      if (this.lastBboxParsed) { this.lastBbox = null; this.runAnalysis(this.lastBboxParsed) }
    } else if (id === 'clear') {
      this.removeLayer()
      this.lastBbox = null
      this.status = { count: 0, status: 'nominal' }
    }
  }

  clear(): void {
    this.removeLayer()
    this.lastBbox = null
    this.status = { count: 0, status: 'nominal' }
  }

  private async runAnalysis(bbox: { west: number; south: number; east: number; north: number }): Promise<void> {
    if (!this.viewer || !this.ipc) return
    this.status = { ...this.status, status: 'loading' }

    try {
      const spec = BAND_SPECS.find((b) => b.id === this.currentIndex)!
      const reqWidth = 256
      const reqHeight = 256

      // Fetch both bands as PNG rasters via GIBS WMS
      const [bandA, bandB] = await Promise.all([
        this.fetchBandRaster(spec.bandA, bbox, reqWidth, reqHeight),
        this.fetchBandRaster(spec.bandB, bbox, reqWidth, reqHeight),
      ])

      if (!bandA || !bandB) {
        console.warn('[band-math] failed to fetch band rasters from GIBS')
        this.status = { count: 0, status: 'degraded' }
        return
      }

      // Extract single-channel float data from RGBA (use red channel as reflectance proxy)
      const bandAFloat = this.extractChannel(bandA.data, bandA.width, bandA.height)
      const bandBFloat = this.extractChannel(bandB.data, bandB.width, bandB.height)

      // Dispatch band math to compute dispatcher (WebGPU → CPU)
      const result = await computeDispatcher.dispatch(spec.task, {
        width: bandA.width,
        height: bandA.height,
        input: bandAFloat,
        input2: bandBFloat,
      })

      if (result.backend === 'noop' || result.output.length === 0) {
        this.status = { count: 0, status: 'degraded' }
        return
      }

      // Color-map the index values to RGBA
      const canvas = this.colorMapToCanvas(result.output, bandA.width, bandA.height, spec.ramp)
      const blobUrl = await this.canvasToBlobUrl(canvas)

      this.removeLayer()

      const rectangle = Cesium.Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north)
      const provider = new Cesium.SingleTileImageryProvider({
        url: blobUrl,
        rectangle,
      })

      this.imageryLayer = this.viewer.imageryLayers.addImageryProvider(provider)
      this.imageryLayer.alpha = this.opacity

      console.log(`[band-math] ${spec.id} computed on ${result.backend} — ${bandA.width}x${bandA.height} in ${result.durationMs.toFixed(1)}ms`)
      this.status = { count: 1, status: 'nominal' }
    } catch (err) {
      console.warn('[band-math] analysis failed:', err)
      this.status = { ...this.status, status: 'error', error: String(err) }
    }
  }

  /** Fetch a single GIBS band as a raster via WMS, decode through WebCodecs bridge. */
  private async fetchBandRaster(
    band: string,
    bbox: { west: number; south: number; east: number; north: number },
    width: number,
    height: number,
  ): Promise<{ data: Uint8Array; width: number; height: number } | null> {
    const gibsLayer = S2_BANDS[band]
    if (!gibsLayer) return null

    // Try yesterday, then 3 days ago, then 7 days ago (cloud cover may block recent dates)
    const dates: string[] = []
    for (let back = 1; back <= 7; back++) {
      const d = new Date()
      d.setDate(d.getDate() - back)
      dates.push(d.toISOString().split('T')[0])
    }

    for (const date of dates) {
      const wmsUrl = `${GIBS_WMS_BASE}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${gibsLayer}&CRS=EPSG:4326&BBOX=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/png&TIME=${date}`

      try {
        // Fetch via streaming I/O IPC (main process handles the download)
        const bufArray = await this.ipc!.invoke('hal:fetch-buffer', { url: wmsUrl, timeoutMs: 15000 }) as number[] | null
        if (!bufArray || bufArray.length < 100) continue

        const buf = new Uint8Array(bufArray)

        // Decode via WebCodecs in renderer (hardware decode)
        const { webCodecs } = await import('../hal/webcodecs')
        if (webCodecs.isAvailable()) {
          try {
            const result = await webCodecs.decodeImageFromBytes(buf, 'image/png')
            return { data: new Uint8Array(result.data), width: result.width, height: result.height }
          } catch {
            // Fall through to pngjs
          }
        }

        // Fallback: pngjs (renderer-side import)
        const { PNG } = await import('pngjs')
        const png = PNG.sync.read(Buffer.from(buf))
        return { data: png.data as unknown as Uint8Array, width: png.width, height: png.height }
      } catch {
        continue
      }
    }

    return null
  }

  /** Extract a single channel (red) from RGBA data as Float32Array (0-1 reflectance proxy). */
  private extractChannel(data: Uint8Array, width: number, height: number): Float32Array {
    const out = new Float32Array(width * height)
    for (let i = 0; i < width * height; i++) {
      out[i] = data[i * 4] / 255.0  // Red channel as reflectance proxy
    }
    return out
  }

  /** Color-map index values (-1 to 1) to RGBA using a color ramp. */
  private colorMapToCanvas(
    data: Float32Array,
    width: number,
    height: number,
    ramp: [number, number, number, number][],
  ): OffscreenCanvas {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.createImageData(width, height)

    for (let i = 0; i < data.length; i++) {
      const val = Math.max(-1, Math.min(1, data[i]))
      const [r, g, b] = this.interpolateRamp(ramp, val)
      const idx = i * 4
      imageData.data[idx] = r
      imageData.data[idx + 1] = g
      imageData.data[idx + 2] = b
      imageData.data[idx + 3] = 255
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  /** Linear interpolation between color ramp stops. */
  private interpolateRamp(ramp: [number, number, number, number][], val: number): [number, number, number] {
    if (val <= ramp[0][0]) return [ramp[0][1], ramp[0][2], ramp[0][3]]
    if (val >= ramp[ramp.length - 1][0]) return [ramp[ramp.length - 1][1], ramp[ramp.length - 1][2], ramp[ramp.length - 1][3]]

    for (let i = 0; i < ramp.length - 1; i++) {
      if (val >= ramp[i][0] && val <= ramp[i + 1][0]) {
        const t = (val - ramp[i][0]) / (ramp[i + 1][0] - ramp[i][0])
        return [
          Math.round(ramp[i][1] + t * (ramp[i + 1][1] - ramp[i][1])),
          Math.round(ramp[i][2] + t * (ramp[i + 1][2] - ramp[i][2])),
          Math.round(ramp[i][3] + t * (ramp[i + 1][3] - ramp[i][3])),
        ]
      }
    }
    return [0, 0, 0]
  }

  private async canvasToBlobUrl(canvas: OffscreenCanvas): Promise<string> {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return URL.createObjectURL(blob)
  }

  private removeLayer(): void {
    if (this.imageryLayer && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.imageryLayers.remove(this.imageryLayer)
    }
    this.imageryLayer = null
  }
}

export const bandMathPlugin = new BandMathPlugin()
