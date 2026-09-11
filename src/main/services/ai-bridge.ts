/**
 * AI Bridge — unified AI comms layer between main and renderer.
 *
 * Replaces the fragmented pattern of:
 *   - ollama-service.ts (stateless HTTP)
 *   - vision-plugin.ts (own conversation, fake tool use)
 *   - action-runner.ts (tools defined but never sent to LLM)
 *
 * This bridge provides:
 *   1. Persistent conversation state (per session)
 *   2. Native Ollama tool calling (tools passed to the LLM, not faked)
 *   3. Streaming via IPC events (renderer gets tokens in real time)
 *   4. Shared scene context (from scene-context.ts)
 *   5. Tool execution relay (renderer executes globe actions, returns results)
 */

import { chat as ollamaChat, vision as ollamaVision, checkHealth as ollamaHealth,
  type ChatMessage, type ToolCall, type ToolDefinition, type ChatResult,
  DEFAULT_MODELS } from './ollama-service'
import { getSceneContext } from './scene-context'
import { webSearch, reverseGeocode } from './web-search-service'
import { IPC } from '@shared/ipc'
import { broadcastToWindows } from '../windows'

// ── Session management ──

export interface AISession {
  id: string
  messages: ChatMessage[]
  model: string
  visionModel: string
  createdAt: number
  streaming: boolean
  privacyMode?: boolean
}

const sessions = new Map<string, AISession>()

export function createSession(id?: string): AISession {
  const sessionId = id || `ai-${Date.now()}`
  const session: AISession = {
    id: sessionId,
    messages: [],
    model: DEFAULT_MODELS.reasoning,
    visionModel: DEFAULT_MODELS.vision,
    createdAt: Date.now(),
    streaming: false,
  }
  sessions.set(sessionId, session)
  return session
}

export function getSession(id: string): AISession | null {
  return sessions.get(id) || null
}

export function destroySession(id: string): void {
  sessions.delete(id)
}

// ── Tool registry ──
// Tools are registered by the renderer (action-runner) and stored here.
// When the LLM calls a tool, we broadcast a tool-request event to the
// renderer, which executes it and sends back the result.
//
// Some tools execute directly on the main process side (e.g. web_search)
// — those have a `mainHandler` and don't need a renderer round-trip.

interface ToolHandler {
  toolDef: ToolDefinition
  mainHandler?: (args: Record<string, unknown>) => Promise<unknown>
}

const toolRegistry = new Map<string, ToolHandler>()

export function registerTool(toolDef: ToolDefinition, mainHandler?: (args: Record<string, unknown>) => Promise<unknown>): void {
  toolRegistry.set(toolDef.function.name, { toolDef, mainHandler })
}

export function registerTools(toolDefs: ToolDefinition[]): void {
  for (const td of toolDefs) registerTool(td)
}

export function getRegisteredTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values()).map((t) => t.toolDef)
}

export function clearTools(): void {
  toolRegistry.clear()
}

// ── Built-in main-side tools ──
// These execute directly in the main process — no renderer round-trip.

const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the web for information about a place, event, topic, or current news. Use this to answer questions about what the user is looking at, recent events, geographic context, history, etc. Results include title, snippet, and URL.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific — include place names, coordinates, or topic keywords.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 5).',
        },
      },
      required: ['query'],
    },
  },
}

// Track current session's privacy mode so tool handlers can respect it
let currentPrivacyMode = false

export function getCurrentPrivacyMode(): boolean {
  return currentPrivacyMode
}

async function handleWebSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query || '')
  const limit = Number(args.limit) || 5
  if (!query) return { error: 'No query provided' }

  const ctx = getSceneContext()
  let location = ctx.bbox
    ? { lng: (ctx.bbox.west + ctx.bbox.east) / 2, lat: (ctx.bbox.south + ctx.bbox.north) / 2 }
    : ctx.lkp ?? ctx.camera?.center ?? undefined

  // Coarsen location if privacy mode is on
  if (currentPrivacyMode && location) {
    location = { lng: Math.round(location.lng), lat: Math.round(location.lat) }
  }

  const results = await webSearch({ query, limit }, location)
  return results
}

// Register built-in tools on module load
registerTool(WEB_SEARCH_TOOL, handleWebSearch)

// ── Pending tool calls ──
// When the LLM emits tool_calls, we store them here and broadcast to the
// renderer. The renderer executes each tool and calls resolveToolCall()
// with the result. We then feed the result back to the LLM.

interface PendingToolCall {
  sessionId: string
  callId: string
  toolName: string
  args: Record<string, unknown>
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

const pendingToolCalls = new Map<string, PendingToolCall>()

export function resolveToolCall(callId: string, result: unknown): void {
  const pending = pendingToolCalls.get(callId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingToolCalls.delete(callId)
  pending.resolve(result)
}

export function rejectToolCall(callId: string, error: string): void {
  const pending = pendingToolCalls.get(callId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingToolCalls.delete(callId)
  pending.reject(new Error(error))
}

// ── Streaming ──
// Stream tokens to the renderer via IPC events.

function streamToken(sessionId: string, token: string): void {
  broadcastToWindows(IPC.AI_CHAT_STREAM, { sessionId, type: 'token', token })
}

function streamToolCall(sessionId: string, toolName: string, args: Record<string, unknown>): void {
  broadcastToWindows(IPC.AI_CHAT_STREAM, { sessionId, type: 'tool_call', toolName, args })
}

function streamToolResult(sessionId: string, toolName: string, result: unknown): void {
  broadcastToWindows(IPC.AI_CHAT_STREAM, { sessionId, type: 'tool_result', toolName, result })
}

function streamDone(sessionId: string, content: string): void {
  broadcastToWindows(IPC.AI_CHAT_STREAM, { sessionId, type: 'done', content })
}

function streamError(sessionId: string, error: string): void {
  broadcastToWindows(IPC.AI_CHAT_STREAM, { sessionId, type: 'error', error })
}

// ── Chat with tools ──
// The core loop:
//   1. Build system prompt with scene context
//   2. Send messages + tools to Ollama (streaming)
//   3. If LLM returns tool_calls, broadcast to renderer, wait for results
//   4. Feed tool results back as 'tool' role messages
//   5. Re-send to LLM for final response
//   6. Stream the final response to renderer

export async function chatWithTools(
  sessionId: string,
  userMessage: string,
  options?: { image?: string; model?: string; mode?: 'active-sar' | 'legacy-research'; privacyMode?: boolean }
): Promise<{ content: string; error?: string }> {
  const session = getSession(sessionId)
  if (!session) return { content: '', error: 'Session not found' }

  if (session.streaming) {
    return { content: '', error: 'Session already streaming' }
  }

  session.streaming = true
  const mode = options?.mode || 'active-sar'
  const isActiveSAR = mode === 'active-sar'
  const privacy = options?.privacyMode ?? false
  session.privacyMode = privacy
  currentPrivacyMode = privacy

  try {
    // Build system prompt with current scene context (bbox-aware)
    const ctx = getSceneContext()
    const tools = getRegisteredTools()
    const toolNames = tools.map((t) => t.function.name).join(', ')

    // Build a human-readable location description from the bbox
    let locationDesc = 'Location: unknown'
    let bboxDesc = 'Viewport bbox: not available'
    let placeName: string | null = null

    if (ctx.bbox) {
      const b = ctx.bbox
      const centerLng = (b.west + b.east) / 2
      const centerLat = (b.south + b.north) / 2
      const widthDeg = b.east - b.west
      const heightDeg = b.north - b.south
      const approxKm = Math.max(widthDeg, heightDeg) * 111

      if (privacy) {
        // Privacy ON — coarsen coordinates to ~1 degree (~111km) and skip reverse geocode
        const coarseLat = Math.round(centerLat)
        const coarseLng = Math.round(centerLng)
        bboxDesc = `Viewport bbox: approx ${coarseLng - 1}° to ${coarseLng + 1}°, ${coarseLat - 1}° to ${coarseLat + 1}°`
        locationDesc = `Location: approx region near ${coarseLat}°, ${coarseLng}° (coarsened for privacy)`
        placeName = null
      } else {
        bboxDesc = `Viewport bbox: ${b.west.toFixed(3)}, ${b.south.toFixed(3)} to ${b.east.toFixed(3)}, ${b.north.toFixed(3)}
Viewport center: ${centerLng.toFixed(4)}, ${centerLat.toFixed(4)}
Viewport size: ~${widthDeg.toFixed(2)}° × ${heightDeg.toFixed(2)}° (~${approxKm.toFixed(0)} km)`

        // Try reverse geocode for a human-readable place name
        try {
          placeName = await reverseGeocode(centerLng, centerLat)
        } catch {
          placeName = null
        }

        locationDesc = placeName
          ? `Location: ${placeName} (center: ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)})`
          : `Location: center at ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}`
      }
    } else if (ctx.camera?.center) {
      if (privacy) {
        locationDesc = `Location: approx region (coarsened for privacy)`
      } else {
        locationDesc = `Location: camera at ${ctx.camera.center.lat.toFixed(4)}, ${ctx.camera.center.lng.toFixed(4)} (height: ${ctx.camera.height.toFixed(0)}m)`
      }
    }

    // Coarsen scene context JSON when privacy is on — strip exact coordinates
    let ctxStr: string
    if (privacy) {
      const coarsened = { ...ctx }
      if (coarsened.bbox) {
        const cLat = Math.round((coarsened.bbox.south + coarsened.bbox.north) / 2)
        const cLng = Math.round((coarsened.bbox.west + coarsened.bbox.east) / 2)
        coarsened.bbox = { west: cLng - 1, south: cLat - 1, east: cLng + 1, north: cLat + 1 }
      }
      if (coarsened.camera?.center) {
        coarsened.camera = {
          ...coarsened.camera,
          center: {
            lat: Math.round(coarsened.camera.center.lat),
            lng: Math.round(coarsened.camera.center.lng),
          },
        }
      }
      if (coarsened.lkp) {
        coarsened.lkp = {
          lat: Math.round(coarsened.lkp.lat),
          lng: Math.round(coarsened.lkp.lng),
        }
      }
      ctxStr = JSON.stringify(coarsened, null, 2)
    } else {
      ctxStr = JSON.stringify(ctx, null, 2)
    }

    // Mode-aware system prompt (ported from OGOS buildSystemPrompt)
    const modeHeader = isActiveSAR
      ? 'You are the AI analyst embedded in OSINT Sentinel Workstation, operating in ACTIVE SAR MODE. A real, time-critical search-and-rescue operation is underway.'
      : 'You are the AI analyst embedded in OSINT Sentinel Workstation, operating in LEGACY / RESEARCH MODE. This is a historical, cold-case, or exploratory terrain investigation.'

    const reasoningStyle = isActiveSAR
      ? `## ACTIVE SAR MODE — Reasoning Style
- The LKP is real and recent. Time since last seen is CRITICAL.
- Movement modelling matters. Use trip parameters aggressively.
- Hydrology, weather alerts, and hazard zones are CRITICAL safety factors.
- Search zones must be TIGHT and evidence-driven. Avoid wide-area speculation.
- The bounding box is NOT the primary frame — LKP -> corridor -> zones is.
- Be conservative. Prioritise safety-critical information.
- Avoid speculation. Use high-confidence reasoning only.
- Suggest immediate, actionable tools. Time matters.
- Generate SAR-style hypotheses: 2-3 tight zones, high confidence, clear evidence chains.
- Tool priority: run_search_zones -> run_rest_points -> run_fall_risk -> run_route.`
      : `## LEGACY / RESEARCH MODE — Reasoning Style
- The LKP may be approximate or estimated. Do NOT over-rely on it.
- Time since last seen is contextual, not critical.
- Movement modelling is optional. The bounding box is the PRIMARY frame.
- Weather is contextual, not critical. Use it for terrain understanding.
- Speculation is ALLOWED and encouraged — this is exploratory.
- Pull more external data. Multi-source search matters (web_search, vision, CLIP).
- Look for terrain anomalies, pattern analysis, and historical context.
- Use bbox-spread analysis instead of tight LKP corridors.
- Do NOT assume the person is alive or moving. Consider all scenarios.
- Generate exploratory hypotheses: 4-6 wide zones, alternative theories, lower confidence.
- Tool priority: run_anomaly -> analyze_satellite_image -> web_search -> run_slope_analysis.`

    const systemPrompt = `${modeHeader}

You have access to live data and tools. Call tools when the user asks for analysis, data queries, navigation, or information.
Always explain your reasoning briefly, then call the tool. After tools return, summarize the findings.

When the user asks about "this area" or "what am I looking at", use the viewport location below and web_search to find relevant information. Include the place name or coordinates in the query.

${locationDesc}
${placeName ? `Place name: ${placeName}` : ''}

${bboxDesc}

${reasoningStyle}
${privacy ? `
## PRIVACY MODE — STRICT RULES
The user has privacy mode enabled. You MUST follow these rules absolutely:
- NEVER say "your location", "you are near", "from your position", "the area you're looking at is close to", or any phrase that implies the user is at or near the viewport location.
- The user is LOCATIONLESS. The viewport is a region they are ANALYZING, not where they ARE.
- Refer to the viewport as "the selected region", "the analysis area", "this region", or "the area in view" — never as "your area" or "where you are".
- You may still answer questions about the region (weather, terrain, news, hazards) but must frame it as analysis of a place, not the user's location.
- Example CORRECT: "The selected region appears to be northeast Brazil. Current weather shows..."
- Example WRONG: "You are looking at northeast Brazil." or "Your location is near..."
- Do NOT infer or guess the user's actual location from the viewport, LKP, or camera position.
- If the user asks "where am I", respond that privacy mode is on and you cannot determine their location.
` : ''}
Full scene context:
${ctxStr}

Available tools: ${toolNames || 'none'}

Be concise, tactical, and direct. When you call a tool, wait for the result before continuing.`

    // Build messages array
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    // Add conversation history (skip the first system if we already have one)
    for (const msg of session.messages) {
      if (msg.role === 'system') continue
      messages.push(msg)
    }

    // Add the new user message (with image if provided)
    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      ...(options?.image ? { images: [options.image] } : {}),
    }
    messages.push(userMsg)
    session.messages.push(userMsg)

    const model = options?.model || session.model

    // Loop: LLM may call tools, we execute them, feed results back
    let maxRounds = 4 // prevent infinite tool loops
    let finalContent = ''

    while (maxRounds-- > 0) {
      const result: ChatResult = await ollamaChat({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
        onToken: (token) => streamToken(sessionId, token),
      })

      finalContent = result.content

      // If the LLM made tool calls, execute them
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Add assistant message with tool calls to conversation
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls,
        }
        messages.push(assistantMsg)
        session.messages.push(assistantMsg)

        // Execute each tool call
        for (const tc of result.toolCalls) {
          const toolName = tc.function.name
          const args = tc.function.arguments
          const callId = `${sessionId}-${toolName}-${Date.now()}`

          streamToolCall(sessionId, toolName, args)

          try {
            // Check if this tool has a main-side handler (e.g. web_search)
            const handler = toolRegistry.get(toolName)
            let toolResult: unknown

            if (handler?.mainHandler) {
              // Execute directly on main process — no renderer round-trip
              toolResult = await handler.mainHandler(args)
            } else {
              // Broadcast to renderer and wait for response
              toolResult = await new Promise<unknown>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  pendingToolCalls.delete(callId)
                  reject(new Error(`Tool '${toolName}' timed out after 30s`))
                }, 30_000)

                pendingToolCalls.set(callId, {
                  sessionId,
                  callId,
                  toolName,
                  args,
                  resolve,
                  reject,
                  timeout,
                })

                // Broadcast the tool request to the renderer
                broadcastToWindows(IPC.AI_CHAT_STREAM, {
                  sessionId,
                  type: 'tool_request',
                  callId,
                  toolName,
                  args,
                })
              })
            }

            streamToolResult(sessionId, toolName, toolResult)

            // Add tool result as a 'tool' role message
            const toolMsg: ChatMessage = {
              role: 'tool',
              content: JSON.stringify(toolResult),
            }
            messages.push(toolMsg)
            session.messages.push(toolMsg)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            streamError(sessionId, `Tool '${toolName}' failed: ${errMsg}`)

            const toolMsg: ChatMessage = {
              role: 'tool',
              content: JSON.stringify({ error: errMsg }),
            }
            messages.push(toolMsg)
            session.messages.push(toolMsg)
          }
        }

        // Continue the loop — LLM will get tool results and respond
        continue
      }

      // No tool calls — this is the final response
      break
    }

    // Add the final assistant response to conversation history
    const finalMsg: ChatMessage = { role: 'assistant', content: finalContent }
    session.messages.push(finalMsg)

    streamDone(sessionId, finalContent)

    session.streaming = false
    return { content: finalContent }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    streamError(sessionId, errMsg)
    session.streaming = false
    return { content: '', error: errMsg }
  }
}

// ── Vision (one-shot, no conversation) ──

export async function analyzeViewport(
  imageBase64: string,
  prompt: string,
  model?: string
): Promise<{ content: string; error?: string }> {
  try {
    const ctx = getSceneContext()
    const ctxStr = JSON.stringify(ctx, null, 2)
    const fullPrompt = `Scene context:\n${ctxStr}\n\nQuestion: ${prompt}`
    const text = await ollamaVision(imageBase64, fullPrompt, model)
    return { content: text }
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Health ──

export async function checkAIHealth(): Promise<{ running: boolean; models: { name: string; capabilities: string[] }[] }> {
  const health = await ollamaHealth()
  return {
    running: health.running,
    models: health.models.map((m) => ({ name: m.name, capabilities: m.capabilities })),
  }
}
