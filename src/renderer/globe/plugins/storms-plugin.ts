/**
 * Storms Plugin — active tropical cyclones + forecast tracks.
 * Ported from OGOS GlobalOverlays storm-cells + storm-tracks layers.
 *
 * Subscribes to STORM_UPDATE IPC channel.
 * Renders storm cells as colored point entities + forecast tracks as polylines.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { Storm } from '@shared/types'

function stormIntensityColor(intensity: string): Cesium.Color {
  switch (intensity) {
    case 'light': return Cesium.Color.fromBytes(79, 195, 247, 255)
    case 'moderate': return Cesium.Color.fromBytes(255, 170, 0, 255)
    case 'heavy': return Cesium.Color.fromBytes(255, 102, 0, 255)
    case 'extreme': return Cesium.Color.fromBytes(255, 51, 102, 255)
    default: return Cesium.Color.fromBytes(79, 195, 247, 255)
  }
}

export class StormsPlugin implements EarthEnginePlugin {
  id = 'storms'
  name = 'Storms (NHC)'
  category = 'climate' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private unsubscribe: (() => void) | null = null
  private knownStorms = new Set<string>()
  private showCells = true
  private showTracks = true
  private storms: Storm[] = []

  register(ctx: PluginContext): void {
    this.viewer = ctx.viewer
    this.dataSource = new Cesium.CustomDataSource('storms')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    const handler = (storms: Storm[]) => {
      if (Array.isArray(storms)) {
        this.handleUpdate(storms)
      }
    }

    ctx.ipc.storms.onUpdate(handler)
    this.unsubscribe = () => ctx.ipc.off('storm:update')
  }

  unregister(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.knownStorms.clear()
    this.viewer = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    const controls: PluginControlSpec[] = [
      { type: 'toggle', id: 'cells', label: 'Storm Cells', value: this.showCells },
      { type: 'toggle', id: 'tracks', label: 'Forecast Tracks', value: this.showTracks },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'count', label: 'Active Storms', value: String(this.storms.length), color: this.storms.length > 0 ? '#ff8a4a' : '#6b7d92' },
    ]

    // Show details for each storm
    for (const s of this.storms.slice(0, 5)) {
      const intensityColor = s.intensity === 'extreme' ? '#ff3366' : s.intensity === 'heavy' ? '#ff6600' : s.intensity === 'moderate' ? '#ffaa00' : '#4fc3f7'
      controls.push(
        { type: 'display', id: `storm-${s.id}-name`, label: s.name || s.id, value: s.classification || '', color: intensityColor },
        { type: 'display', id: `storm-${s.id}-wind`, label: '  Wind', value: s.windSpeedKt ? `${s.windSpeedKt} kt` : '—', color: '#4affd4' },
        { type: 'display', id: `storm-${s.id}-pres`, label: '  Pressure', value: s.pressureMB ? `${s.pressureMB} mb` : '—', color: '#ffd24a' },
      )
    }

    return controls
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'cells' && typeof value === 'boolean') {
      this.showCells = value
      if (this.dataSource) {
        for (const s of this.storms) {
          const e = this.dataSource.entities.getById(`storm:${s.id}`)
          if (e) e.show = value
        }
      }
    } else if (id === 'tracks' && typeof value === 'boolean') {
      this.showTracks = value
      if (this.dataSource) {
        for (const s of this.storms) {
          const e = this.dataSource.entities.getById(`storm-track:${s.id}`)
          if (e) e.show = value
        }
      }
    }
  }

  private handleUpdate(storms: Storm[]): void {
    if (!this.dataSource) return
    this.storms = storms

    const newIds = new Set(storms.map((s) => s.id))
    const toRemove: string[] = []
    for (const id of this.knownStorms) {
      if (!newIds.has(id)) toRemove.push(id)
    }
    for (const id of toRemove) {
      this.dataSource.entities.removeById(`storm:${id}`)
      this.dataSource.entities.removeById(`storm-track:${id}`)
      this.knownStorms.delete(id)
    }

    for (const s of storms) {
      this.updateStormEntity(s)
      this.updateTrackEntity(s)
      this.knownStorms.add(s.id)
    }

    this.status = { count: storms.length, status: 'nominal' }
  }

  private updateStormEntity(s: Storm): void {
    if (!this.dataSource) return
    const id = `storm:${s.id}`
    const position = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0)
    const color = stormIntensityColor(s.intensity || 'moderate')

    const existing = this.dataSource.entities.getById(id)
    if (!existing) {
      this.dataSource.entities.add({
        id,
        position: new Cesium.ConstantPositionProperty(position),
        show: this.showCells,
        point: {
          pixelSize: 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: s.name || '',
          font: '10px monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
        },
        properties: {
          classification: s.classification,
          intensity: s.intensity,
          windSpeedKt: s.windSpeedKt,
          pressureMB: s.pressureMB,
        },
      } as any)
    } else {
      ;(existing.position as Cesium.ConstantPositionProperty).setValue(position)
    }
  }

  private updateTrackEntity(s: Storm): void {
    if (!this.dataSource) return
    const id = `storm-track:${s.id}`
    const track = s.forecastTrack?.length > 1 ? s.forecastTrack : s.track
    if (!track || track.length < 2) {
      this.dataSource.entities.removeById(id)
      return
    }

    const positions = track.map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
    )

    const existing = this.dataSource.entities.getById(id)
    if (!existing) {
      this.dataSource.entities.add({
        id,
        show: this.showTracks,
        polyline: {
          positions: new Cesium.ConstantProperty(positions),
          material: Cesium.Color.fromBytes(255, 102, 0, 180),
          width: 2,
          arcType: Cesium.ArcType.NONE,
        },
      } as any)
    } else {
      ;(existing.polyline!.positions as Cesium.ConstantProperty).setValue(positions)
    }
  }
}

export const stormsPlugin = new StormsPlugin()
