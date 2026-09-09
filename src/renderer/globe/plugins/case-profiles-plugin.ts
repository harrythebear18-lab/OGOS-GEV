/**
 * Case Profiles Plugin — Incident management.
 * Tier 5, Priority 18. From OGOS.
 *
 * Loads predefined case scenarios (M Cave, Kenny Veach, Custom) and
 * dispatches markers (LKP, end point, fall point, weather pin) to the globe.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface CaseMarker {
  id: string
  type: 'lkp' | 'end' | 'fall' | 'weather' | 'custom'
  lon: number
  lat: number
  label: string
  description?: string
}

interface CaseProfile {
  id: string
  name: string
  description: string
  markers: CaseMarker[]
}

export class CaseProfilesPlugin implements EarthEnginePlugin {
  id = 'case-profiles'
  name = 'Case Profiles (Incident Mgmt)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private profiles: CaseProfile[] = []
  private activeProfile: CaseProfile | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('case-profiles')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }

    // Load profiles from main process
    try {
      const result = await this.ipc.invoke('case:profiles', {}) as { profiles: CaseProfile[] } | null
      this.profiles = result?.profiles || []
      this.status = { count: this.profiles.length, status: 'nominal' }
    } catch (err) {
      this.status = { count: 0, status: 'error', error: String(err) }
    }
  }

  unregister(): void {
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.profiles = []
    this.activeProfile = null
    this.viewer = null
    this.ipc = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getProfiles(): CaseProfile[] {
    return this.profiles
  }

  getActiveProfile(): CaseProfile | null {
    return this.activeProfile
  }

  loadProfile(id: string): void {
    const profile = this.profiles.find((p) => p.id === id)
    if (!profile || !this.dataSource) return

    this.dataSource.entities.removeAll()
    this.activeProfile = profile

    for (const marker of profile.markers) {
      this.addMarkerEntity(marker)
    }

    // Fly to first marker
    if (profile.markers.length > 0 && this.viewer) {
      const m = profile.markers[0]
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 5000),
        duration: 2,
      })
    }

    this.status = { count: profile.markers.length, status: 'nominal' }
  }

  clearProfile(): void {
    this.activeProfile = null
    this.dataSource?.entities.removeAll()
    this.status = { count: 0, status: 'nominal' }
  }

  private addMarkerEntity(marker: CaseMarker): void {
    if (!this.dataSource) return

    const color = this.markerColor(marker.type)

    this.dataSource.entities.add({
      id: `case:${marker.id}`,
      position: Cesium.Cartesian3.fromDegrees(marker.lon, marker.lat),
      point: {
        pixelSize: 12,
        color: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.WHITE),
        outlineWidth: new Cesium.ConstantProperty(2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: marker.label,
        font: '11px monospace',
        fillColor: new Cesium.ConstantProperty(color),
        outlineColor: new Cesium.ConstantProperty(Cesium.Color.BLACK),
        outlineWidth: new Cesium.ConstantProperty(2),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        type: marker.type,
        description: marker.description,
      },
    } as any)
  }

  private markerColor(type: string): Cesium.Color {
    switch (type) {
      case 'lkp': return Cesium.Color.fromBytes(255, 74, 255, 255)
      case 'end': return Cesium.Color.fromBytes(74, 255, 138, 255)
      case 'fall': return Cesium.Color.fromBytes(255, 74, 74, 255)
      case 'weather': return Cesium.Color.fromBytes(74, 158, 255, 255)
      case 'custom': return Cesium.Color.fromBytes(255, 234, 74, 255)
      default: return Cesium.Color.WHITE
    }
  }
}

export const caseProfilesPlugin = new CaseProfilesPlugin()
