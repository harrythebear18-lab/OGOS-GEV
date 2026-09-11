import { useState, useEffect, useRef, useCallback } from 'react'
import * as Cesium from 'cesium'

interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  streaming?: boolean
  error?: boolean
}

interface HypothesisZone {
  id: string
  label: string
  confidence: number // 0-100
  coords: { lng: number; lat: number }[]
  reasons: string[]
}

interface Hypothesis {
  id: string
  title: string
  confidence: 'low' | 'moderate' | 'high' | 'critical'
  rationale: string
  suggestedZone?: string
  suggestedZones?: HypothesisZone[]
  createdAt: number
}

interface AiPanelProps {
  viewer: Cesium.Viewer | null
  onHypothesesChange?: (hypotheses: Hypothesis[]) => void
  privacyMode?: boolean
}

export default function AiPanel({ viewer, onHypothesesChange, privacyMode }: AiPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<{ running: boolean; models: { name: string; capabilities: string[] }[] } | null>(null)
  const [model, setModel] = useState<string>('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [activeTools, setActiveTools] = useState<{ name: string; args: unknown }[]>([])
  const [activeTab, setActiveTab] = useState<'chat' | 'hypotheses'>('chat')
  const [analysisMode, setAnalysisMode] = useState<'active-sar' | 'legacy-research'>('active-sar')
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])

  // Notify parent when hypotheses change (for explainability overlay)
  useEffect(() => {
    onHypothesesChange?.(hypotheses)
  }, [hypotheses, onHypothesesChange])
  const [genHypotheses, setGenHypotheses] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const streamUnsubRef = useRef<(() => void) | null>(null)
  const msgIdCounter = useRef(0)

  const nextId = () => `msg-${++msgIdCounter.current}`

  // Init: check health, create session, subscribe to stream
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const h = await window.api.ai.health() as { running: boolean; models: { name: string; capabilities: string[] }[] }
        if (cancelled) return
        setHealth(h)
        if (h.models.length > 0) {
          // Prefer qwen vision model, then any qwen, then first
          const preferred = h.models.find((m) => m.name.includes('vl')) ||
                            h.models.find((m) => m.name.includes('qwen')) ||
                            h.models[0]
          setModel(preferred.name)
        }

        // Create AI session
        const session = await window.api.ai.createSession() as { sessionId: string }
        if (cancelled) return
        setSessionId(session.sessionId)

        // Subscribe to stream events
        const unsub = window.api.ai.onStream((data) => {
          if (data.sessionId !== session.sessionId) return

          switch (data.type) {
            case 'token':
              setStreamingText((prev) => prev + (data.token || ''))
              break
            case 'tool_call':
              setActiveTools((prev) => [...prev, { name: data.toolName || 'unknown', args: data.args }])
              break
            case 'tool_result':
              setActiveTools((prev) => {
                const filtered = prev.filter((t) => t.name !== data.toolName)
                return filtered
              })
              // Add tool result as a message
              setMessages((prev) => [...prev, {
                id: nextId(),
                role: 'tool',
                content: '',
                toolName: data.toolName,
                toolResult: data.result,
              }])
              break
            case 'done':
              setStreamingText((prev) => {
                if (prev) {
                  setMessages((msgs) => [...msgs, {
                    id: nextId(),
                    role: 'assistant',
                    content: prev,
                  }])
                }
                return ''
              })
              setLoading(false)
              setActiveTools([])
              break
            case 'error':
              setStreamingText('')
              setLoading(false)
              setActiveTools([])
              setMessages((msgs) => [...msgs, {
                id: nextId(),
                role: 'assistant',
                content: data.error || 'Unknown error',
                error: true,
              }])
              break
          }
        })
        streamUnsubRef.current = unsub
      } catch (err) {
        console.error('[AiPanel] init failed:', err)
      }
    }

    init()

    return () => {
      cancelled = true
      streamUnsubRef.current?.()
      streamUnsubRef.current = null
      if (sessionId) window.api.ai.destroySession(sessionId)
    }
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingText, activeTools])

  const send = useCallback(async () => {
    if (!input.trim() || loading || !sessionId) return

    const userText = input.trim()
    setMessages((m) => [...m, { id: nextId(), role: 'user', content: userText }])
    setInput('')
    setLoading(true)
    setStreamingText('')

    try {
      const result = await window.api.ai.chat(sessionId, userText, { model: model || undefined, mode: analysisMode, privacyMode: privacyMode ?? true })
      // The stream handler will add the assistant message via 'done' event
      // But if streaming didn't produce tokens, add the result here
      if (result?.error) {
        setMessages((m) => [...m, { id: nextId(), role: 'assistant', content: result.error || 'Unknown error', error: true }])
        setLoading(false)
      }
    } catch (e) {
      setMessages((m) => [...m, { id: nextId(), role: 'assistant', content: `Error: ${e}`, error: true }])
      setLoading(false)
    }
  }, [input, loading, sessionId, model])

  const analyzeViewport = useCallback(async () => {
    if (!input.trim() || loading || !sessionId || !viewer) return

    const userText = input.trim()
    setMessages((m) => [...m, { id: nextId(), role: 'user', content: `📷 ${userText}` }])
    setInput('')
    setLoading(true)
    setStreamingText('')

    try {
      // Capture viewport as image
      const canvas = viewer.canvas as HTMLCanvasElement
      const dataUrl = canvas.toDataURL('image/png')

      const result = await window.api.ai.chat(sessionId, userText, { image: dataUrl, model: model || undefined, mode: analysisMode, privacyMode: privacyMode ?? true })
      if (result?.error) {
        setMessages((m) => [...m, { id: nextId(), role: 'assistant', content: result.error || 'Unknown error', error: true }])
        setLoading(false)
      }
    } catch (e) {
      setMessages((m) => [...m, { id: nextId(), role: 'assistant', content: `Error: ${e}`, error: true }])
      setLoading(false)
    }
  }, [input, loading, sessionId, model, viewer])

  const clearChat = useCallback(() => {
    setMessages([])
    setStreamingText('')
    setActiveTools([])
  }, [])

  const generateHypotheses = useCallback(async () => {
    if (!sessionId || genHypotheses) return
    setGenHypotheses(true)

    try {
      // Ask the AI to generate structured hypotheses about the current scene
      // Mode-aware: Active SAR = 2-3 tight zones, high confidence
      //             Legacy/Research = 4-6 wide zones, exploratory
      const countHint = analysisMode === 'active-sar' ? '2-3' : '4-6'
      const styleHint = analysisMode === 'active-sar'
        ? 'Generate TIGHT hypotheses with small zones (under 1km) and HIGH confidence. Be evidence-driven and conservative.'
        : 'Generate EXPLORATORY hypotheses with WIDE zones (1-5km) and alternative theories. Speculation is allowed. Consider that the person may not be alive or moving.'
      const prompt = `Generate ${countHint} search hypotheses about the current viewport. ${styleHint}

For each, provide:
- title: short title
- confidence: low|moderate|high|critical
- rationale: why this hypothesis
- suggestedZones: array of { label, confidence (0-100), coords: [{lng,lat},...], reasons: [string] }

Format as JSON array. Use approximate viewport coordinates for zone polygons.`
      const result = await window.api.ai.chat(sessionId, prompt, { model: model || undefined, mode: analysisMode, privacyMode: privacyMode ?? true }) as { response?: string; error?: string }

      if (result?.error) {
        console.warn('[AiPanel] hypothesis generation failed:', result.error)
      } else {
        // Try to parse JSON from the response
        const text = result?.response || ''
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as Array<{
              title?: string
              confidence?: string
              rationale?: string
              suggestedZone?: string
              suggestedZones?: Array<{
                label: string
                confidence: number
                coords: { lng: number; lat: number }[]
                reasons: string[]
              }>
            }>
            const newHyps: Hypothesis[] = parsed
              .filter((h) => h.title)
              .map((h, i) => ({
                id: `hyp-${Date.now()}-${i}`,
                title: h.title!,
                confidence: (['low', 'moderate', 'high', 'critical'].includes(h.confidence ?? '')
                  ? h.confidence! : 'moderate') as Hypothesis['confidence'],
                rationale: h.rationale ?? '',
                suggestedZone: h.suggestedZone,
                suggestedZones: (h.suggestedZones ?? []).map((z, j) => ({
                  id: `zone-${Date.now()}-${i}-${j}`,
                  label: z.label ?? `Zone ${j + 1}`,
                  confidence: typeof z.confidence === 'number' ? z.confidence : 50,
                  coords: Array.isArray(z.coords) ? z.coords : [],
                  reasons: Array.isArray(z.reasons) ? z.reasons : [],
                })),
                createdAt: Date.now(),
              }))
            if (newHyps.length > 0) {
              setHypotheses((prev) => [...newHyps, ...prev].slice(0, 20))
            }
          } catch (parseErr) {
            console.warn('[AiPanel] failed to parse hypotheses JSON:', parseErr)
          }
        }
      }
    } catch (err) {
      console.warn('[AiPanel] hypothesis generation error:', err)
    } finally {
      setGenHypotheses(false)
    }
  }, [sessionId, model, genHypotheses])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const formatToolResult = (result: unknown): string => {
    try {
      if (typeof result === 'string') return result
      const obj = result as Record<string, unknown>
      if (obj.ok && obj.count !== undefined) {
        return `${obj.count} results${obj.scopeLabel ? ` — ${obj.scopeLabel}` : ''}`
      }
      return JSON.stringify(result, null, 2).slice(0, 500)
    } catch {
      return String(result)
    }
  }

  return (
    <div style={panelStyle.container}>
      {/* Header */}
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>AI ANALYST</span>
        <div style={panelStyle.headerRight}>
          <span style={panelStyle.status(health?.running ?? false)}>
            {health?.running ? '● ONLINE' : '● OFFLINE'}
          </span>
          {activeTab === 'chat' && messages.length > 0 && (
            <button onClick={clearChat} style={panelStyle.clearBtn} title="Clear chat">
              ✕ CLEAR
            </button>
          )}
        </div>
      </div>

      {/* Mode toggle — Active SAR vs Legacy/Research (ported from OGOS AIBottomBar) */}
      <div style={panelStyle.modeToggle}>
        <button
          style={panelStyle.modeBtn(analysisMode === 'active-sar', true)}
          onClick={() => setAnalysisMode('active-sar')}
          title="Active SAR: LKP-centric, time-critical, conservative, tight zones."
        >
          ACTIVE SAR
        </button>
        <button
          style={panelStyle.modeBtn(analysisMode === 'legacy-research', false)}
          onClick={() => setAnalysisMode('legacy-research')}
          title="Legacy / Research: bbox-spread, exploratory, speculation allowed, wide zones."
        >
          LEGACY / RESEARCH
        </button>
      </div>

      {/* Tab bar */}
      <div style={panelStyle.tabBar}>
        <button
          style={panelStyle.tab(activeTab === 'chat')}
          onClick={() => setActiveTab('chat')}
        >
          CHAT
        </button>
        <button
          style={panelStyle.tab(activeTab === 'hypotheses')}
          onClick={() => setActiveTab('hypotheses')}
        >
          HYPOTHESES {hypotheses.length > 0 && `(${hypotheses.length})`}
        </button>
      </div>

      {/* Model selector */}
      {health?.running && health.models.length > 0 && (
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={panelStyle.modelSelect}
        >
          {health.models.map((m) => (
            <option key={m.name} value={m.name}>{m.name}</option>
          ))}
        </select>
      )}

      {/* Chat tab */}
      {activeTab === 'chat' && (
        <>
      {/* Chat messages */}
      <div ref={scrollRef} style={panelStyle.chatArea}>
        {messages.length === 0 && !loading && (
          <div style={panelStyle.placeholder}>
            <div style={{ marginBottom: 12, fontSize: 13, color: '#4a9eff' }}>
              🌍 AI Analyst Ready
            </div>
            Ask about what you see, request analysis, or search the web.
            <br /><br />
            <div style={{ color: '#6b7d92' }}>Try:</div>
            <ul style={{ margin: '4px 0', paddingLeft: 16, color: '#8a9ab0' }}>
              <li>"Tell me about this area"</li>
              <li>"What's the terrain like here?"</li>
              <li>"Search for recent news about [place]"</li>
              <li>"Analyze slope and runoff for this region"</li>
              <li>"Show me the nearest aircraft"</li>
            </ul>
            <br />
            {!health?.running && (
              <div style={{ color: '#ff4a4a' }}>
                Ollama is not running. Start it with: <code style={{ color: '#ffea4a' }}>ollama serve</code>
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={panelStyle.msg(msg.role, msg.error ?? false)}>
            {msg.role === 'user' && (
              <>
                <span style={panelStyle.msgRole('user')}>YOU</span>
                <div style={panelStyle.msgContent(false)}>{msg.content}</div>
              </>
            )}
            {msg.role === 'assistant' && (
              <>
                <span style={panelStyle.msgRole('assistant')}>AI</span>
                <div style={panelStyle.msgContent(msg.error ?? false)}>{msg.content}</div>
              </>
            )}
            {msg.role === 'tool' && (
              <div style={panelStyle.toolMsg}>
                <span style={panelStyle.toolIcon}>🔧 {msg.toolName}</span>
                <div style={panelStyle.toolResult}>{formatToolResult(msg.toolResult)}</div>
              </div>
            )}
          </div>
        ))}

        {/* Active tool calls */}
        {activeTools.map((tool, i) => (
          <div key={`tool-${i}`} style={panelStyle.toolActive}>
            <span style={panelStyle.toolIcon}>🔧 {tool.name}</span>
            <span style={panelStyle.toolRunning}>running...</span>
          </div>
        ))}

        {/* Streaming text */}
        {streamingText && (
          <div style={panelStyle.msg('assistant', false)}>
            <span style={panelStyle.msgRole('assistant')}>AI</span>
            <div style={panelStyle.msgContent(false)}>{streamingText}<span style={panelStyle.cursor}>▋</span></div>
          </div>
        )}

        {/* Loading indicator (before first token) */}
        {loading && !streamingText && activeTools.length === 0 && (
          <div style={panelStyle.thinking}>
            <span style={panelStyle.dots}>●●●</span> thinking...
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={panelStyle.inputArea}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about this area, request analysis, or search..."
          style={panelStyle.input}
          rows={2}
          disabled={!health?.running}
        />
        <div style={panelStyle.btnGroup}>
          <button
            onClick={send}
            disabled={loading || !input.trim() || !health?.running}
            style={panelStyle.sendBtn(loading || !input.trim() || !health?.running)}
            title="Send message (Enter)"
          >
            CHAT
          </button>
          <button
            onClick={analyzeViewport}
            disabled={loading || !input.trim() || !health?.running || !viewer}
            style={panelStyle.visionBtn(loading || !input.trim() || !health?.running || !viewer)}
            title="Analyze current viewport with vision"
          >
            📷
          </button>
        </div>
      </div>
      </>
      )}

      {/* Hypotheses tab */}
      {activeTab === 'hypotheses' && (
        <div style={panelStyle.hypArea}>
          <div style={panelStyle.hypHeader}>
            <button
              onClick={generateHypotheses}
              disabled={!health?.running || genHypotheses}
              style={panelStyle.genBtn(!health?.running || genHypotheses)}
              title="Generate search hypotheses from current scene"
            >
              {genHypotheses ? 'GENERATING...' : '+ GENERATE HYPOTHESES'}
            </button>
          </div>

          {hypotheses.length === 0 && !genHypotheses && (
            <div style={panelStyle.hypPlaceholder}>
              <div style={{ marginBottom: 8, color: '#4a9eff' }}>No hypotheses yet</div>
              Click "Generate Hypotheses" to ask the AI to produce structured
              search priorities with confidence levels and suggested zones
              based on the current viewport.
            </div>
          )}

          {genHypotheses && (
            <div style={panelStyle.thinking}>
              <span style={panelStyle.dots}>●●●</span> generating hypotheses...
            </div>
          )}

          {hypotheses.map((hyp) => (
            <div key={hyp.id} style={panelStyle.hypCard(hyp.confidence)}>
              <div style={panelStyle.hypCardHeader}>
                <span style={panelStyle.confBadge(hyp.confidence)}>
                  {hyp.confidence.toUpperCase()}
                </span>
                <span style={panelStyle.hypTitle}>{hyp.title}</span>
              </div>
              {hyp.rationale && (
                <div style={panelStyle.hypRationale}>{hyp.rationale}</div>
              )}
              {hyp.suggestedZone && (
                <div style={panelStyle.hypZone}>
                  <span style={{ color: '#6b7d92' }}>Zone:</span> {hyp.suggestedZone}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Styles below ──

const panelStyle = {
  container: {
    background: 'rgba(11, 15, 20, 0.95)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    color: '#c0c8d0',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid #1e2a3a',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  title: { color: '#4a9eff', letterSpacing: 1, fontSize: 11, fontWeight: 'bold' as const },
  status: (online: boolean) => ({
    color: online ? '#4aff8a' : '#ff4a4a',
    fontSize: 10,
  }),
  clearBtn: {
    background: 'none',
    border: '1px solid #3a2a1e',
    color: '#ff8a4a',
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 2,
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  modelSelect: {
    margin: '6px 8px',
    padding: '3px 4px',
    background: '#0b0f14',
    color: '#c0c8d0',
    border: '1px solid #1e2a3a',
    borderRadius: 2,
    fontSize: 10,
  },
  chatArea: {
    flex: 1,
    overflow: 'auto',
    padding: 10,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  placeholder: {
    color: '#6b7d92',
    fontSize: 11,
    fontStyle: 'italic' as const,
    lineHeight: 1.6,
  },
  msg: (role: string, error: boolean) => ({
    padding: '8px 10px',
    background: role === 'user'
      ? 'rgba(74, 158, 255, 0.08)'
      : error
      ? 'rgba(255, 74, 74, 0.08)'
      : 'rgba(74, 255, 138, 0.04)',
    borderRadius: 4,
    border: `1px solid ${
      role === 'user' ? 'rgba(74, 158, 255, 0.2)'
      : error ? 'rgba(255, 74, 74, 0.2)'
      : 'rgba(74, 255, 138, 0.12)'
    }`,
  }),
  msgRole: (role: string) => ({
    fontSize: 9,
    color: role === 'user' ? '#4a9eff' : '#4aff8a',
    letterSpacing: 1,
    display: 'block',
    marginBottom: 4,
    fontWeight: 'bold' as const,
  }),
  msgContent: (error?: boolean) => ({
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
    color: error ? '#ff8a8a' : '#d0d8e0',
  }),
  cursor: {
    color: '#4aff8a',
    animation: 'blink 1s infinite',
  },
  thinking: {
    color: '#6b7d92',
    fontSize: 10,
    fontStyle: 'italic' as const,
    padding: '4px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dots: {
    color: '#4a9eff',
    letterSpacing: 2,
  },
  toolMsg: {
    padding: '6px 8px',
    background: 'rgba(255, 234, 74, 0.05)',
    borderRadius: 3,
    border: '1px solid rgba(255, 234, 74, 0.15)',
  },
  toolIcon: {
    fontSize: 10,
    color: '#ffea4a',
    fontWeight: 'bold' as const,
    display: 'block',
    marginBottom: 3,
  },
  toolResult: {
    fontSize: 10,
    color: '#a0a8b0',
    whiteSpace: 'pre-wrap' as const,
    maxHeight: 120,
    overflow: 'auto',
    padding: '4px 6px',
    background: 'rgba(11, 15, 20, 0.5)',
    borderRadius: 2,
  },
  toolActive: {
    padding: '6px 8px',
    background: 'rgba(255, 234, 74, 0.1)',
    borderRadius: 3,
    border: '1px solid rgba(255, 234, 74, 0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  toolRunning: {
    fontSize: 10,
    color: '#ffea4a',
    fontStyle: 'italic' as const,
  },
  inputArea: {
    display: 'flex',
    gap: 6,
    padding: 8,
    borderTop: '1px solid #1e2a3a',
  },
  input: {
    flex: 1,
    background: '#0b0f14',
    color: '#c0c8d0',
    border: '1px solid #1e2a3a',
    borderRadius: 2,
    padding: '6px 8px',
    fontFamily: 'monospace',
    fontSize: 11,
    resize: 'none' as const,
  },
  btnGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  sendBtn: (disabled: boolean) => ({
    padding: '6px 10px',
    background: disabled ? '#1a2a3a' : '#1e4a2a',
    color: disabled ? '#6b7d92' : '#4aff8a',
    border: '1px solid #2a5a3a',
    borderRadius: 2,
    fontSize: 10,
    letterSpacing: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 'bold' as const,
    fontFamily: 'monospace',
  }),
  visionBtn: (disabled: boolean) => ({
    padding: '4px 8px',
    background: disabled ? '#1a2a3a' : '#2a1e4a',
    color: disabled ? '#6b7d92' : '#c08aff',
    border: '1px solid #3a2a5a',
    borderRadius: 2,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'monospace',
  }),
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid #1e2a3a',
  },
  modeToggle: {
    display: 'flex',
    gap: 2,
    padding: '4px 6px',
    background: 'rgba(11, 15, 20, 0.5)',
    borderBottom: '1px solid #1e2a3a',
  },
  modeBtn: (active: boolean, isSAR: boolean) => ({
    flex: 1,
    padding: '4px 6px',
    background: active
      ? (isSAR ? 'rgba(255, 138, 74, 0.15)' : 'rgba(160, 74, 255, 0.15)')
      : 'transparent',
    color: active
      ? (isSAR ? '#ff8a4a' : '#a04aff')
      : '#6b7d92',
    border: active
      ? (isSAR ? '1px solid rgba(255, 138, 74, 0.4)' : '1px solid rgba(160, 74, 255, 0.4)')
      : '1px solid transparent',
    borderRadius: 2,
    fontSize: 8,
    letterSpacing: 0.5,
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'monospace',
  }),
  tab: (active: boolean) => ({
    flex: 1,
    padding: '6px 8px',
    background: active ? 'rgba(74, 158, 255, 0.08)' : 'transparent',
    color: active ? '#4a9eff' : '#6b7d92',
    border: 'none',
    borderBottom: active ? '2px solid #4a9eff' : '2px solid transparent',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: 'monospace',
  }),
  hypArea: {
    flex: 1,
    overflow: 'auto',
    padding: 10,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  hypHeader: {
    marginBottom: 4,
  },
  genBtn: (disabled: boolean) => ({
    width: '100%',
    padding: '8px',
    background: disabled ? '#1a2a3a' : '#1e3a4a',
    color: disabled ? '#6b7d92' : '#4a9eff',
    border: '1px solid #2a4a5a',
    borderRadius: 3,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: 'bold' as const,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'monospace',
  }),
  hypPlaceholder: {
    color: '#6b7d92',
    fontSize: 11,
    fontStyle: 'italic' as const,
    lineHeight: 1.6,
    padding: '20px 8px',
    textAlign: 'center' as const,
  },
  hypCard: (confidence: string) => ({
    padding: '8px 10px',
    background: 'rgba(11, 15, 20, 0.6)',
    borderRadius: 4,
    border: `1px solid ${
      confidence === 'critical' ? 'rgba(255, 74, 74, 0.3)'
      : confidence === 'high' ? 'rgba(255, 138, 74, 0.25)'
      : confidence === 'moderate' ? 'rgba(255, 234, 74, 0.2)'
      : 'rgba(74, 158, 255, 0.15)'
    }`,
  }),
  hypCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  confBadge: (confidence: string) => ({
    fontSize: 8,
    fontWeight: 'bold' as const,
    padding: '2px 6px',
    borderRadius: 2,
    letterSpacing: 0.5,
    color: confidence === 'critical' ? '#ff4a4a'
      : confidence === 'high' ? '#ff8a4a'
      : confidence === 'moderate' ? '#ffea4a'
      : '#4a9eff',
    border: `1px solid ${
      confidence === 'critical' ? 'rgba(255, 74, 74, 0.3)'
      : confidence === 'high' ? 'rgba(255, 138, 74, 0.3)'
      : confidence === 'moderate' ? 'rgba(255, 234, 74, 0.3)'
      : 'rgba(74, 158, 255, 0.3)'
    }`,
  }),
  hypTitle: {
    fontSize: 11,
    fontWeight: 'bold' as const,
    color: '#d0d8e0',
  },
  hypRationale: {
    fontSize: 10,
    color: '#a0a8b0',
    lineHeight: 1.5,
    marginTop: 4,
  },
  hypZone: {
    fontSize: 10,
    color: '#8a9ab0',
    marginTop: 4,
    fontStyle: 'italic' as const,
  },
}
