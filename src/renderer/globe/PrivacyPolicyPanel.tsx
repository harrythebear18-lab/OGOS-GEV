/**
 * Privacy Policy Panel — displays the Visentrix privacy policy in-app.
 *
 * Triggered by the PRIVACY toolbar button. Shows the full GDPR privacy policy
 * with the same content as PRIVACY.md and the Visentrix website.
 */

interface Props {
  onClose: () => void
}

function PrivacyPolicyPanel({ onClose }: Props) {
  return (
    <div style={{
      position: 'absolute',
      top: 88,
      right: 12,
      zIndex: 200,
      width: 420,
      maxHeight: '70vh',
      overflow: 'auto',
      background: 'rgba(10, 18, 30, 0.95)',
      border: '1px solid rgba(74, 159, 255, 0.3)',
      borderRadius: 8,
      padding: 16,
      fontFamily: 'monospace',
      color: '#c8d6e5',
      fontSize: 12,
      lineHeight: 1.6,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 10, color: '#6b7d92', textTransform: 'uppercase', letterSpacing: 1 }}>Legal</p>
          <h2 style={{ margin: '4px 0 0 0', fontSize: 16, color: '#4a9eff' }}>Privacy Policy</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 10, color: '#6b7d92' }}>Effective Date: August 2026</p>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 74, 74, 0.15)',
            border: '1px solid rgba(255, 74, 74, 0.4)',
            color: '#ff4a4a',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          ✕ CLOSE
        </button>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid rgba(74, 159, 255, 0.15)', margin: '8px 0 16px 0' }} />

      <p style={{ color: '#a0b4c8' }}>
        Visentrix is committed to GDPR compliance. We collect minimal data, all of which is
        anonymous and cannot be traced back to individual users.
      </p>

      {/* 1. Data We Collect */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>1. Data We Collect</h3>

      <h4 style={{ color: '#c8d6e5', fontSize: 12, margin: '12px 0 6px 0' }}>Anonymous Download Tracking</h4>
      <ul style={{ margin: '4px 0 12px 0', paddingLeft: 20, color: '#a0b4c8' }}>
        <li>Product name, version, platform, and release channel</li>
        <li>Timestamp rounded to the nearest hour</li>
        <li>No IP addresses, no user IDs, no cookies, no device fingerprints</li>
      </ul>

      <h4 style={{ color: '#c8d6e5', fontSize: 12, margin: '12px 0 6px 0' }}>Sanitized Crash Reports</h4>
      <ul style={{ margin: '4px 0 12px 0', paddingLeft: 20, color: '#a0b4c8' }}>
        <li>Error message and stack trace (PII automatically stripped)</li>
        <li>Application version and operating system</li>
        <li>Timestamp rounded to the nearest minute</li>
        <li>Random crash ID (not traceable to users)</li>
        <li>Optional user-provided context (only if explicitly entered)</li>
      </ul>

      <h4 style={{ color: '#c8d6e5', fontSize: 12, margin: '12px 0 6px 0' }}>Discord Support Tickets</h4>
      <ul style={{ margin: '4px 0 12px 0', paddingLeft: 20, color: '#a0b4c8' }}>
        <li>Data you voluntarily provide: Discord username, contact email, issue details</li>
        <li>Processed by Discord under their privacy policy</li>
      </ul>

      {/* 2. Legal Basis */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>2. Legal Basis (GDPR Article 6)</h3>
      <ul style={{ margin: '4px 0 12px 0', paddingLeft: 20, color: '#a0b4c8' }}>
        <li><strong style={{ color: '#c8d6e5' }}>Legitimate interest</strong> (Art. 6(1)(f)) — improving software stability and user experience via anonymous telemetry</li>
        <li><strong style={{ color: '#c8d6e5' }}>Consent</strong> (Art. 6(1)(a)) — for crash reports with user-provided context and Discord ticket submissions</li>
      </ul>

      {/* 3. Your Rights */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>3. Your Rights Under GDPR</h3>
      <ul style={{ margin: '4px 0 12px 0', paddingLeft: 20, color: '#a0b4c8' }}>
        <li>Right to access (Art. 15)</li>
        <li>Right to rectification (Art. 16)</li>
        <li>Right to erasure (Art. 17)</li>
        <li>Right to restrict processing (Art. 18)</li>
        <li>Right to data portability (Art. 20)</li>
        <li>Right to object (Art. 21)</li>
        <li>Right to withdraw consent at any time (Art. 7(3))</li>
      </ul>
      <p style={{ color: '#a0b4c8' }}>
        Since our download tracking and crash reports are anonymous, we cannot identify or
        retrieve data tied to a specific individual. For Discord ticket data, contact us
        through our Discord server.
      </p>

      {/* 4. Data Retention */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>4. Data Retention</h3>
      <ul style={{ margin: '4px 0 12px 0', paddingLeft: 20, color: '#a0b4c8' }}>
        <li>Download statistics: aggregated and retained indefinitely (anonymous)</li>
        <li>Crash reports: retained for 90 days, then automatically deleted</li>
        <li>Discord tickets: managed by Discord's retention policy</li>
      </ul>

      {/* 5. Data Storage */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>5. Data Storage</h3>
      <p style={{ color: '#a0b4c8' }}>
        Anonymous telemetry data is stored on our servers in the United Kingdom. Discord ticket
        data is processed by Discord Corp. under their privacy policy.
      </p>

      {/* 6. Cookies */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>6. Cookies</h3>
      <p style={{ color: '#a0b4c8' }}>
        We do not use tracking cookies. A single localStorage entry stores your consent choice
        (accept/decline). No third-party analytics or advertising cookies are used.
      </p>

      {/* 7. Children's Privacy */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>7. Children's Privacy</h3>
      <p style={{ color: '#a0b4c8' }}>
        Our software and services are not directed at children under 16. We do not knowingly
        collect data from children.
      </p>

      {/* 8. Contact */}
      <h3 style={{ color: '#4aff8a', fontSize: 13, marginTop: 20, marginBottom: 8 }}>8. Contact</h3>
      <p style={{ color: '#a0b4c8' }}>
        For privacy inquiries or to exercise your GDPR rights, join our{' '}
        <a href="https://discord.gg/visentrix" target="_blank" rel="noopener noreferrer" style={{ color: '#4a9eff' }}>
          Discord server
        </a>{' '}
        or submit a ticket via the support section on our home page.
      </p>

      <hr style={{ border: 0, borderTop: '1px solid rgba(74, 159, 255, 0.15)', margin: '16px 0 8px 0' }} />
      <p style={{ color: '#6b7d92', fontSize: 10, textAlign: 'center' }}>
        © 2026 Visentrix. All rights reserved.
      </p>
    </div>
  )
}

export default PrivacyPolicyPanel
