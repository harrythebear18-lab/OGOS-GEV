# Privacy Policy

**Effective Date:** August 2026

Visentrix is committed to GDPR compliance. We collect minimal data, all of which is
anonymous and cannot be traced back to individual users.

## 1. Data We Collect

### Anonymous Download Tracking
- Product name, version, platform, and release channel
- Timestamp rounded to the nearest hour
- No IP addresses, no user IDs, no cookies, no device fingerprints

### Sanitized Crash Reports
- Error message and stack trace (PII automatically stripped)
- Application version and operating system
- Timestamp rounded to the nearest minute
- Random crash ID (not traceable to users)
- Optional user-provided context (only if explicitly entered)

### Discord Support Tickets
- Data you voluntarily provide: Discord username, contact email, issue details
- Processed by Discord under their privacy policy

### In-App Security Model (OSINT Sentinel Workstation)
- The workstation uses a 4-stage security model (LOCK / AI / FULL / NET)
- No telemetry is sent unless explicitly enabled
- Network diagnostics (IP, ISP, DNS) only appear at security stage 3 and are never transmitted off-device
- AI context is coarsened based on security stage (~111km at stage 0, ~11km at stage 1, exact at stage 2+)
- All AI processing is local (Ollama) — no data leaves the machine
- License validation uses a machine fingerprint (CPU + MAC + disk serial) — no personal data transmitted
- All cached tiles, DEM data, and analysis results are stored locally and never transmitted to remote servers

### License Activation (Optional)
- If online activation is enabled, the license key and machine fingerprint are sent to the Visentrix license server
- The machine fingerprint is a SHA-256 hash of hardware identifiers — it cannot be reverse-engineered to identify you personally
- No other data is sent during activation
- Offline activation is available and sends no data anywhere

## 2. Legal Basis (GDPR Article 6)

- **Legitimate interest** (Art. 6(1)(f)) — improving software stability and user experience via anonymous telemetry
- **Consent** (Art. 6(1)(a)) — for crash reports with user-provided context and Discord ticket submissions

## 3. Your Rights Under GDPR

- Right to access (Art. 15)
- Right to rectification (Art. 16)
- Right to erasure (Art. 17)
- Right to restrict processing (Art. 18)
- Right to data portability (Art. 20)
- Right to object (Art. 21)
- Right to withdraw consent at any time (Art. 7(3))

Since our download tracking and crash reports are anonymous, we cannot identify or
retrieve data tied to a specific individual. For Discord ticket data, contact us
through our Discord server.

## 4. Data Retention

- Download statistics: aggregated and retained indefinitely (anonymous)
- Crash reports: retained for 90 days, then automatically deleted
- Discord tickets: managed by Discord's retention policy
- License files: stored locally on the user's machine, encrypted, never transmitted except during online activation
- In-app security state: never stored or transmitted (session-only, cleared on exit)
- Cached tiles/DEM/analysis: stored locally, cleared by the user or via TTL/LRU eviction

## 5. Data Storage

Anonymous telemetry data is stored on our servers in the United Kingdom. Discord ticket
data is processed by Discord Corp. under their privacy policy.

The OSINT Sentinel Workstation stores all cached tiles, DEM data, analysis results, and
license files locally on the user's machine. No cached data is transmitted to remote servers.
License files are encrypted using the operating system's secure storage API.

## 6. Cookies

We do not use tracking cookies. A single localStorage entry stores your consent choice
(accept/decline). No third-party analytics or advertising cookies are used.

## 7. Children's Privacy

Our software and services are not directed at children under 16. We do not knowingly
collect data from children.

## 8. Contact

For privacy inquiries or to exercise your GDPR rights, join our
[Discord server](https://discord.gg/visentrix) or submit a ticket via the support
section on our home page.

---

© 2026 Visentrix. All rights reserved.
