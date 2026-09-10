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
- **Live feeds** — SGP4 satellites, ADS-B aircraft, AIS vessels, FIRMS fire detections,
  USGS earthquakes, lightning, NHC storms, space weather, grid assets, network status.
- **Terrain analysis** — DEM, slope bands, anomaly detection (depressions/prominences),
  runoff flow paths, flood risk, watershed divides, rest points, fall risk, canopy.
- **SAR / mission tooling** — search zones, remains corridor (fall → flow → find),
  hiker profile calibration, trip parameter physiology, case profiles, road-aware
  A* routing, GeoJSON/KML/KMZ export and import.
- **OSM vector overlays** — roads, water features (rivers, streams, lakes, springs),
  fetched via Overpass with multi-server fallback.
- **Weather** — RainViewer radar + satellite, Open-Meteo forecast, rainfall integration
  with hydrology.
- **Local AI console** — Ollama (Qwen-VL), CLIP, web search, scene-aware workflows.
- **Offline-first** — tiles and feeds are cached locally; the app runs without a network.

## Tech stack

- **Shell:** Electron 32
- **Build:** electron-vite + Vite 5
- **UI:** React 18 + TypeScript
- **3D globe:** CesiumJS
- **SGP4 / orbital math:** `satellite.js`
- **KML/KMZ:** `@xmldom/xmldom` + `adm-zip`
- **AI:** Ollama (Qwen-VL) + CLIP (local FastAPI)
- **Build output:** `E:/osint-builds/release`

## Project structure

```
osint-sentinel-workstation/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # single-window lifecycle
│   │   ├── ipc-handlers.ts # typed IPC router
│   │   └── services/      # terrain, live feeds, climate, grid, network, AI
│   ├── preload/           # safe IPC bridge (window.api)
│   ├── shared/            # IPC channels + shared types
│   └── renderer/
│       └── globe/         # single 3D Cesium cockpit
│           ├── App.tsx    # cockpit shell + plugin manager
│           ├── Globe.tsx   # Cesium viewer + drawing manager
│           ├── DrawTools.tsx
│           ├── PluginPanel.tsx
│           ├── InspectorPanel.tsx
│           └── plugins/    # 31 Cesium globe plugins
├── native/openxr-bridge/  # future Quest 3S PC Link
├── electron.vite.config.ts
└── package.json
```

## Plugin architecture

All 31 plugins follow a unified interface (`EarthEnginePlugin`):
register / unregister / update / getStats / getControls / onControl.

| Tier | Category | Plugins |
|------|----------|---------|
| 1 — World Intelligence | globe | Weather, Earthquakes, Slope, Hydrology, Water, Roads, Anomaly |
| 2 — Movement & Behaviour | analysis | Routes, Canopy, Behavior, Search Zones, Rest Points, Fall Risk, Remains Corridor, Case Profiles, Hiker Profile |
| 3 — Live Feeds | live | Fires, Aircraft, Vessels, Lightning, Satellites |
| 3b — Climate & Ocean | climate | Climate Stations, Storms, Space Weather |
| 3c — Infrastructure | infrastructure | Grid Assets, Network |
| 4 — AI & Vision | ai | CLIP, Vision, Web Search, Predictions |
| 5 — Mission Logic | export | Export/Import (GeoJSON/KML/KMZ) |
| — | vr | OpenXR / Quest 3S scaffold |

Each plugin auto-activates on the selection bbox or LKP pin, renders Cesium entities,
and exposes controls (toggles, sliders, buttons, displays) in the plugin panel.

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

## Build

```bash
npm run build       # compile to out/
npm run preview     # launch built app
npm run dist:win    # build Windows installer
npm run dist:portable  # portable Windows build
```

## Status

v0.5 — OGOS capability migration complete. All 31 plugins active with UI controls.
See `BUILD_PLAN.md` for implementation phases and `MODULE_SURVEY.md` for the full
capability matrix.
