# Visentrix Three-Layer Licensing Model

**Version 1.0 — August 2026**

The OSINT Sentinel Workstation uses a three-layer licensing model that
protects the core compute engine while keeping the cockpit open for
community growth and plugin development.

---

## Overview

```
┌─────────────────────────────────────────────────────┐
│  Layer 3 — PLUGINS (Hybrid)                        │
│  Community, commercial, private, mission plugins    │
│  Link to Cockpit API, not Core Engine               │
│  License: VPL (LICENSE.plugins)                     │
├─────────────────────────────────────────────────────┤
│  Layer 1 — COCKPIT (Open Source)                    │
│  Electron shell, Cesium globe, plugin manager,      │
│  UI panels, draw tools, analyst, HUD, live feeds    │
│  License: VOC-L (LICENSE.cockpit) — MIT-like         │
├─────────────────────────────────────────────────────┤
│  Layer 2 — CORE ENGINE (Proprietary)                │
│  HAL, WebGPU, worker pool, streaming I/O,           │
│  WebCodecs, prediction engine, native bridges       │
│  License: VCE-L (LICENSE.core) — All rights reserved│
└─────────────────────────────────────────────────────┘
```

---

## Layer 1 — Visentrix Open Cockpit License (VOC-L)

**File:** `LICENSE.cockpit`

**Status:** Open source (MIT-like)

**Covers:**
- Electron application shell and window management
- CesiumJS globe integration and rendering
- Plugin manager and plugin lifecycle
- UI panels (HUD, layer panel, inspector, status bar, draw tools)
- Basic plugins (earthquakes, weather, satellites, vessels, aircraft, fires, lightning, network, grid, etc.)
- Analyst engine (query engine, action runner, context store, annotation resolver, detection overlay)
- World overlay and world overlay layer
- Live feed wiring (USGS, OpenSky, FIRMS, RainViewer, Open-Meteo, AIS, Blitzortung, NHC, ERDDAP, SWPC, CelesTrak)
- Routing and hydrology UI
- AI console (chat panel, vision panel)
- Privacy toggle and security model UI
- Documentation (README, BUILD_PLAN, MODULE_SURVEY, etc.)

**Why open:**
- Encourages adoption and forks
- Encourages plugin development
- Encourages community contributions
- Makes the workstation visible and useful
- The cockpit is useful even without the Core Engine

**What you can do:**
- Use, copy, modify, merge, publish, distribute, sublicense, sell
- Fork and rebrand the cockpit
- Build plugins on top of it

---

## Layer 2 — Visentrix Core Engine License (VCE-L)

**File:** `LICENSE.core`

**Status:** Proprietary (all rights reserved)

**Covers:**
- Hardware Abstraction Layer (HAL)
  - WebGPU compute kernels (WGSL shaders: dem-slope, dem-hillshade, ndvi, ndwi, nbr, anomaly, color-transform)
  - Worker thread pool (`src/main/services/hal/worker-pool.ts`)
  - Worker scripts (`src/main/services/hal/workers/`)
  - Streaming I/O pipelines (`src/main/services/hal/streaming-io.ts`)
  - WebCodecs integration
  - WASM SIMD kernels (future)
  - CUDA native bridges (future)
- Hydrology engine internals (Priority-Flood, runoff simulation)
- Canopy engine internals
- Prediction engine (severe-weather, storm-track, radar nowcast, sensor-failure, ocean-atmosphere coupler)
- Native bridges (OpenXR, CUDA, AVX2/AVX-512, NVENC)
- Heavy compute kernels (DEM slope, hillshade, anomaly, band math)
- GPU kernel compilation and dispatch (`src/renderer/globe/hal/gpu-compute.ts`)
- Multi-node synchronization (future)
- HyperForge integration transport (future)

**Why protected:**
- Prevents commercial theft and repackaging
- Prevents SaaS clones
- Prevents "steal the engine, sell the product"
- Keeps HAL and compute architecture proprietary
- Enables future monetization (HAL Pro, CUDA Pro, VR Pro, mission packs)

**What you can do:**
- Use during the 14-day trial
- Use with a purchased license key (machine-bound)
- Request compute through the Cockpit's public IPC API

**What you cannot do:**
- Copy, distribute, or sublicense the Core Engine
- Reverse engineer, decompile, or disassemble
- Modify or create derivative works
- Use in a commercial SaaS offering
- Bypass license validation or machine fingerprinting

---

## Layer 3 — Visentrix Plugin License (VPL)

**File:** `LICENSE.plugins`

**Status:** Hybrid (open or commercial, at plugin author's choice)

**Covers:**
- Any module that registers with the plugin manager via the `EarthEnginePlugin` lifecycle
- Links to the Cockpit layer (Layer 1) through the public plugin API
- Does not directly call Core Engine (Layer 2) internals

**Permitted:**
- Open-source plugins (MIT, Apache, GPL, etc.)
- Commercial plugins (paid, subscription, one-time)
- Private/internal plugins
- Mission-specific and experimental plugins
- Selling plugins independently of the Core Engine

**Restricted:**
- Plugins that directly import or call Core Engine internal modules
- Plugins that bypass license validation or feature gating
- Plugins that replicate Core Engine compute (HAL, GPU kernels, worker pool)
- Plugins that bundle Core Engine code
- Plugins that create a competing "engine" product

**How plugins get compute:**
Plugins that need heavy compute (DEM analysis, band math, anomaly detection)
must request it through the Cockpit's public IPC API. The Cockpit routes
the request to the Core Engine if a valid license is present. The plugin
itself must not implement or replicate the Core Engine's compute logic.

---

## File-Level Classification

### Open Cockpit (VOC-L)
```
src/main/index.ts                    — Electron main process
src/main/ipc-handlers.ts             — IPC routing (public API)
src/main/windows.ts                  — Window management
src/preload/                         — Preload bridge
src/renderer/globe/App.tsx           — Main app component
src/renderer/globe/Globe.tsx         — Cesium globe
src/renderer/globe/Hud.tsx           — HUD
src/renderer/globe/LayerPanel.tsx    — Layer panel
src/renderer/globe/PluginPanel.tsx   — Plugin panel
src/renderer/globe/DrawTools.tsx     — Draw tools
src/renderer/globe/InspectorPanel.tsx — Inspector
src/renderer/globe/StatusBar.tsx     — Status bar
src/renderer/globe/CockpitShell.tsx  — Shell
src/renderer/globe/PrivacyToggle.tsx — Privacy/security UI
src/renderer/globe/PrivacyPolicyPanel.tsx — Privacy policy
src/renderer/globe/plugins/          — Plugin manager + basic plugins
src/renderer/globe/analyst/          — Analyst engine
src/renderer/globe/WorldOverlay*.tsx — World overlay
src/renderer/globe/AiPanel.tsx       — AI console UI
src/main/services/live/             — Live feed wiring
src/main/services/web-search-service.ts — Web search
src/main/services/ollama-service.ts  — Ollama client
src/main/services/ai-bridge.ts       — AI session management
src/main/services/clip-service.ts    — CLIP client
src/main/services/export-service.ts  — Export
src/shared/                          — Shared types and IPC channels
```

### Core Engine (VCE-L)
```
src/main/services/hal/               — HAL manager, worker pool, streaming I/O
src/main/services/hal/workers/       — Worker scripts
src/renderer/globe/hal/              — WebGPU compute
src/main/services/slope-service.ts   — DEM slope (worker-backed)
src/main/services/runoff-service.ts  — Runoff/Priority-Flood (worker-backed)
src/main/services/anomaly-service.ts — Anomaly detection (worker-backed)
src/main/services/dem-tiles.ts       — DEM tile fetching (streaming I/O)
src/main/services/canopy-service.ts  — Canopy (streaming I/O)
src/main/services/tile-cache.ts      — Tile cache (streaming I/O)
src/main/services/sentinel-service.ts — Sentinel/GIBS imagery
src/main/services/license-manager.ts — License validation
src/main/services/climate/          — Prediction engine, climate monitors
src/main/services/grid/             — Grid monitoring
src/main/services/network/          — Network monitoring
native/openxr-bridge/               — OpenXR native bridge
```

### Plugins (VPL)
```
Any file under src/renderer/globe/plugins/ that implements
EarthEnginePlugin and links only to the Cockpit API.
```

---

## License Enforcement

The Core Engine is gated by the `LicenseManager` (`src/main/services/license-manager.ts`):

- **Trial mode:** 14 days, full Core Engine access
- **Licensed mode:** Machine-bound license key, full access
- **Locked mode:** Trial expired, no license — Cockpit only, no Core Engine compute

The Cockpit always works. The Core Engine requires a valid license.

---

## Monetization Paths

| Tier | Price | Features |
|------|-------|----------|
| Free (Cockpit) | $0 | Globe, basic plugins, live feeds, AI console |
| Pro | $49/yr | + HAL compute, WebGPU, worker pool, prediction engine |
| Enterprise | $499/yr | + CUDA bridge, multi-node sync, HyperForge, priority support |
| Mission Packs | varies | + Specialized plugins (SAR, flood, wildfire, defense) |

---

## Questions?

For licensing inquiries, contact Visentrix via the
[Discord server](https://discord.gg/visentrix).

---

© 2026 Visentrix. All rights reserved.
