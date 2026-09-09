# Build Plan v0.4 — Earth Engine + Plugins + VR + Cockpit UI

Living document. v0.4 adds the cockpit windowing system, fixes live feeds, and completes the native OpenXR bridge architecture.

> **Philosophy:** Flight Sim-level crispness first. Modular plugins second.
> The core must be rock-solid before any analysis/AI/live-feed plugin is re-attached.

---

## v0.1 Core — The 5 Essential Systems (Stable)

### System 1: Globe Renderer (Cesium) ✅
- Cesium Viewer, Esri World Imagery base, GIBS alternatives
- ArcGIS 3D terrain + hillshade + exaggeration
- Intuitive camera controls (left=pan, right=orbit, low inertia)
- Performance tuning: SSE=4, tileCache=500, FXAA, no bloom/SSAO/shadows
- React memoized — camera move does NOT re-render app
- Verbose debug logging reduced

### System 2: Tile Cache Service ✅
- Offline-first, TTL, LRU, multi-source
- IPC tile requests, graceful fallback
- `~/.osint-sentinel-workstation/cache/tiles/`

### System 3: Scene Context ✅
- bbox, camera, active layers, selection, time range
- EventEmitter, IPC channels
- Viewport stored in ref — no React re-render on camera move

### System 4: GPU Renderer Window (Deferred)
- Stub only. Cesium WebGL already uses RTX 5060.
- Native DX/Vulkan for future fusion workloads.

### System 5: Live Feed (Satellites Only) ✅
- SGP4 ISS orbit overlay
- CelesTrak TLE with ISS fallback

---

## v0.2 Plugin Architecture ✅

Every module follows the same interface:
```typescript
interface EarthEnginePlugin {
  id: string
  name: string
  category: 'globe' | 'analysis' | 'live' | 'ai' | 'export' | 'vr'
  register(ctx: PluginContext): void
  unregister(): void
  update?(ctx: PluginContext): void
  getStats?(): PluginStats
}
```

This gives:
- Hot-swappable modules
- Clean detach/attach
- No render tree pollution
- No global state leaks
- Predictable behaviour

Adapted from GEV's `DataLayerManager` pattern.

**Files:**
- `src/renderer/globe/plugins/plugin-manager.ts` — registry + lifecycle
- `src/renderer/globe/plugins/index.ts` — plugin registration
- `src/renderer/globe/plugins/weather-plugin.ts`
- `src/renderer/globe/plugins/earthquakes-plugin.ts`
- `src/renderer/globe/plugins/slope-plugin.ts`
- `src/renderer/globe/plugins/hydrology-plugin.ts`

---

## Module Priority (Based on OGOS + GEV Survey)

Full survey: `MODULE_SURVEY.md`

### Tier 1 — Core World Intelligence ✅ (implemented)
1. **Weather** (RainViewer radar + Open-Meteo forecast) ✅
2. **Earthquakes** (USGS 24h M2.5+) ✅
3. **Slope Bands** (DEM analysis) ✅
4. **Hydrology** (water + runoff) ✅

### Tier 2 — Movement & Behaviour ✅ (implemented)
5. **Routes** (least-cost path, A* + Tobler's hiking function) ✅
6. **Canopy / Vegetation** (NDVI, biome, pseudo-LiDAR) ✅
7. **Behavior Engine** (multi-agent terrain simulation) ✅

### Tier 3 — Live Feeds ✅ (implemented, feeds being hardened)
8. **Fires** (NASA FIRMS VIIRS) ✅ — WFS endpoint + CSV fallback
9. **Aircraft** (OpenSky ADS-B + adsb.lol fallback) ✅ — 500 aircraft loaded
10. **Vessels** (AIS) ✅ — Danish Maritime Authority feed
11. **Lightning** (Blitzortung) ✅ — primary + fallback endpoints

### Tier 4 — AI & Vision ✅ (implemented)
12. **CLIP** (tile embeddings + similarity search) ✅
13. **Qwen-VL / Ollama Vision** (scene-aware analysis) ✅
14. **Web Search** (DuckDuckGo + Wikipedia + NWS) ✅

### Tier 5 — Mission Logic ✅ (implemented)
15. **Search Zones** (LKP probability rings) ✅
16. **Rest Points** (shelter/water scoring) ✅
17. **Fall Risk** (slope + curvature + weather) ✅
18. **Case Profiles** (incident management) ✅
19. **Export/Import** (GeoJSON/KML) ✅
20. **Climate Monitoring** (anomaly prediction) ✅

### Cross-Cutting (from GEV)
- **Detection overlay** — screen-space bounding boxes on tracked objects
- **HUD overlay** — MGRS, GSD, NIIRS, classification banners
- **World overlay** — shared canvas for labels/cards
- **Cinematic camera** — scene director, camera verbs, cockpit mode

---

## VR / OpenXR Integration (Quest 3S via PC Link) — Scaffolded

### Architecture

```
Quest 3S → PC Link (USB/Air Link) → OpenXR Runtime → Native Bridge → Electron → Cesium
```

### Status: Native bridge scaffolded, not compiled

The C++ N-API addon is structured but not built. The app degrades gracefully when the addon is absent.

**Native structure (scaffolded):**
- `native/openxr-bridge/src/xr_bindings.cpp` — N-API entry
- `native/openxr-bridge/src/xr_session.cpp` — OpenXR session lifecycle
- `native/openxr-bridge/src/xr_sharedmemory.cpp` — shared memory transport
- `native/openxr-bridge/src/xr_encoder.cpp` — texture → swapchain
- `native/openxr-bridge/src/xr_decoder.cpp` — pose/input → shared mem
- `native/openxr-bridge/src/include/xr_types.h` — shared structs
- `native/openxr-bridge/src/include/xr_session.h`
- `native/openxr-bridge/src/include/xr_sharedmemory.h`
- `native/openxr-bridge/src/include/xr_encoder.h`
- `native/openxr-bridge/src/include/xr_decoder.h`

**TypeScript integration:**
- `src/main/services/vr/openxr-native-bridge.ts` — native addon wrapper
- `src/main/services/vr/vr-manager.ts` — session lifecycle
- `src/renderer/globe/vr/StereoCameraRig.ts` — dual camera setup
- `src/renderer/globe/plugins/vr-plugin.ts` — EarthEnginePlugin

**Remaining to compile:**
- Install OpenXR SDK + loader on Windows
- Build addon with `node-gyp`
- Validate D3D11 texture interop
- Validate swapchain submission
- Validate hand tracking extension
- Test with Quest 3S PC Link

---

## Open Decisions

- **Sentinel-2 source:** GIBS has no S2 raster in EPSG:3857. Esri World Imagery includes S2 at zoom 13+. Element84 STAC/COG as "Sentinel-2 analysis mode" plugin later.
- **Globe renderer:** CesiumJS for v0.1/v0.2/v0.3/v0.4. Native DX/Vulkan via GPU Renderer Window deferred.
- **GPU path:** Stub only. Cesium WebGL already uses RTX 5060.
- **Terrain:** ArcGIS World Elevation 3D. Terrarium DEM service preserved for analysis plugins.
- **Render governor:** Removed — caused camera jank. Will revisit with camera-aware hold strategy.
- **Live feeds:** All Tier 3 feeds implemented. Aircraft (OpenSky) and earthquakes (USGS) confirmed working. Fires (FIRMS WFS) and lightning (Blitzortung) have endpoint issues being hardened. Vessels (AIS.dk) pending verification.
- **VR:** Quest 3S via PC Link. Native OpenXR bridge scaffolded but not compiled. App degrades gracefully.

---

## v0.4 Cockpit Windowing System ✅

Replaces the flat plugin checkbox list with a proper dockable cockpit shell.

### Architecture

- **CockpitShell.tsx** — dockable panel layout manager
  - Left dock: tabbed LAYERS / PLUGINS
  - Right dock: INSPECTOR
  - Resizable widths (drag handles, 200-500px)
  - Hide/show toggles with edge buttons
  - Bottom status bar (always visible)

- **PluginPanel.tsx** — categorized plugin manager
  - Plugins grouped by Tier (World, Movement, Live, AI, Mission, VR)
  - Collapsible category headers with active counts
  - Plugin cards with toggle switches, status dots, stats, expandable details
  - Error display per plugin

- **InspectorPanel.tsx** — right-side analysis
  - Active module selector
  - Selected module details (name, ID, category, status, entity count)
  - Error display box
  - Scene context summary
  - Auto-refresh toggle (1s polling)

- **StatusBar.tsx** — bottom bar
  - System health indicator (color-coded)
  - Module count (active/total)
  - Health breakdown (nominal/loading/error counts)
  - Viewport position (lat/lng/alt)
  - Real-time FPS counter

### Files
- `src/renderer/globe/CockpitShell.tsx`
- `src/renderer/globe/plugins/PluginPanel.tsx`
- `src/renderer/globe/InspectorPanel.tsx`
- `src/renderer/globe/StatusBar.tsx`
- `src/renderer/globe/App.tsx` — rewritten to use CockpitShell

---

## v0.5 Live Feed Hardening (in progress)

Fixing the data pipeline so all Tier 3 feeds actually load.

### Issues fixed
- **live-data.ts** — was only polling satellites; now polls all feeds (aircraft, fires, vessels, lightning, earthquakes)
- **broadcastDelta** — was only broadcasting to `LIVE_UPDATE`; now also broadcasts to per-feed channels (`AIRCRAFT_UPDATE`, `FIRE_UPDATE`, etc.)
- **Plugin converters** — plugins expected flat feature shapes but received `LiveFeature` with nested `position`/`meta`; added converters in aircraft, fires, vessels, lightning plugins
- **Pull-based IPC handlers** — registered `live:aircraft`, `live:fires`, `live:vessels`, `live:lightning` as fallbacks
- **Fires endpoint** — FIRMS area CSV now requires MAP_KEY; switched to WFS GeoJSON + CSV fallback
- **Lightning endpoint** — Blitzortung API has cert issues; added fallback endpoint

### Verified working
- Aircraft: 500 features from OpenSky ✅
- Earthquakes: 278 features from USGS ✅
- Satellites: ISS fallback (CelesTrak 403) ✅

### Pending verification
- Fires: FIRMS with DEMO_KEY (same as OGOS)
- Vessels: Axiom Overwatch (same as OGOS)
- Lightning: data.blitzortung.org REST (same as OGOS)

---

## v0.6 OGOS Feature Adoption (planned)

OSINT-Global-OS has significantly more capabilities than what we've implemented.
This section catalogs what OGOS has that we need to adopt.

### Data Sources to Add

| Source | Endpoint | Status |
|--------|----------|--------|
| NWS METAR stations | aviationweather.gov/api/data/metar | planned |
| NOAA NDBC buoys | coastwatch.pfeg.noaa.gov/erddap | planned |
| Argo floats | ERDDAP | planned |
| BGC-Argo | ERDDAP | planned |
| GTSPP | ERDDAP | planned |
| TAO/PIRATA | ERDDAP | planned |
| PMEL CO2 | ERDDAP | planned |
| NHC storms | NHC tropical cyclone feeds | planned |
| Space weather (NOAA SWPC) | services.swpc.noaa.gov | planned |
| Aircraft metadata | opensky-network.org/api/metadata | planned |
| Flight tracks | opensky-network.org/api/tracks | planned |
| Bathymetry | GEBCO | planned |

### Analysis Systems to Add

| System | Purpose | Status |
|--------|---------|--------|
| Sensor Verifier | Sensor health, drift detection, calibration | planned |
| Data Flow Monitor | Transmission regularity, missed transmissions | planned |
| Results Verifier | Cross-verification of results | planned |
| Heuristic Watchdog | Anomaly detection in data patterns | planned |
| Prediction Engine | Climate anomaly prediction | planned |
| Severe Weather Predictor | Severe weather prediction | planned |
| Storm Track Predictor | Storm track forecasting | planned |
| Radar Nowcast Predictor | Short-term radar prediction | planned |
| Sensor Failure Predictor | Predict sensor failures | planned |
| Ocean-Atmosphere Coupler | Couple ocean and atmospheric data | planned |
| Region Classification | Classify regions as ocean/land | planned |

### Grid System to Add

| Component | Purpose | Status |
|-----------|---------|--------|
| Grid Monitor | Grid-based monitoring system | planned |
| Seismic Grid Influence | Earthquake influence on grid | planned |
| Space Weather Grid Influence | Space weather influence on grid | planned |
| Weather-Aircraft Grid Influence | Weather impact on aircraft | planned |
| Weather Grid Influence | Weather influence on grid | planned |

### Network Monitoring to Add

| Component | Purpose | Status |
|-----------|---------|--------|
| Bandwidth Monitor | Network bandwidth | planned |
| DNS Test | DNS resolution testing | planned |
| Fault Detector | Network fault detection | planned |
| GeoIP | IP geolocation | planned |
| Network Monitor | Overall network monitoring | planned |
| Quality Monitor | Network quality | planned |
| Speed Test | Network speed testing | planned |
| VPN Detector | VPN detection | planned |
| Notification Service | Notifications | planned |

### Other Services to Add

| Service | Purpose | Status |
|---------|---------|--------|
| Hiker Profile | SAR hiker profiling | planned |
| Road Service | Road data | planned |
| Trip Params | Trip planning | planned |
| Import Service | Data import | planned |
| Remains Corridor | SAR remains corridor analysis | planned |
