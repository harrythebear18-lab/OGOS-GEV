import { useState, useEffect, useRef } from 'react'

interface AiPanelProps {
  viewport: unknown
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export default function AiPanel({ viewport }: AiPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<{ running: boolean; models: { name: string }[] } | null>(null)
  const [model, setModel] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.ai.health().then((h) => {
      setHealth(h as { running: boolean; models: { name: string }[] })
      if ((h as { models: { name: string }[] }).models.length > 0) {
        setModel((h as { models: { name: string }[] }).models[0].name)
      }
    })
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const send = async () => {
    if (!input.trim() || loading) return

    const userMsg: ChatMsg = { role: 'user', content: input }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setLoading(true)

    try {
      const ctx = JSON.stringify(viewport)
      const res = await window.api.ai.chat(input, model || undefined, ctx)
      const assistantMsg: ChatMsg = {
        role: 'assistant',
        content: res.content || res.error || '(no response)',
      }
      setMessages((m) => [...m, assistantMsg])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e}` }])
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={panelStyle.container}>
      <div style={panelStyle.header}>
        <span style={panelStyle.title}>AI ANALYST</span>
        <span style={panelStyle.status(health?.running ?? false)}>
          {health?.running ? '● ONLINE' : '● OFFLINE'}
        </span>
      </div>

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

      <div ref={scrollRef} style={panelStyle.chatArea}>
        {messages.length === 0 && (
          <div style={panelStyle.placeholder}>
            Ask the AI analyst about the current scene, terrain, or analysis results.
            <br /><br />
            {health?.running
              ? 'Ollama is running. Try: "Analyze the terrain in view" or "What search strategy should I use?"'
              : 'Start Ollama to enable AI analysis: ollama serve'}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={panelStyle.msg(msg.role)}>
            <span style={panelStyle.msgRole(msg.role)}>{msg.role === 'user' ? 'YOU' : 'AI'}</span>
            <div style={panelStyle.msgContent}>{msg.content}</div>
          </div>
        ))}
        {loading && <div style={panelStyle.typing}>AI is thinking...</div>}
      </div>

      <div style={panelStyle.inputArea}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about terrain, analysis, or search strategy..."
          style={panelStyle.input}
          rows={2}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={panelStyle.sendBtn(loading || !input.trim())}
        >
          SEND
        </button>
      </div>
    </div>
  )
}

const panelStyle = {
  container: {
    background: 'rgba(11, 15, 20, 0.9)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column' as const,
    height: 'calc(100vh - 100px)',
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
  title: { color: '#4a9eff', letterSpacing: 1, fontSize: 11, fontWeight: 'bold' as const },
  status: (online: boolean) => ({
    color: online ? '#4aff8a' : '#ff4a4a',
    fontSize: 10,
  }),
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
    lineHeight: 1.5,
  },
  msg: (role: string) => ({
    padding: 6,
    background: role === 'user' ? 'rgba(74, 158, 255, 0.1)' : 'rgba(74, 255, 138, 0.05)',
    borderRadius: 3,
    border: `1px solid ${role === 'user' ? 'rgba(74, 158, 255, 0.2)' : 'rgba(74, 255, 138, 0.15)'}`,
  }),
  msgRole: (role: string) => ({
    fontSize: 9,
    color: role === 'user' ? '#4a9eff' : '#4aff8a',
    letterSpacing: 1,
    display: 'block',
    marginBottom: 3,
  }),
  msgContent: {
    fontSize: 11,
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap' as const,
    color: '#c0c8d0',
  },
  typing: {
    color: '#6b7d92',
    fontSize: 10,
    fontStyle: 'italic' as const,
    padding: 4,
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
  sendBtn: (disabled: boolean) => ({
    padding: '6px 12px',
    background: disabled ? '#1a2a3a' : '#1e4a2a',
    color: disabled ? '#6b7d92' : '#4aff8a',
    border: '1px solid #2a5a3a',
    borderRadius: 2,
    fontSize: 10,
    letterSpacing: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 'bold' as const,
  }),
}
