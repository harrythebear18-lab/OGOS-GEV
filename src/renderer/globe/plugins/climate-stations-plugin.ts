/**
 * Climate Stations Plugin — buoys, Argo floats, weather stations, CO₂ stations.
 * Ported from OGOS GlobalOverlays climate-stations layer.
 *
 * Subscribes to CLIMATE_UPDATE IPC channel.
 * Renders stations as colored point entities on the globe.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { ClimateStation, ClimateUpdate, ClimateMeasurement } from '@shared/types'

const STATION_COLORS: Record<string, Cesium.Color> = {
  buoy: Cesium.Color.fromBytes(0, 255, 204, 255),
  argo_float: Cesium.Color.fromBytes(79, 195, 247, 255),
  bgc_argo_float: Cesium.Color.fromBytes(255, 170, 0, 255),
  carbon_station: Cesium.Color.fromBytes(255, 102, 0, 255),
  weather_station: Cesium.Color.fromBytes(0, 170, 136, 255),
  storm: Cesium.Color.fromBytes(255, 51, 102, 255),
  lightning: Cesium.Color.fromBytes(255, 235, 59, 255),
}

function stationColor(type: string): Cesium.Color {
  return STATION_COLORS[type] ?? Cesium.Color.fromBytes(192, 200, 216, 255)
}

export class ClimateStationsPlugin implements EarthEnginePlugin {
  id = 'climate-stations'
  name = 'Climate Stations'
  category = 'climate' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private show = true
  private unsubscribe: (() => void) | null = null
  private stations = new Map<string, { station: ClimateStation; measurement?: ClimateMeasurement }>()

  register(ctx: PluginContext): void {
    this.viewer = ctx.viewer
    this.dataSource = new Cesium.CustomDataSource('climate-stations')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    const handler = (update: ClimateUpdate) => {
      if (update.stations) {
        this.handleUpdate(update.stations, update.measurements)
      }
    }

    ctx.ipc.climate.onUpdate(handler)
    this.unsubscribe = () => ctx.ipc.off('climate:update')
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
    this.stations.clear()
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
      { type: 'display', id: 'count', label: 'Active Stations', value: String(this.status.count), color: this.status.count > 0 ? '#4aff8a' : '#6b7d92' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    }
  }

  private handleUpdate(
    stations: ClimateStation[],
    measurements: Record<string, ClimateMeasurement>,
  ): void {
    if (!this.dataSource) return

    const newIds = new Set(stations.map((s) => s.id))
    const toRemove: string[] = []
    for (const id of this.stations.keys()) {
      if (!newIds.has(id)) toRemove.push(id)
    }
    for (const id of toRemove) {
      this.dataSource.entities.removeById(`station:${id}`)
      this.stations.delete(id)
    }

    for (const s of stations) {
      const m = measurements[s.id]
      this.stations.set(s.id, { station: s, measurement: m })
      this.updateEntity(s, m)
    }

    this.status = { count: stations.length, status: 'nominal' }
  }

  private updateEntity(s: ClimateStation, m?: ClimateMeasurement): void {
    if (!this.dataSource) return
    const id = `station:${s.id}`
    const existing = this.dataSource.entities.getById(id)
    const position = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, s.elevation ?? 0)
    const color = stationColor(s.type)
    const label = s.name ? s.name.substring(0, 20) : ''

    const labelOpts = label
      ? {
          text: label,
          font: '9px monospace',
          fillColor: Cesium.Color.WHITE.withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
        }
      : undefined

    if (!existing) {
      this.dataSource.entities.add({
        id,
        position: new Cesium.ConstantPositionProperty(position),
        point: {
          pixelSize: 6,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
        },
        label: labelOpts,
        properties: {
          type: s.type,
          source: s.source,
          waterTemp: m?.waterTemp,
          airTemp: m?.airTemp,
          windSpeed: m?.windSpeed,
          pressure: m?.pressure,
        },
      } as any)
    } else {
      ;(existing.position as Cesium.ConstantPositionProperty).setValue(position)
    }
  }
}

export const climateStationsPlugin = new ClimateStationsPlugin()
