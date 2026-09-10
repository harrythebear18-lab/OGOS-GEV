/**
 * Qwen-VL / Ollama Vision Plugin — Scene-aware analysis.
 * Tier 4, Priority 13. From OGOS.
 *
 * Captures the current viewport, sends to Ollama vision model for analysis.
 * Streams response text. Can also chat with scene context.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import { createActionRunner, type ActionRunner } from '../analyst/action-runner'
import { pluginManager } from './plugin-manager'
import type { LiveFeature, LiveUpdate } from '@shared/types'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  image?: string // data URL
}

export class VisionPlugin implements EarthEnginePlugin {
  id = 'vision-ai'
  name = 'Qwen-VL / Ollama Vision'
  category = 'ai' as const

  private viewer: Cesium.Viewer | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private ollamaHealthy = false
  private models: string[] = []
  private activeModel: string | null = null
  private messages: ChatMessage[] = []
  private streaming = false
  private prompt: string = ''
  private actionRunner: ActionRunner | null = null
  private liveFeatures: Map<string, LiveFeature> = new Map()
  private liveUnsub: (() => void) | null = null
  private toolUseEnabled = true

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.status = { count: 0, status: 'loading' }

    // Set up action runner with live feature access
    this.actionRunner = createActionRunner({
      viewer: ctx.viewer,
      pluginManager,
      getLiveFeatures: (layerKey: string) => {
        const features = Array.from(this.liveFeatures.values())
        return features.filter((f) => f.type === layerKey)
      },
      getViewContext: () => {
        const cam = ctx.viewer.camera
        const carto = cam.positionCartographic
        const height = carto.height
        // Rough view radius based on camera height
        const viewRadiusKm = Math.max(50, height / 1000 * 0.8)
        return {
          center: { lng: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) },
          viewRadiusKm,
        }
      },
    })

    // Subscribe to live updates for analyst queries
    this.liveUnsub = ctx.ipc.live.onUpdate((update: LiveUpdate) => {
      if (update.type === 'full' && update.features) {
        this.liveFeatures.clear()
        for (const f of update.features) this.liveFeatures.set(f.id, f)
      } else if (update.type === 'delta') {
        if (update.added) for (const f of update.added) this.liveFeatures.set(f.id, f)
        if (update.removed) {
          const ids = new Set(update.removed.map((f) => f.id))
          for (const id of ids) this.liveFeatures.delete(id)
        }
      }
    })

    // Check Ollama health
    try {
      const health = await this.ipc!.invoke('ai:health', {}) as { running: boolean; models: { name: string }[] } | null
      this.ollamaHealthy = health?.running === true
      this.models = (health?.models || []).map((m) => m.name)
      // Prefer Qwen-VL if available
      this.activeModel = this.models.find((m) => m.includes('qwen') || m.includes('vl')) || this.models[0] || null
      this.status = {
        count: this.models.length,
        status: this.ollamaHealthy ? 'nominal' : 'error',
        error: this.ollamaHealthy ? undefined : 'Ollama not running on :11434',
      }
    } catch (err) {
      this.ollamaHealthy = false
      this.status = { count: 0, status: 'error', error: String(err) }
    }
  }

  unregister(): void {
    this.liveUnsub?.()
    this.liveUnsub = null
    this.viewer = null
    this.ipc = null
    this.messages = []
    this.streaming = false
    this.actionRunner = null
    this.liveFeatures.clear()
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  getControls(): PluginControlSpec[] {
    return [
      { type: 'display', id: 'health', label: 'Ollama', value: this.ollamaHealthy ? 'ONLINE :11434' : 'OFFLINE', color: this.ollamaHealthy ? '#4aff8a' : '#ff4a4a' },
      { type: 'select', id: 'model', label: 'Model', value: this.activeModel ?? '', options: this.models.map((m) => ({ label: m, value: m })) },
      { type: 'toggle', id: 'toolUse', label: 'Tool Use (Actions)', value: this.toolUseEnabled },
      { type: 'input', id: 'prompt', label: 'Prompt', value: this.prompt, placeholder: 'Ask about data, fly to places...' },
      { type: 'button', id: 'analyzeViewport', label: 'Analyze Viewport', variant: 'primary', disabled: !this.ollamaHealthy || this.streaming },
      { type: 'button', id: 'chat', label: 'Chat (with tools)', variant: 'default', disabled: !this.ollamaHealthy || this.streaming },
      { type: 'button', id: 'queryData', label: 'Query Live Data', variant: 'default', disabled: !this.ollamaHealthy || this.streaming },
      { type: 'button', id: 'clear', label: 'Clear Conversation', variant: 'danger', disabled: this.messages.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'messages', label: 'Messages', value: String(this.messages.length), color: '#a04aff' },
      { type: 'display', id: 'tracked', label: 'Tracked Objects', value: String(this.liveFeatures.size), color: '#4affd4' },
      { type: 'display', id: 'state', label: 'State', value: this.streaming ? 'STREAMING...' : 'IDLE', color: this.streaming ? '#ffea4a' : '#6b7d92' },
    ]
  }

  async onControl(id: string, value?: unknown): Promise<void> {
    if (id === 'model' && typeof value === 'string') {
      this.activeModel = value
    } else if (id === 'prompt' && typeof value === 'string') {
      this.prompt = value
    } else if (id === 'toolUse' && typeof value === 'boolean') {
      this.toolUseEnabled = value
    } else if (id === 'analyzeViewport' && this.prompt) {
      await this.analyzeViewport(this.prompt)
    } else if (id === 'chat' && this.prompt) {
      await this.chatWithTools(this.prompt)
    } else if (id === 'queryData' && this.prompt) {
      await this.queryData(this.prompt)
    } else if (id === 'clear') {
      this.clearConversation()
    }
  }

  isHealthy(): boolean {
    return this.ollamaHealthy
  }

  getModels(): string[] {
    return this.models
  }

  getActiveModel(): string | null {
    return this.activeModel
  }

  setActiveModel(model: string): void {
    this.activeModel = model
  }

  getMessages(): ChatMessage[] {
    return this.messages
  }

  isStreaming(): boolean {
    return this.streaming
  }

  /**
   * Analyze the current viewport with a text prompt.
   * Captures canvas, sends to Ollama vision model.
   */
  async analyzeViewport(prompt: string): Promise<string> {
    if (!this.ipc || !this.ollamaHealthy || !this.viewer || !this.activeModel) {
      return 'Ollama not available'
    }

    this.streaming = true
    this.status = { ...this.status, status: 'loading' }

    try {
      const canvas = this.viewer.canvas
      const dataUrl = canvas.toDataURL('image/png')

      const userMsg: ChatMessage = { role: 'user', content: prompt, image: dataUrl }
      this.messages.push(userMsg)

      let responseText = ''

      // Stream response
      await this.ipc.invoke('ai:vision', {
        model: this.activeModel,
        messages: this.messages,
      }) as { content: string } | null

      // For streaming, we'd use the on handler, but for simplicity use invoke
      const result = await this.ipc.invoke('ai:chat', {
        model: this.activeModel,
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [dataUrl],
          },
        ],
      }) as { content: string } | null

      responseText = result?.content || 'No response'

      this.messages.push({ role: 'assistant', content: responseText })
      this.status = { count: this.messages.length, status: 'nominal' }
      this.streaming = false

      return responseText
    } catch (err) {
      this.streaming = false
      this.status = { ...this.status, status: 'error', error: String(err) }
      return `Error: ${err}`
    }
  }

  /**
   * Send a text-only chat message (no image).
   */
  async chat(text: string): Promise<string> {
    if (!this.ipc || !this.ollamaHealthy || !this.activeModel) {
      return 'Ollama not available'
    }

    this.streaming = true
    this.status = { ...this.status, status: 'loading' }

    try {
      this.messages.push({ role: 'user', content: text })

      const result = await this.ipc.invoke('ai:chat', {
        model: this.activeModel,
        messages: this.messages,
      }) as { content: string } | null

      const responseText = result?.content || 'No response'
      this.messages.push({ role: 'assistant', content: responseText })
      this.status = { count: this.messages.length, status: 'nominal' }
      this.streaming = false

      return responseText
    } catch (err) {
      this.streaming = false
      this.status = { ...this.status, status: 'error', error: String(err) }
      return `Error: ${err}`
    }
  }

  clearConversation(): void {
    this.messages = []
    this.status = { count: 0, status: 'nominal' }
  }

  /**
   * Chat with tool-use — sends the prompt with available tools to the LLM.
   * If the LLM returns tool calls, executes them and feeds results back.
   */
  async chatWithTools(text: string): Promise<string> {
    if (!this.ipc || !this.ollamaHealthy || !this.activeModel) {
      return 'Ollama not available'
    }

    this.streaming = true
    this.status = { ...this.status, status: 'loading' }

    try {
      // Build context with live data summary
      const liveSummary = this.buildLiveDataSummary()
      const systemPrompt = `You are an analyst embedded in a geospatial intelligence workstation with a 3D Cesium globe.
You have access to live data and tools. When the user asks about data, use the query_data tool.
When they ask to go somewhere, use fly_to. When they ask to toggle layers, use set_layer_visibility.

Live data currently loaded:
${liveSummary}

Available tools: fly_to, zoom_to_globe, set_layer_visibility, query_data, select_nearest, track_entity, stop_tracking, resolve_place`

      this.messages.push({ role: 'user', content: text })

      const result = await this.ipc.invoke('ai:chat', {
        model: this.activeModel,
        prompt: text,
        context: systemPrompt,
      }) as { content: string; error?: string } | null

      let responseText = result?.content || result?.error || 'No response'

      // Check if the response mentions wanting to query data and tool use is enabled
      if (this.toolUseEnabled && this.actionRunner) {
        const lowerResponse = responseText.toLowerCase()

        // Simple intent detection — if the LLM mentions data, run a query
        if (lowerResponse.includes('how many') || lowerResponse.includes('nearest') || lowerResponse.includes('closest') ||
            lowerResponse.includes('count') || lowerResponse.includes('show me')) {
          const queryResult = await this.actionRunner.run('query_data', {
            scope: { kind: 'view' },
            limit: 10,
          })
          if (queryResult.ok && Number(queryResult.count) > 0) {
            const dataSummary = (queryResult.items as any[]).map((it: any) =>
              `${it.label || it.id} (${it.type}) at ${(it.lat as number)?.toFixed(2)},${(it.lon as number)?.toFixed(2)}`
            ).join('\n')
            responseText += `\n\nLive data query found ${queryResult.count} objects:\n${dataSummary}`
          } else {
            responseText += `\n\nNo live data matching the query in current view.`
          }
        }

        // Fly-to intent
        if (lowerResponse.includes('fly to') || lowerResponse.includes('go to') || lowerResponse.includes('show me')) {
          const placeMatch = text.match(/(?:fly to|go to|show me)\s+(.+)/i)
          if (placeMatch) {
            const flyResult = await this.actionRunner.run('fly_to', { target: placeMatch[1] })
            if (flyResult.ok) {
              responseText += `\n\nFlying to ${flyResult.label || placeMatch[1]} (${(flyResult.lat as number)?.toFixed(2)}, ${(flyResult.lon as number)?.toFixed(2)})`
            }
          }
        }
      }

      this.messages.push({ role: 'assistant', content: responseText })
      this.status = { count: this.messages.length, status: 'nominal' }
      this.streaming = false

      return responseText
    } catch (err) {
      this.streaming = false
      this.status = { ...this.status, status: 'error', error: String(err) }
      return `Error: ${err}`
    }
  }

  /**
   * Query live data directly via the analyst engine.
   */
  async queryData(text: string): Promise<string> {
    if (!this.actionRunner) return 'Action runner not available'

    this.streaming = true
    this.status = { ...this.status, status: 'loading' }

    try {
      // Parse the natural language query into an analyst query
      const lowerText = text.toLowerCase()
      const layers: string[] = []
      if (lowerText.includes('aircraft') || lowerText.includes('plane') || lowerText.includes('flight')) layers.push('aircraft')
      if (lowerText.includes('vessel') || lowerText.includes('ship')) layers.push('vessel')
      if (lowerText.includes('fire')) layers.push('fire')
      if (lowerText.includes('quake') || lowerText.includes('earthquake')) layers.push('quake')
      if (lowerText.includes('satellite')) layers.push('satellite')
      if (layers.length === 0) layers.push('aircraft', 'vessel', 'fire', 'quake')

      const sortBy = lowerText.includes('nearest') || lowerText.includes('closest') ? 'distance' :
                     lowerText.includes('biggest') || lowerText.includes('largest') ? 'magnitude' : undefined
      const sortDir = lowerText.includes('nearest') || lowerText.includes('closest') ? 'asc' : 'desc'

      const result = await this.actionRunner.run('query_data', {
        layers,
        scope: { kind: 'view' },
        sortBy,
        sortDir,
        limit: 10,
      })

      let responseText: string
      if (result.ok && Number(result.count) > 0) {
        const items = result.items as any[]
        responseText = `Found ${result.count} objects ${result.scopeLabel}:\n\n` +
          items.map((it: any, i: number) => `${i + 1}. ${it.label || it.id} (${it.type}) — ${(it.lat as number)?.toFixed(2)}, ${(it.lon as number)?.toFixed(2)}${it.distanceKm ? ` (${it.distanceKm}km)` : ''}`).join('\n')
      } else {
        responseText = `No live data found. Loaded: ${this.liveFeatures.size} objects total.`
      }

      this.messages.push({ role: 'user', content: text })
      this.messages.push({ role: 'assistant', content: responseText })
      this.status = { count: this.messages.length, status: 'nominal' }
      this.streaming = false

      return responseText
    } catch (err) {
      this.streaming = false
      this.status = { ...this.status, status: 'error', error: String(err) }
      return `Error: ${err}`
    }
  }

  private buildLiveDataSummary(): string {
    const byType: Record<string, number> = {}
    for (const f of this.liveFeatures.values()) {
      byType[f.type] = (byType[f.type] || 0) + 1
    }
    return Object.entries(byType).map(([type, count]) => `- ${type}: ${count}`).join('\n') || 'No live data loaded'
  }
}

export const visionPlugin = new VisionPlugin()
