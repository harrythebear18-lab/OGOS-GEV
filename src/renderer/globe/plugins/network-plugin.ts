/**
 * Network Connections Plugin — TCP/UDP connections with GeoIP arcs.
 * Ported from OGOS GlobalOverlays net-connections + user-location layers.
 *
 * Subscribes to NET_UPDATE IPC channel.
 * Renders connections as arcs from user location to remote IPs.
 * Renders user location as a green point.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import type { NetworkUpdate, NetworkConnection, GeoLocation } from '@shared/types'

export class NetworkPlugin implements EarthEnginePlugin {
  id = 'network-connections'
  name = 'Network Connections'
  category = 'infrastructure' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private show = true
  private unsubscribe: (() => void) | null = null
  private unsubscribeVpn: (() => void) | null = null
  private unsubscribeLoc: (() => void) | null = null
  private knownConns = new Set<string>()
  private userLocation: GeoLocation | null = null

  register(ctx: PluginContext): void {
    this.viewer = ctx.viewer
    this.dataSource = new Cesium.CustomDataSource('network-connections')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'loading' }

    const handler = (update: NetworkUpdate) => {
      if (update?.connections) {
        this.handleUpdate(update.connections, update.userLocation)
      }
    }

    const locHandler = (loc: GeoLocation) => {
      this.userLocation = loc
      this.updateUserLocation()
    }

    ctx.ipc.network.onUpdate(handler)
    ctx.ipc.network.onUserLocation(locHandler)
    this.unsubscribe = () => ctx.ipc.off('net:update')
    this.unsubscribeLoc = () => ctx.ipc.off('net:userLocation')
  }

  unregister(): void {
    if (this.unsubscribe) this.unsubscribe()
    if (this.unsubscribeLoc) this.unsubscribeLoc()
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.knownConns.clear()
    this.userLocation = null
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
      { type: 'display', id: 'count', label: 'Connections', value: String(this.status.count), color: this.status.count > 0 ? '#4aff8a' : '#6b7d92' },
    ]
  }

  onControl(id: string, value?: unknown): void {
    if (id === 'visible' && typeof value === 'boolean') {
      this.show = value
      if (this.dataSource) this.dataSource.show = value
    }
  }

  private handleUpdate(connections: NetworkConnection[], userLocation?: GeoLocation | null): void {
    if (!this.dataSource) return

    if (userLocation) {
      this.userLocation = userLocation
      this.updateUserLocation()
    }

    // Only render connections with GeoIP data
    const geoConns = connections.filter((c) => c.geo && c.geo.lat != null)

    const newIds = new Set(geoConns.map((c) => c.id))
    for (const id of this.knownConns) {
      if (!newIds.has(id)) {
        this.dataSource.entities.removeById(`net:${id}`)
        this.dataSource.entities.removeById(`net-endpoint:${id}`)
        this.knownConns.delete(id)
      }
    }

    for (const c of geoConns) {
      this.updateConnectionEntity(c)
      this.knownConns.add(c.id)
    }

    this.status = { count: geoConns.length, status: 'nominal' }
  }

  private updateUserLocation(): void {
    if (!this.dataSource || !this.userLocation) return
    const { lat, lon } = this.userLocation
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0)

    const existing = this.dataSource.entities.getById('user-location')
    if (!existing) {
      this.dataSource.entities.add({
        id: 'user-location',
        position: new Cesium.ConstantPositionProperty(position),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromBytes(34, 197, 94, 255),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: 'You',
          font: '10px monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
        },
      } as any)
    } else {
      ;(existing.position as Cesium.ConstantPositionProperty).setValue(position)
    }
  }

  private updateConnectionEntity(c: NetworkConnection): void {
    if (!this.dataSource || !this.userLocation || !c.geo) return
    const id = `net:${c.id}`
    const endpointId = `net-endpoint:${c.id}`

    const startPos = Cesium.Cartesian3.fromDegrees(this.userLocation.lon, this.userLocation.lat, 0)
    const endPos = Cesium.Cartesian3.fromDegrees(c.geo.lon, c.geo.lat, 0)

    // Arc height proportional to distance
    const distance = Cesium.Cartesian3.distance(startPos, endPos)
    const arcHeight = Math.min(distance * 0.3, 2000000)

    const color = c.protocol === 'UDP'
      ? Cesium.Color.fromBytes(250, 204, 21, 100)
      : Cesium.Color.fromBytes(59, 130, 246, 100)

    // Arc polyline
    const existing = this.dataSource.entities.getById(id)
    if (!existing) {
      this.dataSource.entities.add({
        id,
        polyline: {
          positions: new Cesium.ConstantProperty([startPos, endPos]),
          material: new Cesium.PolylineGlowMaterialProperty({
            color,
            glowPower: 0.2,
          }),
          width: 2,
          arcType: Cesium.ArcType.NONE,
        },
      } as any)
    } else {
      ;(existing.polyline!.positions as Cesium.ConstantProperty).setValue([startPos, endPos])
    }

    // Endpoint point
    const existingEp = this.dataSource.entities.getById(endpointId)
    if (!existingEp) {
      this.dataSource.entities.add({
        id: endpointId,
        position: new Cesium.ConstantPositionProperty(endPos),
        point: {
          pixelSize: 4,
          color: Cesium.Color.fromBytes(239, 68, 68, 200),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
        },
        properties: {
          ip: c.remoteAddress,
          port: c.remotePort,
          country: c.geo.country,
          city: c.geo.city,
          process: c.processName,
        },
      } as any)
    }
  }
}

export const networkPlugin = new NetworkPlugin()
