/**
 * Detection Plugin — screen-space bounding boxes over tracked objects.
 * Wraps the DetectionOverlay in the plugin interface.
 *
 * Renders corner brackets + labels on a 2D canvas overlay above the Cesium globe.
 * Supports 4 density modes (OFF/SPARSE/BALANCED/DENSE) and 4 themes (normal/retro/surveillance/thermal).
 */

import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import { DetectionOverlay, type DetectionMode, type DetectionTheme } from '../analyst/detection-overlay'
import type { LiveFeature, LiveUpdate } from '@shared/types'

class DetectionPlugin implements EarthEnginePlugin {
  id = 'detection'
  name = 'Detection Overlay'
  category = 'ai' as const

  private overlay: DetectionOverlay | null = null
  private mode: DetectionMode = 'OFF'
  private theme: DetectionTheme = 'normal'
  private status: PluginStats = { count: 0, status: 'disabled' }
  private liveFeatures: LiveFeature[] = []
  private liveUnsub: (() => void) | null = null

  register(ctx: PluginContext): void {
    this.overlay = new DetectionOverlay()
    this.overlay.attach(ctx.viewer)
    this.overlay.setMode(this.mode)
    this.overlay.setTheme(this.theme)

    // Subscribe to live updates
    this.liveUnsub = ctx.ipc.live.onUpdate((update: LiveUpdate) => {
      if (update.type === 'full' && update.features) {
        this.liveFeatures = update.features
      } else if (update.type === 'delta') {
        if (update.added) {
          for (const f of update.added) {
            const idx = this.liveFeatures.findIndex((e) => e.id === f.id)
            if (idx >= 0) this.liveFeatures[idx] = f
            else this.liveFeatures.push(f)
          }
        }
        if (update.removed) {
          const removeIds = new Set(update.removed.map((f) => f.id))
          this.liveFeatures = this.liveFeatures.filter((f) => !removeIds.has(f.id))
        }
      }
      this.overlay?.updateFeatures(this.liveFeatures)
      this.status = { count: this.liveFeatures.length, status: 'nominal' }
    })

    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    this.liveUnsub?.()
    this.liveUnsub = null
    this.overlay?.detach()
    this.overlay = null
    this.liveFeatures = []
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    const diag = this.overlay?.getDiagnostics() ?? { mode: this.mode, theme: this.theme, visible: 0, total: 0 }
    return [
      { type: 'select', id: 'mode', label: 'Density', value: this.mode, options: [
        { label: 'OFF', value: 'OFF' },
        { label: 'Sparse', value: 'SPARSE' },
        { label: 'Balanced', value: 'BALANCED' },
        { label: 'Dense', value: 'DENSE' },
      ]},
      { type: 'select', id: 'theme', label: 'Theme', value: this.theme, options: [
        { label: 'Normal', value: 'normal' },
        { label: 'Retro', value: 'retro' },
        { label: 'Surveillance', value: 'surveillance' },
        { label: 'Thermal', value: 'thermal' },
      ]},
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'visible', label: 'Visible', value: String(diag.visible), color: '#4affd4' },
      { type: 'display', id: 'total', label: 'Total Tracked', value: String(diag.total), color: '#a04aff' },
      { type: 'display', id: 'mode', label: 'Mode', value: diag.mode, color: '#4a8aff' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'mode' && typeof value === 'string') {
      this.mode = value as DetectionMode
      this.overlay?.setMode(this.mode)
    } else if (id === 'theme' && typeof value === 'string') {
      this.theme = value as DetectionTheme
      this.overlay?.setTheme(this.theme)
    }
  }
}

export const detectionPlugin = new DetectionPlugin()
