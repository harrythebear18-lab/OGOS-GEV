# Contributing to the OSINT Sentinel Workstation

Thank you for your interest in contributing! This project uses the
[Visentrix Three-Layer Licensing Model](LICENSING.md). Before contributing,
please understand which layer your contribution falls under.

---

## Which layer am I contributing to?

| What you're building | Layer | License |
|---------------------|-------|---------|
| UI panels, HUD, draw tools, globe rendering | Cockpit (Layer 1) | VOC-L (open) |
| Live feed wiring, export, basic plugins | Cockpit (Layer 1) | VOC-L (open) |
| Documentation, README, guides | Cockpit (Layer 1) | VOC-L (open) |
| WebGPU kernels, worker scripts, HAL internals | Core Engine (Layer 2) | VCE-L (proprietary) |
| Prediction engine, native bridges | Core Engine (Layer 2) | VCE-L (proprietary) |
| New plugins (community, commercial) | Plugins (Layer 3) | VPL (hybrid) |

**Important:** Contributions to the Core Engine (Layer 2) are accepted but
become part of the proprietary Core Engine under the VCE-L license. If you
want your contribution to remain open source, target the Cockpit layer.

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Python 3.11+ (optional, for CLIP server)
- Ollama (optional, for local AI)
- Windows 10/11, macOS, or Linux

### Setup

```bash
git clone https://github.com/harrythebear18-lab/OGOS-GEV.git
cd OGOS-GEV
npm install
npm run copy:cesium
npm run dev
```

### Build

```bash
npm run build          # typecheck + bundle
npm run dist:win       # Windows installer
npm run dist:mac       # macOS installer
npm run dist:linux     # Linux installer
```

### Verify before submitting

```bash
npx tsc --noEmit       # must pass with exit code 0
npm run build          # must succeed
```

---

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use the Bug Report template
3. Include:
   - OS and version
   - Node.js version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots or logs if applicable

### Suggesting Features

1. Check existing issues and the build plan
2. Use the Feature Request template
3. Explain the use case and which layer it belongs to
4. Consider whether it's a plugin or a core feature

### Submitting Pull Requests

1. Fork the repo and create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```
2. Make your changes, following existing code style
3. Run typecheck:
   ```bash
   npx tsc --noEmit
   ```
4. Commit with a clear message:
   ```bash
   git commit -m "Add X to Y because Z"
   ```
5. Push and open a PR using the Pull Request template

---

## Code Style

- TypeScript strict mode
- No `any` types unless absolutely necessary (cast with `as` instead)
- Follow existing naming conventions:
  - camelCase for variables and functions
  - PascalCase for components and classes
  - UPPER_SNAKE_CASE for constants
- Keep functions focused and small
- Add JSDoc comments for public APIs
- Do not remove existing comments unless asked

### Plugin Development

Plugins use the `EarthEnginePlugin` lifecycle:

```typescript
interface EarthEnginePlugin {
  register(ctx: PluginContext): void
  unregister(): void
  update(deltaTime: number): void
  getStats(): Record<string, number>
  getControls(): PluginControl[]
  onControl(id: string, value: unknown): void
}
```

Plugins must link to the Cockpit API only. See `LICENSE.plugins` for
restrictions on accessing Core Engine internals.

---

## Project Structure

```
src/
  main/              Electron main process
    services/        Backend services (feeds, analysis, HAL, license)
      hal/           Hardware Abstraction Layer (Core Engine, Layer 2)
      live/          Live data feeds (Cockpit, Layer 1)
      climate/       Climate/prediction (Core Engine, Layer 2)
    ipc-handlers.ts  IPC routing
  renderer/          React renderer
    globe/           Cesium globe + UI
      hal/            WebGPU compute (Core Engine, Layer 2)
      plugins/        Plugin manager + plugins (Layer 1/3)
      analyst/        Analyst engine (Cockpit, Layer 1)
  preload/           Preload bridge
  shared/            Shared types and IPC channels
native/              Native addons (OpenXR bridge)
```

---

## Questions?

Join our [Discord server](https://discord.gg/visentrix) for help.

---

© 2026 Visentrix. All rights reserved.
