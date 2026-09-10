/* Grid monitor — main monitor that polls every 10s, runs verification layers,
 * and emits GridUpdate / GridAlert via IPC. Ported from OGOS gridMonitor.ts.
 * Adapted to OSINT Sentinel IPC contracts and shared types. */

import { EventEmitter } from 'events'
import { IPC } from '@shared/ipc'
import type { GridUpdate, GridAsset, GridAssetMeasurement, GridInterconnect } from '@shared/types'
import { broadcastToWindows } from '../../windows'
import {
  type InternalGridAsset,
  type AssetMeasurement,
  type AssetHealth,
  type CrossVerification,
  type DataFlowHealth,
  type GridStats,
  type TrafficDataPoint,
  type IntegrityUpdate,
  type IntegritySummary,
  type MonitorSettings,
  type InternalSeverity,
  DEFAULT_SETTINGS,
  mapSeverity,
} from './grid-data'
import { dataFetcher } from './data-fetcher'
import { assetVerifier } from './asset-verifier'
import { dataFlowMonitor } from './data-flow-monitor'
import { resultsVerifier } from './results-verifier'
import { heuristicWatchdog } from './heuristic-watchdog'
import { type WeatherEvent, generateWeatherGridAlerts } from './weather-grid-influence'

export interface GridMonitorUpdate {
  assets: InternalGridAsset[]
  measurements: Map<string, AssetMeasurement>
  interconnects: GridInterconnect[]
  stats: GridStats
  timestamp: number
  pendingFetches: number
}

export interface GridMonitorOptions {
  fetchIntervalMs?: number
}

const SEVERITY_ORDER: Record<InternalSeverity, number> = { info: 0, warning: 1, critical: 2 }

export class GridMonitor extends EventEmitter {
  private assets: InternalGridAsset[] = []
  private measurements = new Map<string, AssetMeasurement>()
  private interconnects: GridInterconnect[] = []
  private assetHealth = new Map<string, AssetHealth>()
  private crossVerifications: CrossVerification[] = []
  private dataFlowHealth: DataFlowHealth[] = []
  private stats: GridStats | null = null
  private trafficHistory: TrafficDataPoint[] = []
  private pendingFetches = 0
  private interval: NodeJS.Timeout | null = null
  private fetchIntervalMs: number
  private whitelist = new Set<string>()
  private knownAssetIds = new Set<string>()
  private newAssets: InternalGridAsset[] = []
  private settings: MonitorSettings = { ...DEFAULT_SETTINGS }
  private crossDomainEnabled = false
  private lastWeatherEvents: WeatherEvent[] = []

  constructor(options: GridMonitorOptions = {}) {
    super()
    this.fetchIntervalMs = options.fetchIntervalMs ?? this.settings.fetchIntervalMs
    this.settings.fetchIntervalMs = this.fetchIntervalMs
  }

  /* ─── Cross-domain influence ─── */

  setWeatherEvents(events: WeatherEvent[]): void {
    this.lastWeatherEvents = events
    if (this.crossDomainEnabled && events.length > 0 && this.assets.length > 0) {
      this.emitWeatherGridAlerts(events)
    }
  }

  setCrossDomainEnabled(enabled: boolean): void {
    this.crossDomainEnabled = enabled
    console.log(`[grid-monitor] cross-domain ${enabled ? 'enabled' : 'disabled'}`)
    if (enabled && this.lastWeatherEvents.length > 0 && this.assets.length > 0) {
      this.emitWeatherGridAlerts(this.lastWeatherEvents)
    }
  }

  isCrossDomainEnabled(): boolean {
    return this.crossDomainEnabled
  }

  private emitWeatherGridAlerts(events: WeatherEvent[]): void {
    const wxAlerts = generateWeatherGridAlerts(events, this.assets, this.measurements)
    const threshold = SEVERITY_ORDER[this.settings.alertSeverityThreshold] ?? 0
    for (const alert of wxAlerts) {
      if (this.whitelist.has(alert.assetId)) continue
      if ((SEVERITY_ORDER[alert.severity] ?? 0) < threshold) continue
      this.emit('alert', alert)
      broadcastToWindows(IPC.GRID_ALERT, { ...alert, severity: mapSeverity(alert.severity) })
    }
  }

  /* ─── Lifecycle ─── */

  start(): void {
    console.log('[grid-monitor] start()')
    this.fetchOnce()
    this.interval = setInterval(() => this.fetchOnce(), this.fetchIntervalMs)
  }

  stop(): void {
    console.log('[grid-monitor] stop()')
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async fetchOnce(): Promise<void> {
    this.pendingFetches++
    this.emit('pendingFetches', this.pendingFetches)

    try {
      const result = await dataFetcher.fetchAll()
      this.pendingFetches = Math.max(0, this.pendingFetches - 1)

      this.assets = result.assets
      this.measurements = result.measurements
      this.interconnects = result.interconnects

      // Detect new assets
      const fresh = result.assets.filter((a) => !this.knownAssetIds.has(a.id))
      if (fresh.length > 0) {
        this.newAssets = [...this.newAssets, ...fresh].slice(-200)
        for (const a of fresh) this.knownAssetIds.add(a.id)
      }
      for (const a of result.assets) this.knownAssetIds.add(a.id)
      if (this.knownAssetIds.size > 500) {
        const keep = new Set(result.assets.map((a) => a.id))
        for (const id of this.knownAssetIds) {
          if (!keep.has(id)) this.knownAssetIds.delete(id)
        }
      }

      // Run verification layers
      this.assetHealth = this.runAssetVerification(result.assets, result.measurements)
      this.dataFlowHealth = dataFlowMonitor.monitor(result.dataFlowHealth)
      this.crossVerifications = this.runResultsVerification(result.assets, result.measurements)
      this.stats = this.computeStats(result.assets, result.measurements, this.assetHealth, this.crossVerifications)
      this.pushTrafficPoint(this.stats)

      // Build internal update and emit
      const update: GridMonitorUpdate = {
        assets: this.assets,
        measurements: this.measurements,
        interconnects: this.interconnects,
        stats: this.stats,
        timestamp: Date.now(),
        pendingFetches: this.pendingFetches,
      }
      this.emit('gridUpdate', update)

      // Broadcast GridUpdate via IPC
      const ipcUpdate: GridUpdate = {
        assets: this.assets as GridAsset[],
        measurements: Array.from(this.measurements.values()) as GridAssetMeasurement[],
        interconnects: this.interconnects,
        timestamp: Date.now(),
      }
      broadcastToWindows(IPC.GRID_UPDATE, ipcUpdate)

      // Build and broadcast integrity update
      const integrity = this.buildIntegrityUpdate()
      this.emit('integrityUpdate', integrity)
      broadcastToWindows(IPC.GRID_INTEGRITY, integrity)

      // Broadcast traffic point
      const trafficPoint = this.trafficHistory[this.trafficHistory.length - 1]
      if (trafficPoint) {
        this.emit('trafficUpdate', trafficPoint)
        broadcastToWindows(IPC.GRID_TRAFFIC, trafficPoint)
      }

      // Generate and broadcast alerts
      const alerts = heuristicWatchdog.generateAlerts(this.assets, this.measurements, this.crossVerifications, this.assetHealth)
      const threshold = SEVERITY_ORDER[this.settings.alertSeverityThreshold] ?? 0
      for (const alert of alerts) {
        if (this.whitelist.has(alert.assetId)) continue
        if ((SEVERITY_ORDER[alert.severity] ?? 0) < threshold) continue
        this.emit('alert', alert)
        broadcastToWindows(IPC.GRID_ALERT, { ...alert, severity: mapSeverity(alert.severity) })
      }

      console.log(`[grid-monitor] fetch complete: ${this.assets.length} assets, ${alerts.length} alerts`)
    } catch (err) {
      this.pendingFetches = Math.max(0, this.pendingFetches - 1)
      console.error('[grid-monitor] fetch error:', err)
      this.emit('error', err)
    } finally {
      this.emit('pendingFetches', this.pendingFetches)
    }
  }

  /* ─── Verification runners ─── */

  private runAssetVerification(assets: InternalGridAsset[], measurements: Map<string, AssetMeasurement>): Map<string, AssetHealth> {
    const now = Date.now()
    const health = new Map<string, AssetHealth>()
    for (const asset of assets) {
      const h = assetVerifier.verify(asset, measurements.get(asset.id), now)
      health.set(asset.id, h)
    }
    return health
  }

  private runResultsVerification(assets: InternalGridAsset[], measurements: Map<string, AssetMeasurement>): CrossVerification[] {
    return assets.map((asset) => resultsVerifier.verify(asset, measurements.get(asset.id), assets, measurements))
  }

  /* ─── Stats ─── */

  private computeStats(
    assets: InternalGridAsset[],
    measurements: Map<string, AssetMeasurement>,
    health: Map<string, AssetHealth>,
    verifications: CrossVerification[],
  ): GridStats {
    const active = assets.filter((a) => a.active && !a.invalidated).length
    const totalLoad = Array.from(measurements.values()).reduce((sum, m) => sum + (m.loadMw ?? 0), 0)
    const avgUtil = assets.length > 0
      ? Array.from(measurements.values()).reduce((sum, m) => sum + (m.utilizationPercent ?? 0), 0) / assets.length
      : 0
    const warning = verifications.filter((v) => v.status === 'warning').length
    const failed = verifications.filter((v) => v.status === 'failed').length

    return {
      totalAssets: assets.length,
      activeAssets: active,
      powerPlants: assets.filter((a) => a.type === 'power_plant').length,
      substations: assets.filter((a) => a.type === 'substation').length,
      transformers: assets.filter((a) => a.type === 'transformer').length,
      renewableFarms: assets.filter((a) => a.type === 'renewable_farm').length,
      batteryStorages: assets.filter((a) => a.type === 'battery_storage').length,
      dataCenters: assets.filter((a) => a.type === 'data_center').length,
      aiCenters: assets.filter((a) => a.type === 'ai_center').length,
      edgeNodes: assets.filter((a) => a.type === 'edge_node').length,
      totalGenerationMw: Array.from(measurements.values()).reduce((sum, m) => sum + (m.generationMw ?? 0), 0),
      totalLoadMw: totalLoad,
      avgUtilization: avgUtil,
      anomalies: warning + failed,
      dataFreshness: Date.now(),
      totalCapacityMw: assets.reduce((sum, a) => sum + (a.capacityMw ?? 0), 0),
    }
  }

  private pushTrafficPoint(stats: GridStats): void {
    const verified = this.crossVerifications.filter((v) => v.status === 'verified').length
    const warning = this.crossVerifications.filter((v) => v.status === 'warning').length
    const failed = this.crossVerifications.filter((v) => v.status === 'failed').length
    this.trafficHistory.push({
      timestamp: Date.now(),
      totalAssets: stats.totalAssets,
      activeAssets: stats.activeAssets,
      newMeasurements: this.measurements.size,
      avgUtilization: stats.avgUtilization,
      totalLoadMw: stats.totalLoadMw,
      integrityScore: stats.avgUtilization,
      assetsVerified: verified,
      assetsFlagged: warning + failed,
    })
    if (this.trafficHistory.length > 60) this.trafficHistory.shift()
  }

  private buildIntegrityUpdate(): IntegrityUpdate {
    const assetHealthEntries: [string, AssetHealth][] = Array.from(this.assetHealth.entries())
    const verified = this.crossVerifications.filter((v) => v.status === 'verified').length
    const warning = this.crossVerifications.filter((v) => v.status === 'warning').length
    const failed = this.crossVerifications.filter((v) => v.status === 'failed').length
    const activePipelines = this.dataFlowHealth.filter((d) => d.status === 'verified').length
    const degradedPipelines = this.dataFlowHealth.filter((d) => d.status !== 'verified').length
    const avgIntegrity = this.assets.length > 0
      ? Array.from(this.assetHealth.values()).reduce((sum, h) => sum + h.integrityScore, 0) / this.assets.length
      : 0

    const summary: IntegritySummary = {
      overallScore: avgIntegrity,
      sensorLayerScore: avgIntegrity,
      dataFlowLayerScore: this.dataFlowHealth.length > 0
        ? this.dataFlowHealth.reduce((sum, d) => sum + d.pipelineScore, 0) / this.dataFlowHealth.length
        : 0,
      resultsLayerScore: this.crossVerifications.length > 0
        ? this.crossVerifications.reduce((sum, v) => sum + v.verificationScore, 0) / this.crossVerifications.length
        : 0,
      totalAssetsMonitored: this.assets.length,
      assetsVerified: verified,
      assetsWarning: warning,
      assetsFailed: failed,
      dataPointsVerified: this.measurements.size,
      pipelinesActive: activePipelines,
      pipelinesDegraded: degradedPipelines,
      crossSourceMatches: this.crossVerifications.reduce((sum, v) => sum + v.crossSourceAgreement.filter((c) => c.agreement).length, 0),
      crossSourceMismatches: this.crossVerifications.reduce((sum, v) => sum + v.crossSourceAgreement.filter((c) => !c.agreement).length, 0),
      totalFlags: this.crossVerifications.reduce((sum, v) => sum + v.flags.length, 0),
      criticalFlags: this.crossVerifications.reduce((sum, v) => sum + v.flags.filter((f) => f.severity === 'critical').length, 0),
      warningFlags: this.crossVerifications.reduce((sum, v) => sum + v.flags.filter((f) => f.severity === 'warning').length, 0),
      resultsValidated: verified,
      resultsFlagged: warning + failed,
    }

    return {
      assetHealth: assetHealthEntries,
      dataFlowHealth: this.dataFlowHealth,
      crossVerifications: this.crossVerifications,
      summary,
      timestamp: Date.now(),
      newAssets: this.newAssets,
    }
  }

  /* ─── Whitelist / snooze / settings ─── */

  whitelistAsset(assetId: string): void {
    this.whitelist.add(assetId)
  }

  unwhitelistAsset(assetId: string): void {
    this.whitelist.delete(assetId)
  }

  getWhitelist(): string[] {
    return Array.from(this.whitelist)
  }

  snoozeAlerts(minutes: number): void {
    heuristicWatchdog.setSnooze(minutes)
  }

  isSnoozed(): boolean {
    return heuristicWatchdog.isSnoozed()
  }

  getAssets(): InternalGridAsset[] {
    return this.assets
  }

  getMeasurements(): Map<string, AssetMeasurement> {
    return this.measurements
  }

  getSettings(): MonitorSettings {
    return { ...this.settings }
  }

  updateSettings(partial: Partial<MonitorSettings>): void {
    const oldInterval = this.fetchIntervalMs
    this.settings = { ...this.settings, ...partial }
    if (partial.fetchIntervalMs !== undefined && partial.fetchIntervalMs !== oldInterval) {
      this.fetchIntervalMs = partial.fetchIntervalMs
      if (this.interval) {
        clearInterval(this.interval)
        this.interval = setInterval(() => this.fetchOnce(), this.fetchIntervalMs)
      }
    }
    this.emit('settingsUpdate', this.getSettings())
    broadcastToWindows(IPC.GRID_SETTINGS, this.getSettings())
  }
}

export const gridMonitor = new GridMonitor()
