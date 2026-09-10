/**
 * Lightning Plugin — Blitzortung real-time lightning detections.
 * Tier 3, Priority 11. Both repos use lightning for weather/hazard context.
 *
 * Subscribes to LIGHTNING_UPDATE IPC channel from main process.
 * Renders strikes as colored points with age-based fade.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { LiveFeature, LiveUpdate } from '@shared/types'

interface LightningStrike {
  id: string
  lon: number
  lat: number
  time: number
  intensity: number
  polarity: 'positive' | 'negative' | 'cloud'
}

/** Convert LiveFeature to LightningStrike */
function toLightningStrike(f: LiveFeature): LightningStrike | null {
  if (f.type !== 'lightning') return null
  const meta = f.meta || {}
  const polarityNum = meta.polarity as number
  return {
    id: f.id,
    lon: f.position.lon,
    lat: f.position.lat,
    time: (meta.time as number) ?? Date.now(),
    intensity: (meta.current as number) ?? 0,
    polarity: polarityNum === 1 ? 'positive' : polarityNum === 0 ? 'negative' : 'cloud',
  }
}

const STRIKE_LIFETIME = 60_000 // 60 seconds visible

export class LightningPlugin implements EarthEnginePlugin {
  id = 'lightning'
  name = 'Lightning (Blitzortung)'
  category = 'live' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private show = true
  private strikes = new Map<string, LightningStrike>()
  private unsubscribe: (() => void) | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private fadeTimer: ReturnType<typeof setInterval> | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.dataSource = new Cesium.CustomDataSource('lightning')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    const handler = (update: LiveUpdate) => {
      if (update.type === 'full' && update.features) {
        const strikes = update.features.map(toLightningStrike).filter((f): f is LightningStrike => f !== null)
        this.handleFullUpdate(strikes)
      } else if (update.type === 'delta') {
        const added = (update.added || []).map(toLightningStrike).filter((f): f is LightningStrike => f !== null)
        const removed = (update.removed || []).map((f) => f.id)
        this.handleDeltaUpdate(added, removed)
      }
    }

    const off = (ctx.ipc as any).on?.('lightning:update', handler)
    this.unsubscribe = off ? () => off() : null

    if (!this.unsubscribe) {
      this.startPolling()
    }

    // Fade out old strikes every 2 seconds
    this.fadeTimer = setInterval(() => this.fadeOldStrikes(), 2000)
  }

  unregister(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.strikes.clear()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'toggle', id: 'visible', label: 'Visible', value: this.show },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'count', label: 'Strikes', value: String(this.status.count), color: this.status.count > 0 ? '#4aff8a' : '#6b7d92' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    }
  }

  private startPolling(): void {
    this.fetchLightning()
    this.pollTimer = setInterval(() => this.fetchLightning(), 30_000)
  }

  private async fetchLightning(): Promise<void> {
    try {
      const features = await window.api.invoke('live:lightning', {}) as LiveFeature[] | null
      if (features) {
        const strikes = features.map(toLightningStrike).filter((f): f is LightningStrike => f !== null)
        this.handleFullUpdate(strikes)
      }
    } catch (err) {
      this.status = { ...this.status, status: 'stale', error: String(err) }
    }
  }

  private handleFullUpdate(features: LightningStrike[]): void {
    if (!this.dataSource) return

    for (const s of features) {
      this.strikes.set(s.id, s)
      this.addStrikeEntity(s)
    }

    this.status = { count: this.strikes.size, status: 'nominal' }
  }

  private handleDeltaUpdate(added: LightningStrike[], removed: string[]): void {
    if (!this.dataSource) return

    for (const id of removed) {
      this.dataSource.entities.removeById(`strike:${id}`)
      this.strikes.delete(id)
    }

    for (const s of added) {
      this.strikes.set(s.id, s)
      this.addStrikeEntity(s)
    }

    this.status = { count: this.strikes.size, status: 'nominal' }
  }

  private addStrikeEntity(s: LightningStrike): void {
    if (!this.dataSource) return

    // Color by polarity: positive=red, negative=blue, cloud=gray
    const color = s.polarity === 'positive'
      ? Cesium.Color.fromBytes(255, 74, 74, 255)
      : s.polarity === 'negative'
        ? Cesium.Color.fromBytes(74, 158, 255, 255)
        : Cesium.Color.fromBytes(138, 138, 138, 255)

    // Size scales with intensity
    const pixelSize = Math.max(5, Math.min(12, 5 + s.intensity / 20))

    this.dataSource.entities.add({
      id: `strike:${s.id}`,
      position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
      point: {
        pixelSize,
        color: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(0.8)),
        outlineWidth: new Cesium.ConstantProperty(1),
      },
      properties: {
        time: s.time,
        intensity: s.intensity,
        polarity: s.polarity,
      },
    } as any)
  }

  private fadeOldStrikes(): void {
    if (!this.dataSource) return
    const now = Date.now()
    const toRemove: string[] = []

    for (const [id, strike] of this.strikes) {
      if (now - strike.time > STRIKE_LIFETIME) {
        toRemove.push(id)
      }
    }

    for (const id of toRemove) {
      this.dataSource.entities.removeById(`strike:${id}`)
      this.strikes.delete(id)
    }

    if (toRemove.length > 0) {
      this.status = { count: this.strikes.size, status: 'nominal' }
    }
  }
}

export const lightningPlugin = new LightningPlugin()
