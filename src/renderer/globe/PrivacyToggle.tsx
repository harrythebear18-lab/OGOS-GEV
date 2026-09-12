/**
 * SecurityToggle — 4-stage tiered security system.
 *
 * Stage 0: 🔒 LOCK    — everything hidden, AI uses coarse region (~1°/~111km), no reverse geocode, no exact coords, no network
 * Stage 1: 🧠 AI      — network still locked, location still locked, AI gets finer regional context (~0.1°/~11km), still no exact, no "your location" phrasing
 * Stage 2: ⚡ FULL    — network still locked, identity hidden, location hidden, AI gets exact bbox/coords, reverse geocode allowed, full OSINT precision
 * Stage 3: 🔓 NET     — everything visible: IP, ISP, DNS, GeoIP, connection arcs, user-location node, full OSINT, full AI, full web search
 *
 * Advancing stages requires two-step confirmation (type YES → final warning with Cancel/OK).
 * Locking back down (any stage → 0) is immediate — no confirmation needed.
 *
 * Network data (IP, ISP, DNS, connections, user node, arcs) is the most sensitive —
 * it reveals your local/home network and I/O from all public endpoints.
 * It is ALWAYS hidden unless explicitly unlocked at stage 3.
 *
 * Persists to localStorage key 'osint-security-level'.
 */

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'osint-security-level'

// Randomized confirmation words — forces the user to actually read the prompt
// instead of muscle-memory typing "YES". Engages the brain before doxing yourself.
// Standard words for stages 1-2, high-commitment phrases for stage 3 (network unlock).
const CONFIRM_WORDS_STANDARD = ['ENABLE', 'GRANT', 'APPROVE', 'ACCEPT', 'AFFIRM', 'CONFIRM', 'LIFT']
const CONFIRM_WORDS_EXPERT = ['BREAK SEAL', 'ESCALATE', 'ELEVATE', 'OPEN GATE', 'I INTEND', 'I ACCEPT RISK', "I'M CERTAIN"]

export type SecurityLevel = 0 | 1 | 2 | 3

export const SECURITY_LEVEL_LOCKED: SecurityLevel = 0
export const SECURITY_LEVEL_AI: SecurityLevel = 1
export const SECURITY_LEVEL_FULL_OSINT: SecurityLevel = 2
export const SECURITY_LEVEL_NETWORK: SecurityLevel = 3

interface SecurityToggleProps {
  onChange?: (level: SecurityLevel) => void
}

/** Mask a string when security level is below threshold. */
export function mask(value: string | undefined | null, level: SecurityLevel, threshold: SecurityLevel, placeholder = '—'): string {
  if (level < threshold) return placeholder
  return value ?? placeholder
}

/** Mask an IP address when security level is below threshold. */
export function maskIP(ip: string | undefined | null, level: SecurityLevel, threshold: SecurityLevel): string {
  if (!ip) return '—'
  if (level < threshold) {
    if (ip.includes('.') && !ip.includes(':')) {
      const parts = ip.split('.')
      return `xxx.xxx.xxx.${parts[parts.length - 1] ?? '?'}`
    }
    return '[hidden]'
  }
  return ip
}

/** Network data (user node, IP, ISP, DNS, connections, arcs) visible at stage 3 only. */
export function networkVisible(level: SecurityLevel): boolean {
  return level >= SECURITY_LEVEL_NETWORK
}

/** AI gets exact coordinates at stage 2+. */
export function aiExactCoords(level: SecurityLevel): boolean {
  return level >= SECURITY_LEVEL_FULL_OSINT
}

/** Reverse geocode (place name lookup) allowed at stage 2+. */
export function reverseGeocodeAllowed(level: SecurityLevel): boolean {
  return level >= SECURITY_LEVEL_FULL_OSINT
}

/** AI can reference "your location" at stage 2+. */
export function aiCanReferenceLocation(level: SecurityLevel): boolean {
  return level >= SECURITY_LEVEL_FULL_OSINT
}

/** Privacy mode (coarsened AI/web search) ON at stages 0-1. */
export function privacyMode(level: SecurityLevel): boolean {
  return level < SECURITY_LEVEL_FULL_OSINT
}

/** AI must treat user as locationless at stages 0-1. */
export function aiLocationless(level: SecurityLevel): boolean {
  return level < SECURITY_LEVEL_FULL_OSINT
}

/** Coarsening precision: stage 0 = ~1 degree (~111km), stage 1 = ~0.1 degree (~11km). */
export function coarsePrecision(level: SecurityLevel): number {
  if (level === 0) return 1.0
  if (level === 1) return 0.1
  return 0 // exact
}

export default function SecurityToggle({ onChange }: SecurityToggleProps) {
  const [level, setLevel] = useState<SecurityLevel>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      const n = stored ? parseInt(stored, 10) : 0
      return (n >= 0 && n <= 3 ? n : 0) as SecurityLevel
    } catch {
      return 0
    }
  })
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [confirmWord, setConfirmWord] = useState('YES')
  const [showFinalWarning, setShowFinalWarning] = useState(false)
  const [pendingLevel, setPendingLevel] = useState<SecurityLevel>(0)

  useEffect(() => {
    onChange?.(level)
  }, [level, onChange])

  const handleClick = () => {
    if (level < 3) {
      const next = (level + 1) as SecurityLevel
      setPendingLevel(next)
      // Stage 3 (network unlock) uses high-commitment phrases, stages 1-2 use standard words
      const wordList = next === 3 ? CONFIRM_WORDS_EXPERT : CONFIRM_WORDS_STANDARD
      setConfirmWord(wordList[Math.floor(Math.random() * wordList.length)])
      setShowConfirm(true)
      setConfirmText('')
    } else {
      // 3 → 0: lock everything (immediate, no confirmation)
      setLevel(0)
      try { localStorage.setItem(STORAGE_KEY, '0') } catch {}
    }
  }

  const confirmAdvance = () => {
    if (confirmText.trim().toUpperCase() === confirmWord) {
      setShowConfirm(false)
      setShowFinalWarning(true)
    }
  }

  const acceptFinalWarning = () => {
    setLevel(pendingLevel)
    try { localStorage.setItem(STORAGE_KEY, String(pendingLevel)) } catch {}
    setShowFinalWarning(false)
    setConfirmText('')
  }

  const cancelConfirm = () => {
    setShowConfirm(false)
    setConfirmText('')
  }

  const cancelFinalWarning = () => {
    setShowFinalWarning(false)
    setConfirmText('')
  }

  const levelConfig = {
    0: { label: '🛡 LOCK', color: '#4aff8a', bg: 'rgba(74, 255, 138, 0.15)', border: 'rgba(74, 255, 138, 0.5)', glow: 'rgba(74, 255, 138, 0.3)' },
    1: { label: '🧠 AI', color: '#4ad8ff', bg: 'rgba(74, 216, 255, 0.15)', border: 'rgba(74, 216, 255, 0.5)', glow: 'rgba(74, 216, 255, 0.3)' },
    2: { label: '⚡ FULL', color: '#ffea4a', bg: 'rgba(255, 234, 74, 0.15)', border: 'rgba(255, 234, 74, 0.5)', glow: 'rgba(255, 234, 74, 0.3)' },
    3: { label: '🔓 NET', color: '#ff4a4a', bg: 'rgba(255, 74, 74, 0.15)', border: 'rgba(255, 74, 74, 0.5)', glow: 'rgba(255, 74, 74, 0.3)' },
  }

  const cfg = levelConfig[level]
  const stageNames = ['LOCK', 'AI', 'FULL', 'NET']
  const nextStage = stageNames[level + 1] || 'LOCK'
  const title = level === 3
    ? 'SECURITY NET — all data visible. Click to LOCK everything (stage 0).'
    : `SECURITY ${cfg.label} — click to advance to ${nextStage} (requires confirmation)`

  const getWarningItems = (target: SecurityLevel): (string | { bold: string })[] => {
    if (target === 1) return [
      'AI gets FINER regional context (~11km instead of ~111km)',
      'Web search still uses COARSE location',
      'AI still says "the selected region" — NOT "your location"',
      'No exact coordinates exposed to AI',
      'No reverse geocode (place name lookup)',
      'Network data (IP, ISP, DNS, connections, user node) stays HIDDEN',
      'User identity and location stay HIDDEN',
    ]
    if (target === 2) return [
      { bold: 'Everything from AI stage, PLUS:' },
      'AI gets EXACT viewport coordinates (full precision)',
      'Web search uses EXACT location for NWS alerts and geocoding',
      'Reverse geocode resolves exact place names',
      'Scene context JSON contains precise bbox/camera/LKP',
      'AI may now reference "your location" in responses',
      'Network data (IP, ISP, DNS, connections, user node) stays HIDDEN',
      'User identity stays HIDDEN',
    ]
    return [
      { bold: 'Everything from FULL stage, PLUS:' },
      'Your public IP address will be visible',
      'Your ISP and location (city, country) will be shown',
      'All network connections (TCP/UDP) will be displayed with remote IPs',
      'Your location will be plotted on the globe as a green node',
      'Connection arcs from your location to remote servers will be drawn',
      'DNS servers and process names will be exposed',
      'This reveals your local/home network and all I/O endpoints',
    ]
  }

  const warningItems = getWarningItems(pendingLevel)

  return (
    <>
      <button
        onClick={handleClick}
        title={title}
        style={{
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          color: cfg.color,
          fontSize: 9,
          padding: '4px 8px',
          borderRadius: 2,
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: 0.5,
          boxShadow: `0 0 6px ${cfg.glow}`,
        }}
      >
        {cfg.label}
      </button>

      {showConfirm && (
        <div style={modalBackdrop}>
          <div style={{
            ...modalCard,
            borderColor: pendingLevel <= 1 ? 'rgba(74, 216, 255, 0.3)' : 'rgba(255, 74, 74, 0.4)',
          }}>
            <div style={{
              ...modalTitle,
              color: pendingLevel <= 1 ? '#4ad8ff' : '#ff4a4a',
            }}>
              {pendingLevel <= 1 ? '✓ ADVANCE TO' : '⚠ ADVANCE TO'} {stageNames[pendingLevel]}?
            </div>
            <div style={modalText}>
              {pendingLevel === 1 && 'You are advancing to AI mode. The AI gets finer regional context (~11km) but still no exact coordinates. It will still say "the selected region" and treat you as locationless. Network data stays hidden.'}
              {pendingLevel === 2 && 'You are advancing to FULL OSINT mode. The AI gets exact coordinates, web search uses precise location, and reverse geocode resolves place names. The AI may reference "your location". Network data stays hidden.'}
              {pendingLevel === 3 && 'You are advancing to NETWORK mode. This exposes your public IP, ISP, network connections, DNS servers, process names, and plots your location on the globe. This reveals your local/home network and all I/O endpoints.'}
            </div>
            <div style={modalHint}>
              Type <strong style={{ color: pendingLevel <= 1 ? '#4ad8ff' : '#ff4a4a' }}>{confirmWord}</strong> to continue:
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmAdvance() }}
              placeholder={`Type ${confirmWord}...`}
              autoFocus
              style={modalInput}
            />
            <div style={modalActions}>
              <button
                onClick={confirmAdvance}
                disabled={confirmText.trim().toUpperCase() !== confirmWord}
                style={{
                  ...modalBtnYes,
                  opacity: confirmText.trim().toUpperCase() === confirmWord ? 1 : 0.4,
                  cursor: confirmText.trim().toUpperCase() === confirmWord ? 'pointer' : 'not-allowed',
                }}
              >
                Continue
              </button>
              <button onClick={cancelConfirm} style={modalBtnNo}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinalWarning && (
        <div style={modalBackdrop}>
          <div style={{
            ...modalCard,
            borderColor: pendingLevel <= 1 ? 'rgba(74, 216, 255, 0.4)' : 'rgba(255, 74, 74, 0.6)',
            width: 420,
          }}>
            <div style={{
              ...modalTitle,
              fontSize: 14,
              color: pendingLevel <= 1 ? '#4ad8ff' : '#ff4a4a',
            }}>
              {pendingLevel <= 1 ? '✓ CONFIRM ADVANCE' : '⚠ FINAL WARNING'}
            </div>
            <div style={modalText}>
              You have confirmed you want to advance to {stageNames[pendingLevel]}. By clicking OK:
            </div>
            <ul style={warningList}>
              {warningItems.map((item, i) => (
                <li key={i}>{typeof item === 'string' ? item : <strong>{item.bold}</strong>}</li>
              ))}
            </ul>
            <div style={{ ...modalText, color: pendingLevel <= 1 ? '#4ad8ff' : '#ff8a8a', fontWeight: 'bold' }}>
              {pendingLevel <= 1
                ? 'No personal data is exposed at this stage. Network data and your location stay hidden.'
                : 'If you are screen-recording, streaming, or sharing your screen, this will expose your personal data.'}
            </div>
            <div style={modalActions}>
              <button onClick={acceptFinalWarning} style={modalBtnYes}>
                OK — Advance to {stageNames[pendingLevel]}
              </button>
              <button onClick={cancelFinalWarning} style={modalBtnNo}>
                Cancel — Stay at {stageNames[level]}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Modal styles ──

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0, 0, 0, 0.75)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const modalCard: React.CSSProperties = {
  background: 'rgba(11, 15, 20, 0.98)',
  border: '1px solid rgba(255, 74, 74, 0.4)',
  borderRadius: 4,
  padding: 18,
  width: 380,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily: 'monospace',
  color: '#c0c8d0',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.7)',
}

const modalTitle: React.CSSProperties = {
  color: '#ff4a4a',
  fontSize: 12,
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'center',
}

const modalText: React.CSSProperties = {
  color: 'rgba(192, 200, 208, 0.8)',
  fontSize: 10,
  lineHeight: 1.5,
}

const modalHint: React.CSSProperties = {
  color: 'rgba(192, 200, 208, 0.5)',
  fontSize: 10,
}

const modalInput: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid rgba(255, 74, 74, 0.3)',
  borderRadius: 2,
  color: '#fff',
  fontSize: 12,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'monospace',
}

const modalActions: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
}

const modalBtnYes: React.CSSProperties = {
  flex: 1,
  background: 'rgba(255, 74, 74, 0.15)',
  border: '1px solid rgba(255, 74, 74, 0.4)',
  color: '#ff4a4a',
  fontSize: 11,
  fontWeight: 'bold',
  padding: '6px',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'monospace',
}

const modalBtnNo: React.CSSProperties = {
  flex: 1,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  color: 'rgba(192, 200, 208, 0.7)',
  fontSize: 11,
  padding: '6px',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'monospace',
}

const warningList: React.CSSProperties = {
  color: 'rgba(192, 200, 208, 0.7)',
  fontSize: 10,
  lineHeight: 1.6,
  margin: 0,
  paddingLeft: 16,
}
