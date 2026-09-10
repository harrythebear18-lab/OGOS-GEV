/**
 * Web Search Plugin — Intelligence augmentation.
 * Tier 4, Priority 14. From OGOS.
 *
 * Aggregates DuckDuckGo, Wikipedia, NWS alerts, Nominatim reverse geocoding.
 * Results displayed in a side panel (not on globe — this is a context plugin).
 */

import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: 'duckduckgo' | 'wikipedia' | 'nws' | 'nominatim'
}

interface NwsAlert {
  id: string
  event: string
  headline: string
  description: string
  area: string
  severity: 'minor' | 'moderate' | 'severe' | 'extreme'
  lon?: number
  lat?: number
}

export class WebSearchPlugin implements EarthEnginePlugin {
  id = 'web-search'
  name = 'Web Search (Intel Augmentation)'
  category = 'ai' as const

  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private results: SearchResult[] = []
  private alerts: NwsAlert[] = []
  private query: string = ''

  async register(ctx: PluginContext): Promise<void> {
    this.ipc = ctx.ipc
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    this.ipc = null
    this.results = []
    this.alerts = []
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'input', id: 'query', label: 'Search Query', value: this.query, placeholder: 'Search the web...' },
      { type: 'button', id: 'search', label: 'Search', variant: 'primary' },
      { type: 'button', id: 'alerts', label: 'Fetch NWS Alerts', variant: 'default' },
      { type: 'button', id: 'clear', label: 'Clear', variant: 'danger', disabled: this.results.length === 0 && this.alerts.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'results', label: 'Results', value: String(this.results.length), color: '#a04aff' },
      { type: 'display', id: 'alertsCount', label: 'NWS Alerts', value: String(this.alerts.length), color: '#ff8a4a' },
    ]
  }

  async onControl(id: string, value?: unknown): Promise<void> {
    if (id === 'query' && typeof value === 'string') {
      this.query = value
    } else if (id === 'search' && this.query) {
      await this.search(this.query)
    } else if (id === 'alerts') {
      await this.fetchAlerts()
    } else if (id === 'clear') {
      this.clearResults()
    }
  }

  getResults(): SearchResult[] {
    return this.results
  }

  getAlerts(): NwsAlert[] {
    return this.alerts
  }

  /**
   * Search the web for a text query.
   */
  async search(query: string): Promise<SearchResult[]> {
    if (!this.ipc) return []
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('ai:web-search', {
        query,
      }) as { results: SearchResult[] } | null

      if (!result?.results) {
        this.status = { count: 0, status: 'nominal' }
        return []
      }

      this.results = result.results
      this.status = { count: result.results.length, status: 'nominal' }
      return result.results
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      console.warn('[web-search] failed:', err)
      return []
    }
  }

  /**
   * Reverse geocode a coordinate — get place name.
   */
  async reverseGeocode(lon: number, lat: number): Promise<string | null> {
    if (!this.ipc) return null

    try {
      const result = await this.ipc.invoke('ai:web-search', {
        reverse: true,
        lon,
        lat,
      }) as { name: string } | null

      return result?.name || null
    } catch (err) {
      console.warn('[web-search] reverse geocode failed:', err)
      return null
    }
  }

  /**
   * Fetch NWS alerts for a region.
   */
  async fetchAlerts(lon?: number, lat?: number): Promise<NwsAlert[]> {
    if (!this.ipc) return []
    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('ai:web-search', {
        nws: true,
        lon,
        lat,
      }) as { alerts: NwsAlert[] } | null

      if (!result?.alerts) {
        this.status = { count: 0, status: 'nominal' }
        return []
      }

      this.alerts = result.alerts
      this.status = { count: result.alerts.length, status: 'nominal' }
      return result.alerts
    } catch (err) {
      this.status = { ...this.status, status: 'error', error: String(err) }
      console.warn('[web-search] NWS fetch failed:', err)
      return []
    }
  }

  clearResults(): void {
    this.results = []
    this.alerts = []
    this.status = { count: 0, status: 'nominal' }
  }
}

export const webSearchPlugin = new WebSearchPlugin()
