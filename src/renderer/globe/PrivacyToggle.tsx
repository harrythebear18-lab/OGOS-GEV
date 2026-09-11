/**
 * PrivacyToggle — global privacy mode with two-step confirmation.
 *
 * Ported from OGOS RightPanel privacy bar, extended with a secondary
 * confirmation dialog. When privacy is ON (default), sensitive network
 * data (IPs, hostnames, process names, ISP, location) is masked and
 * the user-location node + connection arcs are hidden on the globe.
 *
 * Turning it OFF requires TWO steps:
 *   1. Type YES in the input box
 *   2. A final warning dialog with full details + Cancel/OK
 *
 * Persists to localStorage key 'osint-privacy-mode'.
 * Exposes the state via a callback so parent components can mask data.
 */

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'osint-privacy-mode'

interface PrivacyToggleProps {
  onChange?: (privacyMode: boolean) => void
}

export function usePrivacyMode() {
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false'
    } catch {
      return true
    }
  })

  const toggle = useCallback(() => {
    setPrivacyMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {}
      return next
    })
  }, [])

  return { privacyMode, setPrivacyMode, toggle }
}

/** Mask a string when privacy mode is on. Returns a placeholder. */
export function mask(value: string | undefined | null, privacy: boolean, placeholder = '—'): string {
  if (privacy) return placeholder
  return value ?? placeholder
}

/** Mask an IP address — shows only last octet when privacy is on. */
export function maskIP(ip: string | undefined | null, privacy: boolean): string {
  if (!ip) return '—'
  if (privacy) {
    if (ip.includes('.') && !ip.includes(':')) {
      const parts = ip.split('.')
      return `xxx.xxx.xxx.${parts[parts.length - 1] ?? '?'}`
    }
    return '[hidden]'
  }
  return ip
}

export default function PrivacyToggle({ onChange }: PrivacyToggleProps) {
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false'
    } catch {
      return true
    }
  })
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  // Secondary confirmation — final warning dialog after YES is typed
  const [showFinalWarning, setShowFinalWarning] = useState(false)

  useEffect(() => {
    onChange?.(privacyMode)
  }, [privacyMode, onChange])

  const togglePrivacy = () => {
    if (privacyMode) {
      // Turning OFF — require confirmation
      setShowConfirm(true)
      setConfirmText('')
      return
    }
    // Turning ON — no confirmation needed
    setPrivacyMode(true)
    try { localStorage.setItem(STORAGE_KEY, 'true') } catch {}
  }

  // Step 1: user typed YES — now show the final warning dialog
  const confirmPrivacyOff = () => {
    if (confirmText.trim().toUpperCase() === 'YES') {
      setShowConfirm(false)
      setShowFinalWarning(true)
    }
  }

  // Step 2: user clicked OK on the final warning — actually disable privacy
  const acceptFinalWarning = () => {
    setPrivacyMode(false)
    try { localStorage.setItem(STORAGE_KEY, 'false') } catch {}
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

  return (
    <>
      {/* Always-visible toolbar button */}
      <button
        onClick={togglePrivacy}
        title={privacyMode
          ? 'PRIVACY ON — sensitive data masked. Click to reveal (requires confirmation).'
          : 'PRIVACY OFF — sensitive data visible. Click to re-enable masking.'}
        style={{
          background: privacyMode ? 'rgba(74, 255, 138, 0.15)' : 'rgba(255, 74, 74, 0.15)',
          border: `1px solid ${privacyMode ? 'rgba(74, 255, 138, 0.5)' : 'rgba(255, 74, 74, 0.5)'}`,
          color: privacyMode ? '#4aff8a' : '#ff4a4a',
          fontSize: 9,
          padding: '4px 8px',
          borderRadius: 2,
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: 0.5,
          boxShadow: privacyMode
            ? '0 0 6px rgba(74, 255, 138, 0.3)'
            : '0 0 6px rgba(255, 74, 74, 0.3)',
        }}
      >
        {privacyMode ? '🛡 PRIV' : '👁 PRIV'}
      </button>

      {/* Step 1: Type YES confirmation — full-screen modal */}
      {showConfirm && (
        <div style={modalBackdrop}>
          <div style={modalCard}>
            <div style={modalTitle}>⚠ REVEAL SENSITIVE DATA?</div>
            <div style={modalText}>
              You are about to disable privacy mode. This will expose your
              public IP, ISP, network connections, DNS servers, process names,
              and your geographic location on the globe.
            </div>
            <div style={modalHint}>
              Type <strong style={{ color: '#ff4a4a' }}>YES</strong> to continue:
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmPrivacyOff() }}
              placeholder="Type YES..."
              autoFocus
              style={modalInput}
            />
            <div style={modalActions}>
              <button
                onClick={confirmPrivacyOff}
                disabled={confirmText.trim().toUpperCase() !== 'YES'}
                style={{
                  ...modalBtnYes,
                  opacity: confirmText.trim().toUpperCase() === 'YES' ? 1 : 0.4,
                  cursor: confirmText.trim().toUpperCase() === 'YES' ? 'pointer' : 'not-allowed',
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

      {/* Step 2: Final warning dialog with full details + Cancel/OK */}
      {showFinalWarning && (
        <div style={modalBackdrop}>
          <div style={{ ...modalCard, borderColor: 'rgba(255, 74, 74, 0.6)', width: 420 }}>
            <div style={{ ...modalTitle, fontSize: 14 }}>⚠ FINAL WARNING</div>
            <div style={modalText}>
              You have confirmed you want to reveal sensitive data. By clicking OK:
            </div>
            <ul style={warningList}>
              <li>Your <strong>public IP address</strong> will be visible</li>
              <li>Your <strong>ISP and location</strong> (city, country) will be shown</li>
              <li>All <strong>network connections</strong> (TCP/UDP) will be displayed with remote IPs</li>
              <li>Your <strong>location will be plotted on the globe</strong> as a green node</li>
              <li><strong>Connection arcs</strong> from your location to remote servers will be drawn</li>
              <li><strong>DNS servers</strong> and <strong>process names</strong> will be exposed</li>
            </ul>
            <div style={{ ...modalText, color: '#ff8a8a', fontWeight: 'bold' }}>
              If you are screen-recording, streaming, or sharing your screen,
              this will expose your personal data. Proceed with caution.
            </div>
            <div style={modalActions}>
              <button onClick={acceptFinalWarning} style={modalBtnYes}>
                OK — Reveal Data
              </button>
              <button onClick={cancelFinalWarning} style={modalBtnNo}>
                Cancel — Keep Privacy ON
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Modal styles (full-screen overlay so dialogs are always visible) ──

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
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
