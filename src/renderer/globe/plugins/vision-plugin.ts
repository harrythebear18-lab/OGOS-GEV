/**
 * Qwen-VL / Ollama Vision Plugin — Scene-aware analysis.
 * Tier 4, Priority 13. From OGOS.
 *
 * Captures the current viewport, sends to Ollama vision model for analysis.
 * Streams response text. Can also chat with scene context.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'

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

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.status = { count: 0, status: 'loading' }

    // Check Ollama health
    try {
      const health = await this.ipc!.invoke('ai:health', {}) as { status: string; models?: string[] } | null
      this.ollamaHealthy = health?.status === 'ok'
      this.models = health?.models || []
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
    this.viewer = null
    this.ipc = null
    this.messages = []
    this.streaming = false
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
      { type: 'input', id: 'prompt', label: 'Prompt', value: this.prompt, placeholder: 'Describe what to analyze...' },
      { type: 'button', id: 'analyzeViewport', label: 'Analyze Viewport', variant: 'primary', disabled: !this.ollamaHealthy || this.streaming },
      { type: 'button', id: 'chat', label: 'Chat (text only)', variant: 'default', disabled: !this.ollamaHealthy || this.streaming },
      { type: 'button', id: 'clear', label: 'Clear Conversation', variant: 'danger', disabled: this.messages.length === 0 },
      { type: 'separator', id: 'sep1' },
      { type: 'display', id: 'messages', label: 'Messages', value: String(this.messages.length), color: '#a04aff' },
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
      await this.chat(this.prompt)
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
}

export const visionPlugin = new VisionPlugin()
