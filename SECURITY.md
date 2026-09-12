# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest main branch | Yes |
| tagged releases | Yes |
| older versions | No |

We backport security fixes to the latest tagged release. If you are running
an older version, update to the latest release.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability:

1. Join our [Discord server](https://discord.gg/visentrix)
2. Send a direct message to a maintainer with the following:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

You will receive a response within 48 hours. If the vulnerability is
confirmed, we will:

- Acknowledge receipt within 48 hours
- Provide an estimated timeline for a fix within 7 days
- Release a patch and credit you (unless you prefer to remain anonymous)

## Security Model

### Application Security

The OSINT Sentinel Workstation is an Electron application with:

- **Context isolation** enabled (renderer and main are isolated)
- **Node integration** disabled in the renderer
- **Preload bridge** for controlled IPC access
- **Sandbox** enabled for renderer processes
- **CSP** headers set on the renderer

### Privacy and Data Security

- No telemetry is sent unless explicitly enabled by the user
- All cached data (tiles, DEM, analysis) is stored locally
- All AI processing is local (Ollama) — no data leaves the machine
- The 4-stage security model (LOCK / AI / FULL / NET) controls what
  network and location data is visible in the UI
- See `PRIVACY.md` for the full privacy policy

### License Security

- License files are encrypted using the OS secure storage API
- Machine fingerprints use SHA-256 hashes of hardware identifiers
- HMAC tamper detection prevents license file modification
- No personal data is transmitted during license activation

### Third-Party Dependencies

We monitor dependencies for known vulnerabilities:

```bash
npm audit
```

Please report any vulnerable dependencies through the vulnerability
reporting process above.

## Security Best Practices for Users

1. **Keep the app updated** — always run the latest release
2. **Use the LOCK security stage** when not actively analyzing
3. **Do not share your license key** — it is bound to your machine
4. **Review plugin permissions** before installing third-party plugins
5. **Run Ollama locally** — do not expose the Ollama port to the network
6. **Use a VPN** if you are doing sensitive OSINT work

## Contact

For security questions, contact us via our
[Discord server](https://discord.gg/visentrix).

---

© 2026 Visentrix. All rights reserved.
