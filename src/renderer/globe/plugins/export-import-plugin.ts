/**
 * Export/Import Plugin — GeoJSON / KML / KMZ.
 * Tier 5, Priority 19. From OGOS.
 *
 * Exports current analysis results to file. Imports KML/KMZ projects.
 * Uses Electron save/open dialogs via IPC.
 */

import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface Exportable {
  type: string
  features: unknown[]
}

export class ExportImportPlugin implements EarthEnginePlugin {
  id = 'export-import'
  name = 'Export / Import (GeoJSON/KML)'
  category = 'export' as const

  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }

  async register(ctx: PluginContext): Promise<void> {
    this.ipc = ctx.ipc
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    this.ipc = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  async exportGeoJSON(data: Exportable): Promise<string | null> {
    if (!this.ipc) return null
    this.status = { ...this.status, status: 'loading' }
    try {
      const result = await this.ipc.invoke('export:geojson', data) as { path: string } | null
      this.status = { count: 1, status: 'nominal' }
      return result?.path || null
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      return null
    }
  }

  async exportKML(data: Exportable): Promise<string | null> {
    if (!this.ipc) return null
    this.status = { ...this.status, status: 'loading' }
    try {
      const result = await this.ipc.invoke('export:kml', data) as { path: string } | null
      this.status = { count: 1, status: 'nominal' }
      return result?.path || null
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      return null
    }
  }

  async importFile(): Promise<Exportable | null> {
    if (!this.ipc) return null
    this.status = { ...this.status, status: 'loading' }
    try {
      const result = await this.ipc.invoke('import:kml', {}) as Exportable | null
      this.status = { count: result?.features?.length || 0, status: 'nominal' }
      return result
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      return null
    }
  }
}

export const exportImportPlugin = new ExportImportPlugin()
