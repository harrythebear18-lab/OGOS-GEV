/**
 * Plugin Architecture — adapted from GEV's DataLayerManager pattern.
 *
 * Each module is a self-contained plugin with a standard interface:
 * - register(viewer, sceneContext, ipc) — attach to globe
 * - unregister() — detach cleanly
 * - update(sceneContext) — react to scene changes
 * - getStats() — health/status for UI
 *
 * Plugins own their own UI panels (collapsible, toggleable).
 * The plugin manager handles lifecycle, ordering, and shared state.
 */

import * as Cesium from 'cesium'

export interface PluginContext {
  viewer: Cesium.Viewer
  sceneContext: unknown
  ipc: typeof window.api
}

export interface PluginStats {
  count: number
  status: 'nominal' | 'loading' | 'degraded' | 'stale' | 'error' | 'disabled'
  error?: string
}

export interface EarthEnginePlugin {
  /** Unique plugin ID */
  id: string
  /** Human-readable name */
  name: string
  /** Category for UI grouping */
  category: 'globe' | 'analysis' | 'live' | 'ai' | 'export' | 'vr'
  /** Attach to globe — called once when plugin is enabled */
  register(ctx: PluginContext): void
  /** Detach cleanly — called when plugin is disabled or app closes */
  unregister(): void
  /** React to scene context changes (camera move, layer change, etc.) */
  update?(ctx: PluginContext): void
  /** Health/status for UI */
  getStats?(): PluginStats
}

class PluginManager {
  private plugins = new Map<string, EarthEnginePlugin>()
  private activePlugins = new Set<string>()
  private ctx: PluginContext | null = null

  /** Register a plugin definition (doesn't activate it) */
  register(plugins: EarthEnginePlugin | EarthEnginePlugin[]): void {
    const arr = Array.isArray(plugins) ? plugins : [plugins]
    for (const p of arr) {
      this.plugins.set(p.id, p)
    }
  }

  /** Set the shared context (viewer + scene + ipc) */
  setContext(ctx: PluginContext): void {
    this.ctx = ctx
  }

  /** Activate a plugin by ID */
  async activate(id: string): Promise<boolean> {
    if (!this.ctx) return false
    const plugin = this.plugins.get(id)
    if (!plugin || this.activePlugins.has(id)) return false
    try {
      plugin.register(this.ctx)
      this.activePlugins.add(id)
      console.log(`[plugins] activated: ${id}`)
      return true
    } catch (err) {
      console.error(`[plugins] failed to activate ${id}:`, err)
      return false
    }
  }

  /** Deactivate a plugin by ID */
  deactivate(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin || !this.activePlugins.has(id)) return
    try {
      plugin.unregister()
      this.activePlugins.delete(id)
      console.log(`[plugins] deactivated: ${id}`)
    } catch (err) {
      console.error(`[plugins] failed to deactivate ${id}:`, err)
    }
  }

  /** Toggle a plugin */
  toggle(id: string): void {
    if (this.activePlugins.has(id)) {
      this.deactivate(id)
    } else {
      this.activate(id)
    }
  }

  /** Check if a plugin is active */
  isActive(id: string): boolean {
    return this.activePlugins.has(id)
  }

  /** Get all registered plugin definitions */
  getPlugins(): EarthEnginePlugin[] {
    return [...this.plugins.values()]
  }

  /** Get active plugin IDs */
  getActive(): string[] {
    return [...this.activePlugins]
  }

  /** Get stats for a plugin */
  getStats(id: string): PluginStats | null {
    const plugin = this.plugins.get(id)
    if (!plugin || !this.activePlugins.has(id)) return null
    return plugin.getStats?.() ?? { count: 0, status: 'nominal' }
  }

  /** Broadcast scene context update to all active plugins */
  updateAll(ctx: PluginContext): void {
    for (const id of this.activePlugins) {
      const plugin = this.plugins.get(id)
      plugin?.update?.(ctx)
    }
  }

  /** Deactivate all plugins (on app close) */
  shutdown(): void {
    for (const id of [...this.activePlugins]) {
      this.deactivate(id)
    }
  }
}

export const pluginManager = new PluginManager()
