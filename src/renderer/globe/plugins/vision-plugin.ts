/**
 * AI Vision Plugin — Scene-aware analysis via unified AI bridge.
 *
 * Replaces the old fragmented approach:
 *   - No more double-call bug (was calling both ai:vision AND ai:chat)
 *   - No more fake tool use (pattern-matching English text)
 *   - Uses the AI bridge with native Ollama tool calling
 *   - Streams responses via IPC events
 *   - Shares scene context through the bridge
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
import { createActionRunner, type ActionRunner } from '../analyst/action-runner'
import { pluginManager } from './plugin-manager'
import type { LiveFeature, LiveUpdate } from '@shared/types'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  image?: string
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
  private sessionId: string | null = null
  private streamUnsub: (() => void) | null = null
  private currentStreamText: string = ''

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
        const viewRadiusKm = Math.max(50, height / 1000 * 0.8)
        return {
          center: { lng: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) },
          viewRadiusKm,
        }
      },
    })

    // Register action-runner tools with the AI bridge
    if (this.actionRunner) {
      const tools = this.actionRunner.getTools()
      await this.ipc!.ai.registerTools(tools)
    }

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

    // Subscribe to AI stream events
    this.streamUnsub = this.ipc!.ai.onStream((data) => {
      if (data.sessionId !== this.sessionId) return
      switch (data.type) {
        case 'token':
          this.currentStreamText += data.token || ''
          break
        case 'tool_call':
          // Tool is being executed by the bridge — no action needed here
          break
        case 'tool_request':
          // Execute the tool call from the renderer side
          this.executeToolRequest(data.callId!, data.toolName!, data.args as Record<string, unknown>)
          break
        case 'tool_result':
          break
        case 'done':
          this.streaming = false
          if (this.currentStreamText) {
            this.messages.push({ role: 'assistant', content: this.currentStreamText })
          }
          this.status = { count: this.messages.length, status: 'nominal' }
          break
        case 'error':
          this.streaming = false
          this.status = { ...this.status, status: 'error', error: data.error }
          break
      }
    })

    // Create AI session
    try {
      const result = await this.ipc!.ai.createSession() as { sessionId: string; model: string; visionModel: string } | null
      this.sessionId = result?.sessionId || null
    } catch {
      this.sessionId = null
    }

    // Check Ollama health
    try {
      const health = await this.ipc!.ai.health() as { running: boolean; models: { name: string; capabilities: string[] }[] } | null
      this.ollamaHealthy = health?.running === true
      this.models = (health?.models || []).map((m) => m.name)
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
    this.streamUnsub?.()
    if (this.sessionId) this.ipc?.ai.destroySession(this.sessionId)
    this.liveUnsub = null
    this.streamUnsub = null
    this.viewer = null
    this.ipc = null
    this.messages = []
    this.streaming = false
    this.actionRunner = null
    this.liveFeatures.clear()
    this.sessionId = null
    this.currentStreamText = ''
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
   * Single call to the AI bridge — no double-call bug.
   */
  async analyzeViewport(prompt: string): Promise<string> {
    if (!this.ipc || !this.ollamaHealthy || !this.viewer || !this.activeModel) {
      return 'Ollama not available'
    }

    this.streaming = true
    this.currentStreamText = ''
    this.status = { ...this.status, status: 'loading' }

    try {
      const canvas = this.viewer.canvas
      const dataUrl = canvas.toDataURL('image/png')

      this.messages.push({ role: 'user', content: prompt, image: dataUrl })

      // Use the bridge's chat with image — single call, no double
      const result = await this.ipc.ai.chat(
        this.sessionId!,
        prompt,
        { image: dataUrl, model: this.activeModel }
      ) as { content: string; error?: string } | null

      const responseText = result?.content || result?.error || 'No response'
      if (this.currentStreamText) {
        // Streaming already added the message on 'done'
      } else {
        this.messages.push({ role: 'assistant', content: responseText })
      }
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
   * Chat with native tool use via the AI bridge.
   * Tools are passed to Ollama's tool-calling API — no fake pattern matching.
   */
  async chatWithTools(text: string): Promise<string> {
    if (!this.ipc || !this.ollamaHealthy || !this.activeModel || !this.sessionId) {
      return 'Ollama not available'
    }

    this.streaming = true
    this.currentStreamText = ''
    this.status = { ...this.status, status: 'loading' }

    try {
      this.messages.push({ role: 'user', content: text })

      const result = await this.ipc.ai.chat(
        this.sessionId,
        text,
        { model: this.activeModel }
      ) as { content: string; error?: string } | null

      const responseText = result?.content || result?.error || 'No response'
      if (!this.currentStreamText) {
        this.messages.push({ role: 'assistant', content: responseText })
      }
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
   * Execute a tool call from the AI bridge.
   * The bridge broadcasts a tool_request, and we execute it here in the
   * renderer where we have access to the Cesium viewer and action runner.
   */
  private async executeToolRequest(callId: string, toolName: string, args: Record<string, unknown>): Promise<void> {
    if (!this.actionRunner || !this.ipc) {
      this.ipc?.ai.rejectTool(callId, 'Action runner not available')
      return
    }

    try {
      const result = await this.actionRunner.run(toolName, args)
      this.ipc.ai.resolveTool(callId, result)
    } catch (err) {
      this.ipc.ai.rejectTool(callId, err instanceof Error ? err.message : String(err))
    }
  }

  clearConversation(): void {
    this.messages = []
    this.currentStreamText = ''
    this.status = { count: 0, status: 'nominal' }
  }

  /**
   * Query live data directly via the analyst engine.
   */
  async queryData(text: string): Promise<string> {
    if (!this.actionRunner) return 'Action runner not available'

    this.streaming = true
    this.status = { ...this.status, status: 'loading' }

    try {
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
}

export const visionPlugin = new VisionPlugin()
