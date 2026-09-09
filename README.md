# OSINT Sentinel Workstation

> An offline-first, multispectral geospatial intelligence workstation.
> Sentinel-2 as the primary globe substrate, with live satellite overlays, SAR/terrain analysis, and a local AI console.

This is not a photorealistic viewer built on Google 3D Tiles.
It is a terrain and signals intelligence platform built on Sentinel-2 multispectral imagery, live public feeds, and local compute.

## What it is

- **Sentinel-2 powered globe** — true multispectral base layer, not just RGB. (GIBS does not expose a Sentinel-2 tile layer in EPSG:3857; the current globe uses a MODIS/VIIRS RGB base until a real Sentinel-2 COG source is wired.)
- **Live satellite overlays** — SGP4 orbits, ADS-B aircraft, AIS vessels, FIRMS fire detections, earthquakes, lightning.
- **SAR/terrain analysis** — DEM, slope, anomaly, route, canopy, behavior simulation, remains corridor.
- **Local AI console** — Qwen-VL, CLIP, local LLM reasoning, tool-calling against the map.
- **GPU renderer window** — HyperForge/SAR fusion and canopy/terrain patches.
- **Offline-first** — tiles and feeds are cached locally; the app runs without a network.

## Tech stack

- **Shell:** Electron 32
- **Build:** electron-vite + Vite 5
- **UI:** React 18 + TypeScript
- **2D map:** MapLibre GL JS
- **3D globe:** CesiumJS
- **SGP4 / orbital math:** `satellite.js`
- **AI:** Ollama (Qwen Coder, Qwen-VL) + CLIP (local FastAPI)
- **Build output:** `E:/osint-builds/release`

## Project structure

```
osint-sentinel-workstation/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # multi-window lifecycle
│   │   ├── ipc-handlers.ts
│   │   └── services/      # terrain, live feeds, sentinel, gpu, ai
│   ├── preload/           # safe IPC bridge
│   ├── shared/            # IPC channels + shared types
│   └── renderer/
│       ├── map/           # 2D MapLibre SAR view
│       ├── globe/         # 3D Cesium Sentinel-2 globe
│       ├── gpu/           # HyperForge/SAR window
│       └── ai/            # AI console
├── electron.vite.config.ts
├── package.json
└── BUILD_PLAN.md
```

## Quick start

Requires Node.js 18+.

```bash
cd E:\osint-sentinel-workstation
npm install
npm run dev
```

This opens the map, globe, GPU, and AI windows. The globe and map use the cached
tile service; the AI console calls Ollama on `localhost:11434`.

## Build

```bash
npm run build       # compile to out/
npm run preview     # launch built app
npm run dist:win    # build Windows installer
```

## Status

This is a scaffold (v0.1.0). See `BUILD_PLAN.md` for the implementation phases.
