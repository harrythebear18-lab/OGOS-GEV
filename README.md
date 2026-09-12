# OSINT Sentinel Workstation

> An offline-first, single-window geospatial intelligence cockpit.
> A 3D Cesium globe at the center, with live satellite overlays, terrain analysis,
> SAR/DEM hydrology, local AI, and mission-grade search-and-rescue tooling.

This is not a photorealistic viewer built on Google 3D Tiles.
It is a terrain and signals intelligence platform built on CesiumJS, live public feeds,
DEM analysis, and local compute — all in one unified cockpit window.

## What it is

- **Single-window cockpit** — one Cesium 3D globe, HUD overlays, left/right dock panels,
  floating draw tools, and a plugin manager. No multi-window sprawl.
- **3D Cesium globe** — Esri imagery base, terrain-aware, with cinematic camera and
  clamped-to-ground overlays. Not a 2D map.
- **Live feeds** — SGP4 satellites, ADS-B aircraft (rate-limited), AIS vessels, FIRMS fire
  detections, USGS earthquakes, Blitzortung lightning (WebSocket, character-based LZW),
  NHC storms, space weather, grid assets, network status.
- **Terrain analysis** — DEM, slope bands, anomaly detection (depressions/prominences),
  runoff flow paths (D8 + Priority-Flood + SCS Curve Number), flood risk (Kirpich time of
  concentration), watershed divides (ridge polylines), rest points, fall risk, canopy.
- **Canopy / vegetation** — GIBS MODIS NDVI 8-day composite, 7-class vegetation mapping
  (dense forest → barren → water), DEM roughness-based canopy height estimation
  (pseudo-LiDAR), convex-hull zone polygons, grid-based spatial clustering.
- **SAR / mission tooling** — search zones, remains corridor (fall → flow → find),
  hiker profile calibration, trip parameter physiology, case profiles, road-aware
  A* routing, GeoJSON/KML/KMZ export and import.
- **OSM vector overlays** — roads, water features (rivers, streams, lakes, springs),
  fetched via Overpass with multi-server fallback and error surfacing.
- **Weather** — RainViewer radar + satellite, Open-Meteo forecast, rainfall integration
  with hydrology (auto-fetch or manual override).
- **Local AI console** — Ollama (Qwen-VL) with tool use, CLIP (local FastAPI on :9776),
  web search, scene-aware workflows, analyst query engine over live data.
- **Analyst architecture** — analyst query engine (filters, spatial scope, follow-up
  queries), action runner (8 LLM-callable tools: fly_to, query_data, select_nearest,
  track_entity, etc.), context store (entity selection + tracking), annotation resolver
  (Nominatim geocode + Overpass footprints), detection overlay (screen-space brackets
  with 4 density modes and 4 visual themes).
- **Offline-first** — tiles and feeds are cached locally; the app runs without a network.

## Tech stack

- **Shell:** Electron 32 (Chromium 128, Node 20)
- **Build:** electron-vite + Vite 5
- **UI:** React 18 + TypeScript
- **3D globe:** CesiumJS
- **GPU compute:** WebGPU (WGSL compute shaders — DEM slope/hillshade, NDVI/NDWI/NBR, anomaly detection)
- **Hardware codecs:** WebCodecs (ImageDecoder, VideoEncoder/Decoder — NVENC/QuickSync)
- **CPU parallelism:** worker_threads + SharedArrayBuffer (worker pool for DEM analysis, prediction)
- **Streaming I/O:** ReadableStream pipelines with backpressure (replaces arrayBuffer bloat)
- **SGP4 / orbital math:** `satellite.js`
- **KML/KMZ:** `@xmldom/xmldom` + `adm-zip`
- **AI:** Ollama (Qwen-VL) + CLIP (local FastAPI, CUDA-backed)
- **Lightning:** Blitzortung WebSocket (character-based LZW decode, UTF-8)
- **Build output:** `E:/osint-builds/release`

## HAL — Hardware Abstraction Layer

The workstation probes and uses real hardware capabilities instead of
JavaScript busywork:

| Subsystem | What it touches | Status |
|-----------|----------------|--------|
| WebGPU compute | GPU cores (NVIDIA/AMD/Intel) — 7 WGSL kernels | active |
| Worker threads | OS threads via worker_threads + SharedArrayBuffer | active |
| Streaming I/O | ReadableStream backpressure, zero-copy SAB transfer | active |
| WebCodecs | Hardware video/image codecs (NVENC/QuickSync/VAAPI) | active |
| WASM SIMD | 128-bit CPU vector units | probed (not yet used) |
| CUDA native | NVIDIA GPU compute (heavy workloads) | deferred |
| OpenXR native | Meta Quest 3S PC Link | scaffold (unbuilt) |

HAL probes on startup:
```
[hal] CPU: 16 cores, 32768/65536 MB free
[hal] Worker threads: yes, SAB: yes
[hal] Renderer: webgpu=true, webcodecs=true, wasmSimd=false
[hal/gpu-compute] WebGPU device: nvidia
[hal/gpu-compute] compiled 7 compute kernels
```

## AI services

The workstation integrates local AI for scene analysis and data queries:

- **Ollama** — `http://localhost:11434` — LLM + vision (Qwen-VL, Qwen-Coder, Llama)
- **CLIP** — `http://localhost:9776` — image/text embeddings via `scripts/clip_server.py`
  (FastAPI + open_clip, CUDA-backed)

To start the CLIP server:

```bash
python scripts/clip_server.py
# or with explicit Python path:
C:\Users\htsou\AppData\Local\Programs\Python\Python313\python.exe scripts/clip_server.py
```

To check AI service status:

```bash
node scripts/check-ai.js
```

## Project structure

```
osint-sentinel-workstation/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # single-window lifecycle
│   │   ├── ipc-handlers.ts # typed IPC router
│   │   └── services/
│   │       ├── hal/       # Hardware Abstraction Layer
│   │       │   ├── hal-manager.ts     # probes CPU/GPU/native/SAB
│   │       │   ├── worker-pool.ts     # worker_threads + SharedArrayBuffer
│   │       │   ├── streaming-io.ts   # ReadableStream pipelines
│   │       │   └── workers/           # CPU worker scripts
│   │       ├── system-verifier.ts     # on-demand health check
│   │       ├── runoff-service.ts    # D8 + Priority-Flood + SCS hydrology
│   │       ├── canopy-service.ts    # GIBS NDVI + DEM roughness canopy height
│   │       ├── ollama-service.ts    # local LLM
│   │       ├── clip-service.ts      # local embeddings
│   │       └── live/                # aircraft, vessels, fires, quakes, etc.
│   ├── preload/           # safe IPC bridge (window.api)
│   ├── shared/            # IPC channels + shared types
│   └── renderer/
│       └── globe/         # single 3D Cesium cockpit
│           ├── App.tsx    # cockpit shell + plugin manager
│           ├── Globe.tsx   # Cesium viewer + drawing manager
│           ├── hal/        # renderer-side HAL
│           │   ├── gpu-compute.ts    # WebGPU compute shaders (WGSL)
│           │   ├── webcodecs.ts      # hardware video/image codecs
│           │   └── index.ts           # HAL init + capability reporting
│           ├── WorldOverlay.ts  # shared HTML card/label layer (globe-occluded)
│           ├── SystemVerifierPanel.tsx
│           ├── DrawTools.tsx
│           ├── PluginPanel.tsx
│           ├── InspectorPanel.tsx
│           ├── analyst/    # GEV-inspired AI architecture
│           │   ├── analyst-engine.ts       # query over live features
│           │   ├── action-runner.ts        # 8 LLM-callable tools
│           │   ├── context-store.ts        # entity selection + tracking
│           │   ├── annotation-resolver.ts   # geocode + OSM footprints
│           │   └── detection-overlay.ts    # screen-space brackets
│           └── plugins/    # 32 Cesium globe plugins
├── scripts/
│   ├── clip_server.py     # CLIP FastAPI server
│   └── check-ai.js        # AI status checker
├── native/openxr-bridge/  # future Quest 3S PC Link
├── electron.vite.config.ts
└── package.json
```

## Plugin architecture

All 32 plugins follow a unified interface (`EarthEnginePlugin`):
register / unregister / update / getStats / getControls / onControl.

| Tier | Category | Plugins |
|------|----------|---------|
| 1 — World Intelligence | globe | Weather, Earthquakes, Slope, Hydrology, Water, Roads, Anomaly |
| 2 — Movement & Behaviour | analysis | Routes, Canopy, Behavior, Search Zones, Rest Points, Fall Risk, Remains Corridor, Case Profiles, Hiker Profile |
| 3 — Live Feeds | live | Fires, Aircraft, Vessels, Lightning, Satellites |
| 3b — Climate & Ocean | climate | Climate Stations (Buoys, Argo, Currents), Storms, Space Weather |
| 3c — Infrastructure | infrastructure | Grid Assets, Network |
| 4 — AI & Vision | ai | CLIP, Vision, Web Search, Detection Overlay, Predictions |
| 5 — Mission Logic | export | Export/Import (GeoJSON/KML/KMZ) |
| — | vr | OpenXR / Quest 3S scaffold |

Each plugin auto-activates on the selection bbox or LKP pin, renders Cesium entities,
and exposes controls (toggles, sliders, buttons, displays) in the plugin panel.

## Hydrology model

The runoff/flood analysis uses proper hydrological methods:

- **D8 flow direction** with diagonal distance correction (√2 factor)
- **Priority-Flood** depression filling (Barnes 2014) — proper spill-point detection
- **Topological sort** flow accumulation — O(n) instead of O(n²)
- **SCS Curve Number** runoff model — realistic infiltration (not 100% rainfall → runoff)
- **Strahler stream ordering** — tributaries vs main channels
- **Kirpich formula** for time of concentration → peak discharge
- **Watershed divides** as actual ridge polylines, not bounding boxes
- **Convex hull** pool polygons from depression clusters

## Quick start

Requires Node.js 18+.

```bash
cd E:\osint-sentinel-workstation
npm install
npm run copy:cesium   # copy Cesium assets to public/
npm run dev
```

This opens the single cockpit window with the 3D globe, plugin panel, and draw tools.
The globe uses cached tiles; the AI console calls Ollama on `localhost:11434`.

For AI features, start Ollama separately:

```bash
ollama serve
ollama pull qwen2.5vl:7b
```

And optionally start the CLIP server for image/text similarity:

```bash
python scripts/clip_server.py
```

## Build

```bash
npm run build       # compile to out/
npm run preview     # launch built app
npm run dist:win    # build Windows installer
npm run dist:portable  # portable Windows build
```

## Status

v0.7 — HAL (Hardware Abstraction Layer): WebGPU compute shaders (7 WGSL kernels
for DEM slope/hillshade, NDVI/NDWI/NBR, anomaly detection), worker_threads +
SharedArrayBuffer pool, streaming I/O with backpressure, WebCodecs hardware
codecs. System Verifier (on-demand health check, privacy-aware). Blitzortung
lightning fixed (UTF-8 character-based LZW decode). Globe occlusion fixed
(WorldOverlay cards + plugin entities no longer show through the globe).

v0.6 — GEV AI architecture ported (analyst engine, action runner, detection overlay,
context store, annotation resolver). Hydrology rewritten with proper D8 + Priority-Flood
+ SCS Curve Number. Canopy rewritten with GIBS NDVI tile fetch + DEM roughness canopy
height. All 32 plugins active with UI controls.

See `BUILD_PLAN.md` for implementation phases and `MODULE_SURVEY.md` for the full
capability matrix.
