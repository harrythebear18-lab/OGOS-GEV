# OSINT Sentinel Workstation — Mid-Build Report

**Date:** 2025-01-15 (updated)
**Repo:** `E:\osint-sentinel-workstation`
**Reference repos:** OGOS (`C:\Users\htsou\CascadeProjects\osint-global-os`), GEV (`C:\Users\htsou\Desktop\gods-eye-view-main`)
**HyperForge (sister project):** `C:\Users\htsou\CascadeProjects\HyperForge` — DX12U engine, Phase 1 complete, future volumetric simulation consumer of Sentinel feeds
**Latest commit:** `dbcdb5e` — Simulate missing data sources + upgrade HUD with MGRS/GSD/NIIRS/classification
**Status:** App launches clean, no React crashes, all live feeds polling, 583 BGC-Argo floats simulated from Argo

---

## 1. Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 32.3.3 |
| Node | 20.18.1 |
| Chromium | 128.0.6613.186 |
| Renderer | React + TypeScript + Vite |
| Globe | Cesium (WebGL, RTX 5060) |
| Local AI | Ollama (qwen2.5vl:7b vision, qwen2.5-coder:7b) |
| CLIP | clip-service on port 9776 |
| VR | OpenXR native bridge (scaffolded, not compiled) |
| External | ERDDAP, USGS, FIRMS, OpenSky, AIS, RainViewer, Open-Meteo, NHC, SWPC, NWS |

---

## 2. Build Plan v0.1–v0.5 — Complete ✅

### v0.1 Core (5 systems) ✅
- Globe renderer (Cesium, Esri imagery, ArcGIS terrain, performance tuning)
- Tile cache service (offline-first, TTL, LRU)
- Scene context (bbox, camera, layers, selection, time range)
- GPU renderer window (deferred stub — Cesium WebGL uses RTX 5060)
- Live feed — satellites (SGP4, CelesTrak TLE, ISS fallback)

### v0.2 Plugin Architecture ✅
- `EarthEnginePlugin` interface (id, name, category, register/unregister/update/getStats)
- Plugin manager with hot-swap lifecycle
- 35 plugins registered across 6 categories

### v0.3 Module Tiers 1–5 ✅
- **Tier 1 (World):** Weather, Earthquakes, Slope, Hydrology
- **Tier 2 (Movement):** Routes (A* + Tobler), Canopy (NDVI), Behavior Engine (5000 agents)
- **Tier 3 (Live):** Fires (FIRMS), Aircraft (OpenSky), Vessels (AIS), Lightning (Blitzortung)
- **Tier 4 (AI):** CLIP, Qwen-VL vision, Web Search (DDG + Wikipedia + NWS)
- **Tier 5 (Mission):** Search zones, Rest points, Fall risk, Case profiles, Export/Import, Climate monitoring

### v0.4 Cockpit Windowing ✅
- CockpitShell (dockable layout, resizable, hide/show)
- PluginPanel (categorized by tier, toggle switches, status dots, stats)
- InspectorPanel (active module details, error display, scene context)
- StatusBar (health, module counts, viewport position, FPS)

### v0.5 Live Feed Hardening ✅
- All Tier 3 feeds polling (aircraft, fires, vessels, lightning, earthquakes, satellites)
- Per-feed broadcast channels (AIRCRAFT_UPDATE, FIRE_UPDATE, etc.)
- Plugin converters for LiveFeature shape
- Pull-based IPC fallbacks

---

## 3. Build Plan v0.6 OGOS Feature Adoption — Complete ✅

### Data Sources (12/12) ✅

| Source | Status | File |
|--------|--------|------|
| NWS METAR | ✅ | `climate/weather-fetcher.ts` |
| NOAA NDBC buoys | ✅ | `climate/erddap-fetcher.ts:fetchNDBC` |
| Argo floats | ✅ | `climate/erddap-fetcher.ts:fetchArgo` |
| **BGC-Argo** | ✅ simulated | `climate/erddap-fetcher.ts:simulateBGCArgo` — derives O2/chl/nitrate/pH from Argo T/S/depth (Garcia-Gordon solubility, lat/season/basin chl model, depth+lat nitrate, thermodynamic pH) — 583 floats from 4049 Argo (15% BGC ratio) |
| GTSPP | ✅ | `climate/erddap-fetcher.ts:fetchGTSPP` |
| TAO/PIRATA | ✅ | `climate/erddap-fetcher.ts:fetchTAO + Currents + Salinity` |
| PMEL CO2 | ✅ | `climate/erddap-fetcher.ts:fetchCO2` |
| NHC storms | ✅ | `climate/storm-fetcher.ts` |
| Space weather (SWPC) | ✅ | `climate/space-weather-fetcher.ts` |
| Bathymetry (GEBCO/ETOPO) | ✅ | `climate/bathymetry-cache.ts` |
| **Aircraft metadata** | ✅ derived | `live/aircraft-metadata.ts` — ICAO24 hex → country (130+ ranges), callsign → airline (50+ IATA), flight type, flight phase, pseudo-registration |
| **Flight tracks** | ✅ derived | `live/aircraft-metadata.ts:updateTrackHistory` — in-memory trail per ICAO24 (30 points, 30-min TTL) |

### Analysis Systems (11/11) ✅

| System | File |
|--------|------|
| Sensor Verifier | `climate/sensor-verifier.ts` |
| Data Flow Monitor | `climate/data-flow-monitor.ts` |
| Results Verifier | `climate/results-verifier.ts` |
| Heuristic Watchdog | `climate/heuristic-watchdog.ts` |
| Prediction Engine (7-model) | `prediction/prediction-engine.ts` |
| Severe Weather Predictor | `prediction/severe-weather-predictor.ts` |
| Storm Track Predictor | `prediction/storm-track-predictor.ts` |
| Radar Nowcast Predictor | `prediction/radar-nowcast-predictor.ts` |
| Sensor Failure Predictor | `prediction/sensor-failure-predictor.ts` |
| Ocean-Atmosphere Coupler | `prediction/ocean-atmosphere-coupler.ts` |
| Region Classification | `climate/region-classification.ts` |
| Climate Anomaly Predictor | `prediction/climate-anomaly-predictor.ts` |

### Grid System (5/5) ✅

| Component | File |
|-----------|------|
| Grid Monitor | `grid/grid-monitor.ts` |
| Seismic Grid Influence | `grid/seismic-grid-influence.ts` |
| Space Weather Grid Influence | `grid/space-weather-grid-influence.ts` |
| Weather-Aircraft Grid Influence | `grid/weather-aircraft-influence.ts` |
| Weather Grid Influence | `grid/weather-grid-influence.ts` |

### Network Monitoring (9/9) ✅

| Component | File |
|-----------|------|
| Bandwidth Monitor | `network/bandwidth-monitor.ts` |
| DNS Test | `network/dns-test.ts` |
| Fault Detector | `network/fault-detector.ts` |
| GeoIP | `network/geoip.ts` |
| Network Monitor | `network/network-monitor.ts` |
| Quality Monitor | `network/quality-monitor.ts` |
| Speed Test | `network/speed-test.ts` |
| VPN Detector | `network/vpn-detector.ts` |
| Notification Service | `network/notification-service.ts` |

### Other Services (5/5) ✅

| Service | File |
|---------|------|
| Hiker Profile | `hiker-profile.ts` |
| Road Service | `road-service.ts` |
| Trip Params | `trip-params.ts` |
| Import Service | `import-service.ts` |
| Remains Corridor | `remains-corridor-service.ts` |

---

## 4. Cross-Cutting Features (from GEV) — 2/4 done

| Feature | Status | Notes |
|---------|--------|-------|
| Detection overlay | ✅ | `plugins/detection-plugin.ts`, `analyst/detection-overlay.ts` |
| HUD: MGRS, GSD, NIIRS, classification banners | ✅ | `Hud.tsx` — MGRS coordinate readout, GSD (Ground Sample Distance), NIIRS (image quality 0-9), classification banners (top + bottom: UNCLASSIFIED // REL TO FVEY) |
| World overlay — shared canvas for labels/cards | ❌ missing | No shared label/card layer |
| Cinematic camera — scene director, camera verbs, cockpit mode | ❌ missing | No scene director, no camera verbs, no cockpit mode |

---

## 5. GEV Features (in MODULE_SURVEY, not in build plan)

These are GEV capabilities documented in `MODULE_SURVEY.md` that were never added to the build plan:

### Live Data Layers — Not Ported

| Feature | GEV File | Status |
|---------|----------|--------|
| Military flights (adsb.lol) | `militaryFlights.js` | ❌ |
| Street traffic (TomTom) | `traffic.js` + 7 support modules | ❌ |
| CCTV cameras | `cctv.js` + 4 support modules | ❌ |
| Internet radio | `radio.js` | ❌ |
| Bikeshare (GBFS) | `bikeshare.js` | ❌ |
| Rocket launches | `rocketLaunches.js` | ❌ |
| Military awareness | `militaryAwareness.js` | ❌ |
| Military installations | `militaryInstallations.js` | ❌ |
| Submarine cables | `telegeographySubmarineCables.js` | ❌ |

### UI / Visual — Not Ported

| Feature | GEV File | Status |
|---------|----------|--------|
| Visual presets (CRT/NVG/FLIR/Anime/Noir/Snow) | `ui.js` StyleManager | ❌ |
| Cockpit HUD (first-person aircraft view) | `#cockpit-hud` | ❌ |
| Scene director (cinematic playback) | `scenes/director.js` | ❌ |
| Camera verbs (orbit, pan, dolly, fly_route) | `cameraVerbs.js` | ❌ |
| Scene recipes (flights radar, orbital watch) | `scenes/recipes.js` | ❌ |

### Tracking / Detection Support — Not Ported

| Feature | GEV File | Status |
|---------|----------|--------|
| Tracked camera (follow logic) | `trackedCamera.js` | ❌ |
| Trail renderer (track history) | `trailRenderer.js` | ❌ |
| Label arbiter (collision) | `labelArbiter.js` | ❌ |
| Ground floor (terrain sampling) | `groundFloor.js` | ❌ |
| Focus de-emphasis | `focusDeemphasis.js` | ❌ |
| Icon orientation (horizon culling) | `iconOrientation.js` | ❌ |
| Regional brief (weather/news) | `regionalBrief.js` | ❌ |
| Geoid (EGM2008) | `geoid.js` | ❌ |

---

## 6. Recent Work

### Commit `90e45e1` — Privacy + AI Mode + Climate Hydration

**Privacy Mode (ported from OGOS)**
- `PrivacyToggle.tsx` — two-step confirmation (type YES → final warning dialog with Cancel/OK)
- Always-visible toolbar button (not buried in NET/GRID sub-panel)
- Privacy ON by default, persists to localStorage
- NetworkGridPanel masks connections, IPs, countries, VPN, location, ISP
- NetworkPlugin hides user-location node and all connection arcs on globe when privacy on

**AI Analysis Mode Toggle (ported from OGOS AIBottomBar)**
- `ACTIVE SAR` / `LEGACY / RESEARCH` toggle in AiPanel header
- Mode-aware system prompt in `ai-bridge.ts:chatWithTools()`
- Mode flows: AiPanel → `ai.chat({mode})` → IPC → `chatWithTools({mode})` → system prompt
- Mode-aware hypothesis generation (2-3 tight vs 4-6 wide)

**Climate Integrity Hydration**
- ClimateMonitor stores `lastIntegrityUpdate`, exposes `getLastIntegrity()`
- New IPC channel `CLIMATE_INTEGRITY_GET_CURRENT`
- ClimateIntegrityPanel requests current state on mount (no more 4-min wait)

**Weather UI**
- Added "GET FORECAST" button to WeatherOverlay

### Commit `dbcdb5e` — Simulated Data Sources + HUD Upgrade

**BGC-Argo Simulator (no external fetch — derives from existing Argo data)**
- `climate/erddap-fetcher.ts:simulateBGCArgo()` — derives biogeochemical measurements:
  - Oxygen: Garcia & Gordon (1992) solubility equation (T, S, depth) + Pacific OMZ modeling
  - Chlorophyll: latitude/season/basin model (polar bloom, oligotrophic gyres, upwelling zones)
  - Nitrate: depth + latitude model (deep/high-lat = high nitrate)
  - pH: thermodynamic from T and S
- 583 BGC floats generated from 4049 Argo floats (15% BGC-equipped ratio, realistic)
- Wired into `climate-monitor.ts:fetchAll()` — runs after Argo fetch, no extra HTTP

**Aircraft Metadata Enrichment (no external fetch — derives from callsign/ICAO24)**
- `live/aircraft-metadata.ts` — new module:
  - ICAO24 hex → country of registration (130+ ICAO allocation ranges)
  - Callsign prefix → airline operator (50+ IATA codes)
  - Callsign pattern → flight type (commercial, cargo, military, general aviation)
  - Altitude/velocity → flight phase (parked, taxi, takeoff, climb, cruise, descent, approach, landed)
  - ICAO24 + country → pseudo-registration (N-, G-, F-, D-, C-F, VH-, JA-, etc.)
  - Track history: in-memory trail per ICAO24 (30 points, 30-min TTL) for flight trails
- `live/aircraft.ts` — calls `enrichAircraftBatch()` on every poll

**HUD Upgrade (ported from GEV concept)**
- `Hud.tsx` — rewritten with:
  - MGRS (Military Grid Reference System) coordinate readout
  - GSD (Ground Sample Distance) — sensor resolution at current altitude
  - NIIRS (National Imagery Interpretability Rating Scale) — image quality 0-9
  - Classification banners (top + bottom: `UNCLASSIFIED // REL TO FVEY`)

---

## 7. VR / OpenXR — Scaffolded, Not Compiled

Architecture:
```
Quest 3S → PC Link → OpenXR Runtime → Native Bridge → Electron → Cesium
```

**Scaffolded files:**
- `native/openxr-bridge/src/xr_bindings.cpp` — N-API entry
- `native/openxr-bridge/src/xr_session.cpp` — OpenXR session lifecycle
- `native/openxr-bridge/src/xr_sharedmemory.cpp` — shared memory transport
- `native/openxr-bridge/src/xr_encoder.cpp` — texture → swapchain
- `native/openxr-bridge/src/xr_decoder.cpp` — pose/input → shared mem
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

## 8. Known Issues (Non-Blocking)

| Issue | Cause | Impact |
|-------|-------|--------|
| ERDDAP/NOAA CoastWatch timeout | External network (UND_ERR_CONNECT_TIMEOUT) | Climate ocean data partial — Argo works, NDBC/TAO/GTSPP fail |
| Bathymetry fetch failed | coastwatch.pfeg.noaa.gov unreachable | Depth checks skipped |
| Aircraft feed rate-limited | OpenSky 400s cooldown | 500 aircraft loaded, refresh delayed |
| DNS resolution failures | Local network fault detector | Network panel shows outages |
| OpenXR native addon not built | `native/openxr-bridge` not compiled | VR degrades gracefully to stub |
| Electron CSP warning | Development mode | Not a crash cause |
| HF Hub unauthenticated | CLIP model download | CLIP still works with cached model |

---

## 9. Plugin Inventory (35 plugins)

### Globe (8)
weather, earthquakes, slope, hydrology, anomaly, canopy, behavior, vision

### Live (5)
aircraft, fires, vessels, lightning, satellites

### Analysis (10)
routes, search-zones, rest-points, fall-risk, remains-corridor, hiker-profile, case-profiles, roads, water, infrastructure

### AI (2)
clip, web-search

### Grid/Climate (5)
grid-assets, climate-stations, space-weather, storms, predictions

### Network (1)
network

### Export (1)
export-import

### VR (1)
vr

### Detection (1)
detection

---

## 10. Remaining Work — Prioritized

### High Priority (build plan gaps)
1. ~~BGC-Argo ERDDAP fetcher~~ ✅ done — `simulateBGCArgo()` derives O2/chl/nitrate/pH from Argo
2. ~~Aircraft metadata + flight tracks~~ ✅ done — `aircraft-metadata.ts` derives country/airline/type/phase/registration + track history
3. ~~HUD upgrade~~ ✅ done — MGRS, GSD, NIIRS, classification banners
4. **World overlay** — shared canvas for labels/cards across plugins
5. **Cinematic camera** — scene director, camera verbs, cockpit mode

### Medium Priority (GEV port candidates)
6. Military flights (adsb.lol amber chevrons)
7. Street traffic (TomTom flow + OSM roads)
8. Tracked camera + trail renderer (track history already exists in `aircraft-metadata.ts` — needs Cesium polyline rendering)
9. Label arbiter (collision management)
10. Visual presets (CRT/NVG/FLIR/Anime/Noir/Snow post-processing)

### Lower Priority (GEV port candidates)
11. CCTV cameras + viewshed
12. Rocket launches
13. Military awareness + installations
14. Submarine cables
15. Bikeshare (GBFS)
16. Internet radio
17. Regional brief
18. Geoid (EGM2008)

### Future (separate project)
- HyperForge integration (volumetric weather, wildfire spread, ocean dynamics, atmospheric particles, orbital sky, infrastructure stress, traffic, climate anomaly, earthquake, procedural cities) — HyperForge exists at `C:\Users\htsou\CascadeProjects\HyperForge`, Phase 1 complete (DX12U renderer), integration via transport bus
- VR compilation (OpenXR native addon)

---

## 11. File Count

- **Main process services:** 50+ files across 7 directories
- **Renderer components:** 30+ files
- **Plugins:** 35 plugins
- **Total source:** ~90+ TypeScript/C++ files

---

## 12. Verification Status

| Check | Status |
|-------|--------|
| TypeScript typecheck | ✅ passes (exit 0) |
| App launches (`npm run dev`) | ✅ clean start |
| React renderer | ✅ no crashes |
| Preload unsubscribe | ✅ no `unsub is not a function` |
| Privacy mode | ✅ ON by default, two-step confirm, map entities hidden |
| AI mode toggle | ✅ Active SAR / Legacy Research, mode-aware prompt |
| Climate integrity hydration | ✅ requests current on mount |
| Live feeds polling | ✅ all 6 feeds active |
| Grid monitor | ✅ 157 assets, 50 alerts |
| BGC-Argo simulation | ✅ 583 floats derived from Argo |
| Aircraft metadata | ✅ country/airline/type/phase/registration derived |
| Aircraft track history | ✅ 30-point trails per ICAO24, 30-min TTL |
| HUD | ✅ MGRS, GSD, NIIRS, classification banners |
| ERDDAP | ⚠️ Argo works, NDBC/TAO/GTSPP timing out (external) |
