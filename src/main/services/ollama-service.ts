/**
 * Ollama Service — local LLM reasoning layer.
 * Ported from OSINT-Global-OS. Connects to local Ollama (http://localhost:11434).
 * Supports chat, vision, embeddings, tool calling, and streaming.
 */

import os from 'os'

const OLLAMA_BASE = 'http://localhost:11434'

const _totalMemMB = Math.round(os.totalmem() / (1024 * 1024))
const _isMac = process.platform === 'darwin'
const _isLowMemMac = _isMac && _totalMemMB <= 16384
const NUM_CTX = _isLowMemMac ? 2048 : 4096
const KEEP_ALIVE = _isLowMemMac ? '2m' : '5m'

export interface OllamaModel {
  name: string
  size: number
  digest: string
  capabilities: string[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatOptions {
  model?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  stream?: boolean
  temperature?: number
  onToken?: (token: string) => void
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  model: string
  done: boolean
}

export const DEFAULT_MODELS = {
  reasoning: 'qwen2.5-coder:7b',
  vision: 'qwen2.5vl:7b',
  fallback: 'llama3.1:8b',
} as const

export async function checkHealth(): Promise<{ running: boolean; models: OllamaModel[] }> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`)
    if (!res.ok) return { running: false, models: [] }
    const data = (await res.json()) as { models: any[] }
    const models: OllamaModel[] = (data.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest,
      capabilities: m.details?.capabilities || [],
    }))
    return { running: true, models }
  } catch {
    return { running: false, models: [] }
  }
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const model = opts.model || DEFAULT_MODELS.reasoning
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    stream: opts.stream ?? false,
    options: {
      temperature: opts.temperature ?? 0.7,
      num_ctx: NUM_CTX,
    },
    keep_alive: KEEP_ALIVE,
  }
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools

  if (!opts.stream) {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama chat failed (${res.status}): ${text}`)
    }
    const data = await res.json()
    return {
      content: data.message?.content || '',
      toolCalls: data.message?.tool_calls || [],
      model: data.model || model,
      done: data.done ?? true,
    }
  }

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (!res.ok || !res.body) {
    const errText = res.ok ? 'no body' : await res.text().catch(() => 'unreadable')
    throw new Error(`Ollama streaming failed (${res.status}): ${errText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  const toolCalls: ToolCall[] = []
  let done = false
  let buffer = ''

  while (true) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line)
        if (chunk.message?.content) {
          content += chunk.message.content
          opts.onToken?.(chunk.message.content)
        }
        if (chunk.message?.tool_calls) toolCalls.push(...chunk.message.tool_calls)
        if (chunk.done) done = true
      } catch {
        // partial JSON
      }
    }
  }

  return { content, toolCalls, model, done }
}

export async function vision(imageBase64: string, prompt: string, model?: string): Promise<string> {
  const vModel = model || DEFAULT_MODELS.vision
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: vModel,
      messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
      stream: false,
      options: { temperature: 0.3, num_ctx: NUM_CTX },
      keep_alive: KEEP_ALIVE,
    }),
  })
  if (!res.ok) throw new Error(`Ollama vision failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.message?.content || ''
}

export async function embed(text: string, model?: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'llama3.1:8b', prompt: text }),
  })
  if (!res.ok) throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.embedding || []
}

/** SAR-specific tool definitions for the LLM. */
export const SAR_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'run_slope_analysis',
      description: 'Run slope analysis on the current search area. Returns slope bands and impassable terrain.',
      parameters: {
        type: 'object',
        properties: {
          activity_profile: {
            type: 'string',
            enum: ['hiking', 'scrambling', 'sar'],
            description: 'The activity profile to use for slope thresholds.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_search_zones',
      description: 'Compute probability-weighted search zones from the Last Known Point.',
      parameters: {
        type: 'object',
        properties: {
          radii: {
            type: 'array',
            items: { type: 'number' },
            description: 'Search radii in meters (e.g. [500, 1000, 3000, 5000]).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_rest_points',
      description: 'Find likely rest points based on terrain scoring (slope, water, shelter, distance).',
      parameters: {
        type: 'object',
        properties: {
          max_hours: { type: 'number', description: 'Maximum hours since last seen.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_route',
      description: "Plan a terrain-aware route between two points using A* with Tobler's hiking function.",
      parameters: {
        type: 'object',
        properties: {
          preference: {
            type: 'string',
            enum: ['least-effort', 'peak-ridge', 'valley-contour'],
            description: 'Route preference.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_fall_risk',
      description: 'Identify fall risk zones along the current route or within the search area.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_anomaly',
      description: 'Detect terrain anomalies — depressions, prominences, caves, structures.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_runoff',
      description: 'Trace rainfall runoff: flow paths, pooling areas, flood risk zones.',
      parameters: {
        type: 'object',
        properties: { rainfall_mm: { type: 'number', description: 'Rainfall amount in mm.' } },
      },
    },
  },
]

export function buildSystemPrompt(context: Record<string, unknown>): string {
  const ctxStr = JSON.stringify(context, null, 2)
  return `You are an expert SAR (Search and Rescue) analyst embedded in a geospatial intelligence workstation.

You have access to terrain analysis tools. Call them when the user asks for analysis.
Always explain your reasoning before calling tools. After tools return, summarize the findings.

Current scene context:
${ctxStr}

Available tools: slope analysis, search zones, rest points, route planning, fall risk, anomaly detection, runoff analysis.

Be concise, tactical, and safety-focused. When you call a tool, wait for the result before continuing.`
}
