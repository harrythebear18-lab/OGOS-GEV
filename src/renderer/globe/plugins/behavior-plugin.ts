/**
 * Behavior Engine Plugin — Multi-agent terrain simulation.
 * Tier 2, Priority 7. UEBS2-style agents with A*, hazards, fatigue.
 *
 * Runs simulation in main process, streams agent positions to renderer.
 * Renders agents as Cesium billboards/points with trails.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'

interface Agent {
  id: string
  lon: number
  lat: number
  heading: number
  speed: number
  fatigue: number
  state: 'moving' | 'resting' | 'searching' | 'halted'
  trail: number[][] // [lon, lat] history
}

interface BehaviorConfig {
  agentCount: number
  startLon: number
  startLat: number
  targetLon: number
  targetLat: number
  perception: number
  maxSpeed: number
  fatigueRate: number
}

export class BehaviorEnginePlugin implements EarthEnginePlugin {
  id = 'behavior-engine'
  name = 'Behavior Engine (Multi-Agent)'
  category = 'analysis' as const

  private viewer: Cesium.Viewer | null = null
  private dataSource: Cesium.CustomDataSource | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private agents = new Map<string, Agent>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private config: BehaviorConfig | null = null

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.dataSource = new Cesium.CustomDataSource('behavior-engine')
    ctx.viewer.dataSources.add(this.dataSource)
    this.status = { count: 0, status: 'nominal' }
  }

  unregister(): void {
    this.stop()
    if (this.dataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.dataSource = null
    this.agents.clear()
    this.viewer = null
    this.ipc = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {
    // Simulation runs on its own poll, not viewport-driven
  }

  getStats(): PluginStats {
    return this.status
  }

  isRunning(): boolean {
    return this.running
  }

  async start(config: BehaviorConfig): Promise<void> {
    if (!this.ipc || this.running) return
    this.config = config
    this.running = true
    this.status = { count: 0, status: 'loading' }

    try {
      await this.ipc.invoke('terrain:behavior:engine', {
        action: 'start',
        config,
      })

      // Poll for agent updates at 10Hz
      this.pollTimer = setInterval(() => this.pollAgents(), 100)
      this.status = { count: config.agentCount, status: 'nominal' }
    } catch (err) {
      this.running = false
      this.status = { count: 0, status: 'error', error: String(err) }
      console.warn('[behavior-engine] start failed:', err)
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.ipc && this.running) {
      this.ipc.invoke('terrain:behavior:engine', { action: 'stop' }).catch(() => {})
    }
    this.running = false
    this.status = { count: 0, status: 'nominal' }
  }

  private async pollAgents(): Promise<void> {
    if (!this.ipc || !this.dataSource || !this.running) return

    try {
      const result = await this.ipc.invoke('terrain:behavior:engine', {
        action: 'poll',
      }) as { agents: Agent[] } | null

      if (!result?.agents) return

      // Delta update entities
      for (const agent of result.agents) {
        this.updateAgentEntity(agent)
      }

      this.status = { count: result.agents.length, status: 'nominal' }
    } catch (err) {
      this.status = { ...this.status, status: 'stale' }
      console.warn('[behavior-engine] poll failed:', err)
    }
  }

  private updateAgentEntity(agent: Agent): void {
    if (!this.dataSource) return

    const existing = this.agents.get(agent.id)
    const position = Cesium.Cartesian3.fromDegrees(agent.lon, agent.lat)

    if (!existing) {
      // New agent
      this.agents.set(agent.id, agent)
      this.dataSource.entities.add({
        id: `agent:${agent.id}`,
        position: new Cesium.ConstantPositionProperty(position),
        point: {
          pixelSize: 6,
          color: this.agentColor(agent.state),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        polyline: agent.trail.length > 1 ? {
          positions: new Cesium.ConstantProperty(
            agent.trail.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
          ),
          width: 1,
          material: new Cesium.ColorMaterialProperty(this.agentColor(agent.state).withAlpha(0.4)),
          clampToGround: true,
        } : undefined,
        properties: {
          heading: agent.heading,
          speed: agent.speed,
          fatigue: agent.fatigue,
          state: agent.state,
        },
      } as any)
    } else {
      // Update existing
      this.agents.set(agent.id, agent)
      const entity = this.dataSource.entities.getById(`agent:${agent.id}`)
      if (entity) {
        (entity.position as Cesium.ConstantPositionProperty).setValue(position)
        // Update trail if present
        if (agent.trail.length > 1 && entity.polyline) {
          (entity.polyline.positions as Cesium.ConstantProperty).setValue(
            agent.trail.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
          )
        }
        // Update properties
        if (entity.properties) {
          entity.properties.heading = agent.heading
          entity.properties.speed = agent.speed
          entity.properties.fatigue = agent.fatigue
          entity.properties.state = agent.state
        }
      }
    }
  }

  private agentColor(state: string): Cesium.Color {
    switch (state) {
      case 'moving': return Cesium.Color.fromBytes(74, 158, 255, 255)
      case 'searching': return Cesium.Color.fromBytes(255, 234, 74, 255)
      case 'resting': return Cesium.Color.fromBytes(138, 138, 138, 255)
      case 'halted': return Cesium.Color.fromBytes(255, 74, 74, 255)
      default: return Cesium.Color.WHITE
    }
  }
}

export const behaviorEnginePlugin = new BehaviorEnginePlugin()
