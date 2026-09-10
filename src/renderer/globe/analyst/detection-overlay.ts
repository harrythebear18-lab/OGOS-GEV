/**
 * Detection Overlay — screen-space bounding boxes / corner brackets over
 * tracked objects (aircraft, vessels, satellites, fires, earthquakes).
 * Adapted from GEV's detection.js pattern.
 *
 * Renders on a Cesium postRender hook using a 2D canvas overlay.
 * Supports 4 density modes and 4 visual themes.
 *
 * Density modes:
 *  - OFF: overlay disabled
 *  - SPARSE: curated minimum label cohort
 *  - BALANCED: mixed-layer label cohort
 *  - DENSE: broad mixed-layer label cohort
 *
 * Themes: normal, retro, surveillance, thermal
 */

import * as Cesium from 'cesium'
import type { LiveFeature, LiveFeatureType } from '@shared/types'

export type DetectionMode = 'OFF' | 'SPARSE' | 'BALANCED' | 'DENSE'
export type DetectionTheme = 'normal' | 'retro' | 'surveillance' | 'thermal'

interface DetectionThemeColors {
  bracket: string
  label: string
  labelBg: string
  glow: string
  scanline: string
}

const THEME_MAP: Record<DetectionTheme, DetectionThemeColors> = {
  normal: { bracket: '#4affd4', label: '#e0e0e0', labelBg: '#0a0a0a', glow: '#4affd422', scanline: '#00000000' },
  retro: { bracket: '#ffea4a', label: '#ffea4a', labelBg: '#1a1a0a', glow: '#ffea4a33', scanline: '#ffea4a08' },
  surveillance: { bracket: '#4aff8a', label: '#4aff8a', labelBg: '#0a1a0a', glow: '#4aff8a33', scanline: '#4aff8a08' },
  thermal: { bracket: '#ff4a4a', label: '#ff8a4a', labelBg: '#1a0a0a', glow: '#ff4a4a33', scanline: '#ff4a4a08' },
}

const DENSITY_LIMITS: Record<DetectionMode, number> = {
  OFF: 0,
  SPARSE: 15,
  BALANCED: 50,
  DENSE: 200,
}

const LAYER_WEIGHTS: Partial<Record<LiveFeatureType, number>> = {
  aircraft: 1.2,
  vessel: 1.0,
  satellite: 1.0,
  fire: 1.1,
  quake: 1.3,
  storm: 1.4,
}

export class DetectionOverlay {
  private viewer: Cesium.Viewer | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private mode: DetectionMode = 'OFF'
  private theme: DetectionTheme = 'normal'
  private features: LiveFeature[] = []
  private removeListener: (() => void) | null = null
  private frameCount = 0

  attach(viewer: Cesium.Viewer): void {
    this.viewer = viewer
    const container = viewer.canvas.parentElement
    if (!container) return

    // Create overlay canvas
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = '0'
    this.canvas.style.left = '0'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.zIndex = '10'
    container.appendChild(this.canvas)

    this.ctx = this.canvas.getContext('2d')
    this.resize()

    // Listen to Cesium postRender
    this.removeListener = viewer.scene.postRender.addEventListener(this.onPostRender.bind(this)) as unknown as () => void

    // Resize observer
    const resizeObserver = new ResizeObserver(() => this.resize())
    resizeObserver.observe(container)
  }

  detach(): void {
    this.removeListener?.()
    this.removeListener = null
    this.canvas?.remove()
    this.canvas = null
    this.ctx = null
    this.viewer = null
  }

  private resize(): void {
    if (!this.canvas || !this.viewer) return
    const w = this.viewer.canvas.clientWidth
    const h = this.viewer.canvas.clientHeight
    this.canvas.width = w
    this.canvas.height = h
  }

  setMode(mode: DetectionMode): void {
    this.mode = mode
  }

  getMode(): DetectionMode {
    return this.mode
  }

  setTheme(theme: DetectionTheme): void {
    this.theme = theme
  }

  getTheme(): DetectionTheme {
    return this.theme
  }

  updateFeatures(features: LiveFeature[]): void {
    this.features = features
  }

  private onPostRender(): void {
    if (!this.viewer || !this.canvas || !this.ctx) return
    if (this.mode === 'OFF') {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      return
    }

    this.frameCount++
    const limit = DENSITY_LIMITS[this.mode]
    const colors = THEME_MAP[this.theme]

    // Sort by weight and take top N
    const sorted = this.features
      .filter((f) => f.position.lat != null && f.position.lon != null)
      .sort((a, b) => (LAYER_WEIGHTS[b.type] ?? 1) - (LAYER_WEIGHTS[a.type] ?? 1))
      .slice(0, limit)

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    for (const feature of sorted) {
      this.drawDetection(feature, colors)
    }

    // Scanline effect for non-normal themes
    if (this.theme !== 'normal' && this.frameCount % 4 === 0) {
      this.drawScanline(colors.scanline)
    }
  }

  private drawDetection(feature: LiveFeature, colors: DetectionThemeColors): void {
    if (!this.viewer || !this.ctx) return

    const cart = Cesium.Cartesian3.fromDegrees(feature.position.lon, feature.position.lat, feature.position.height ?? 0)
    const windowPos = this.viewer.scene.cartesianToCanvasCoordinates(cart)
    if (!windowPos) return

    // Check if behind globe
    const cameraPos = this.viewer.camera.position
    const distance = Cesium.Cartesian3.distance(cameraPos, cart)
    const globeOccluded = this.viewer.scene.globe.depthTestAgainstTerrain
    if (globeOccluded) {
      // Simple visibility check: is the point within the viewport?
      if (windowPos.x < 0 || windowPos.y < 0 || windowPos.x > this.canvas!.width || windowPos.y > this.canvas!.height) return
    }

    const x = windowPos.x
    const y = windowPos.y

    // Bracket size scales with distance (closer = bigger)
    const bracketSize = Math.max(12, Math.min(40, 4000 / distance * 10))
    const label = String(feature.meta.callsign || feature.meta.name || feature.id)
    const typeLabel = feature.type.toUpperCase()

    // Draw corner brackets
    this.ctx.strokeStyle = colors.bracket
    this.ctx.lineWidth = 1.5
    this.ctx.shadowColor = colors.glow
    this.ctx.shadowBlur = 4

    const bs = bracketSize
    // Top-left
    this.ctx.beginPath()
    this.ctx.moveTo(x - bs, y - bs + 6)
    this.ctx.lineTo(x - bs, y - bs)
    this.ctx.lineTo(x - bs + 6, y - bs)
    this.ctx.stroke()
    // Top-right
    this.ctx.beginPath()
    this.ctx.moveTo(x + bs, y - bs + 6)
    this.ctx.lineTo(x + bs, y - bs)
    this.ctx.lineTo(x + bs - 6, y - bs)
    this.ctx.stroke()
    // Bottom-left
    this.ctx.beginPath()
    this.ctx.moveTo(x - bs, y + bs - 6)
    this.ctx.lineTo(x - bs, y + bs)
    this.ctx.lineTo(x - bs + 6, y + bs)
    this.ctx.stroke()
    // Bottom-right
    this.ctx.beginPath()
    this.ctx.moveTo(x + bs, y + bs - 6)
    this.ctx.lineTo(x + bs, y + bs)
    this.ctx.lineTo(x + bs - 6, y + bs)
    this.ctx.stroke()

    this.ctx.shadowBlur = 0

    // Draw label
    this.ctx.font = '11px monospace'
    const labelText = `${label} ${typeLabel}`
    const textWidth = this.ctx.measureText(labelText).width
    const labelY = y - bs - 14

    this.ctx.fillStyle = colors.labelBg
    this.ctx.fillRect(x - bs, labelY - 2, Math.max(textWidth + 8, bs * 2), 16)

    this.ctx.fillStyle = colors.label
    this.ctx.fillText(labelText, x - bs + 4, labelY + 11)

    // Distance micro-label
    if (distance > 1000) {
      const distLabel = `${(distance / 1000).toFixed(0)}km`
      this.ctx.font = '9px monospace'
      this.ctx.fillStyle = colors.label + 'aa'
      this.ctx.fillText(distLabel, x + bs - 30, y + bs + 12)
    }
  }

  private drawScanline(color: string): void {
    if (!this.ctx || !this.canvas) return
    const y = (this.frameCount * 3) % this.canvas.height
    this.ctx.fillStyle = color
    this.ctx.fillRect(0, y, this.canvas.width, 2)
  }

  getDiagnostics(): { mode: string; theme: string; visible: number; total: number } {
    return {
      mode: this.mode,
      theme: this.theme,
      visible: this.mode === 'OFF' ? 0 : Math.min(DENSITY_LIMITS[this.mode], this.features.length),
      total: this.features.length,
    }
  }
}

export const detectionOverlay = new DetectionOverlay()
