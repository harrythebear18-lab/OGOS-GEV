# Module Survey — OGOS + GEV Reference Repositories

Inventory of capabilities found in both reference repositories, used to determine
plugin priority for the OSINT Sentinel Workstation.

**Reference repos (read-only, never modified):**
- `C:\Users\htsou\CascadeProjects\osint-global-os` (OGOS)
- `C:\Users\htsou\Desktop\gods-eye-view-main` (GEV)

---

## OGOS — Main-Process Services (`src/main/services/*`)

### Terrain / SAR Analysis
| File | Description | External APIs | Complexity |
|---|---|---|---|
| `anomaly-service.ts` | Terrain anomalies (depressions/prominences) via smoothed residual + std-dev clustering | DEM tiles | medium |
| `behavior-engine.ts` | UEBS2-style multi-agent terrain behavior simulation (5,000 agents, A*, hazards, fatigue) | DEM tiles | complex |
| `canopy-service.ts` | Canopy intelligence: NDVI, biome lookup, pseudo-LiDAR ground-height correction | Nominatim, GIBS WMS, web search | complex |
| `fall-risk-service.ts` | Slope/curvature/edge/weather fall-risk grid + convex-hull risk zones | DEM tiles | complex |
| `hiker-profile.ts` | Calibrates hiker behavior (perception, anchors, speed, search cone) | None | medium |
| `remains-corridor-service.ts` | Downhill "remains corridor" from fall point (deposition zones, chokes) | DEM tiles | complex |
| `rest-service.ts` | Rest-point scoring (slope, water, shelter, distance, trails) | OSM Overpass | complex |
| `route-service.ts` | Terrain-aware A* pathfinding with Tobler's hiking function + Catmull-Rom smoothing | OSM Overpass | complex |
| `runoff-service.ts` | Rainfall runoff hydrology: flow paths, pooling, watershed divides, flood risk | DEM tiles | complex |
| `search-service.ts` | Probability-weighted LKP search ring polygons | DEM tiles | medium |
| `slope-service.ts` | Horn's-method slope computation with activity-profile thresholds | DEM tiles | complex |
| `trip-params.ts` | Physiological risk/speed/survival constants from trip parameters | None | medium |

### Globe / Basemap Context
| File | Description | External APIs | Complexity |
|---|---|---|---|
| `dem-service.ts` | DEM tile loading, on-disk cache, GeoTIFF/PNG sampling | AWS Terrarium | complex |
| `dem-tiles.ts` | Terrarium tile URL resolver + Mercator tile math + cache | `s3.amazonaws.com/elevation-tiles-prod/terrarium` | simple |
| `dem-zoom.ts` | Chooses optimal DEM zoom for a bounding box | None | simple |
| `road-service.ts` | Fetches roads/trails from OSM for route-planning | 3× Overpass API | medium |
| `sentinel-service.ts` | NASA GIBS satellite imagery (12 layers) XYZ/WMTS tile resolver | `gibs.earthdata.nasa.gov` | medium |
| `water-service.ts` | Fetches OSM water bodies for rest-point scoring | 3× Overpass API | medium |
| `weather-service.ts` | Weather radar + point forecast | RainViewer, Open-Meteo | medium |

### AI Modules
| File | Description | External APIs | Complexity |
|---|---|---|---|
| `ollama-service.ts` | Local LLM chat, vision, tool definitions, streaming, system prompt builder | `localhost:11434` | complex |
| `clip-service.ts` | CLIP embedding server client (text/image embed, similarity, search) | `localhost:9776` | medium |
| `web-search-service.ts` | Web search aggregator (DuckDuckGo, Wikipedia, NWS alerts, Nominatim) | Multiple | medium |

### Import / Export
| File | Description | Complexity |
|---|---|---|
| `export-service.ts` | GeoJSON / KML analysis exports | medium |
| `import-service.ts` | KML/KMZ file parser for Google Earth projects/waypoints | medium |

### Case / Types
| File | Description | Complexity |
|---|---|---|
| `case-profiles.ts` | Preloaded case scenarios (M Cave / Kenny Veach, Custom) | simple |
| `types.ts` | Service interface contracts and shared service types | simple |

### Climate / Ocean / Prediction
| File | Description | External APIs | Complexity |
|---|---|---|---|
| `climate/bathymetryCache.ts` | ETOPO bathymetry gridded cache | NOAA ERDDAP | simple |
| `climate/climateAnomalyPredictor.ts` | Detects climate anomalies (SST/pressure patterns) | Internal model | medium |
| `climate/climateMonitor.ts` | Live climate/ocean/weather monitor aggregator | Many | complex |
| `climate/climateTypes.ts` | Climate module type definitions | None | simple |
| `climate/dataFetcher.ts` | Argo floats, CO2 moorings, ocean sensor data | NOAA ERDDAP (4 endpoints) | medium |
| `climate/dataFlowMonitor.ts` | Tracks data-source freshness / pipeline integrity | None | medium |
| `climate/heuristicWatchdog.ts` | Heuristic checks for suspicious climate data | None | medium |
| `climate/httpUtil.ts` | Shared HTTP fetch utility with timeout/retry | None | simple |
| `climate/oceanAtmosphereCoupler.ts` | Ocean-atmosphere coupling / ENSO detection | Internal model | medium |
| `climate/predictionEngine.ts` | Orchestrates 7-model prediction engine | Internal | complex |
| `climate/predictionTypes.ts` | Prediction engine type definitions | None | simple |
| `climate/radarNowcastPredictor.ts` | Short-term precipitation nowcast | Internal model | medium |
| `climate/regionClassification.ts` | Climate/ocean region classification | None | simple |
| `climate/resultsVerifier.ts` | Cross-source statistical verification | None | medium |
| `climate/sensorFailurePredictor.ts` | Predicts which sensors are likely to fail | Internal model | medium |
| `climate/sensorVerifier.ts` | Per-sensor sanity / range verification | None | medium |
| `climate/severeWeatherPredictor.ts` | Severe weather risk prediction | Internal model | medium |
| `climate/stormTrackPredictor.ts` | Tropical / severe storm track prediction | Internal model | medium |
| `climate/vesselFetcher.ts` | AIS vessel position fetcher | `axiomoverwatch.io` | simple |
| `climate/weatherFetcher.ts` | **Mega fetcher**: METAR, NDBC, NHC, NWS, XWeather, Meteomatics, Blitzortung, OpenSky, USGS, NOAA SWPC, NASA FIRMS | 10+ endpoints | complex |

### Power Grid
| File | Description | Complexity |
|---|---|---|
| `grid/assetVerifier.ts` | Verifies grid asset metadata | medium |
| `grid/dataFetcher.ts` | Grid asset data fetcher | medium |
| `grid/dataFlowMonitor.ts` | Grid data-flow integrity monitor | medium |
| `grid/gridData.ts` | Grid data store / in-memory database | medium |
| `grid/gridDataUtils.ts` | Grid data processing utilities | simple |
| `grid/gridMonitor.ts` | Live power-grid monitor; emits updates/alerts/traffic | complex |
| `grid/gridTypes.ts` | Grid module type definitions | simple |
| `grid/heuristicWatchdog.ts` | Heuristic grid anomaly watchdog | medium |
| `grid/resultsVerifier.ts` | Grid result cross-verification | medium |
| `grid/seismicGridInfluence.ts` | Maps seismic events → grid risk alerts | medium |
| `grid/spaceWeatherGridInfluence.ts` | Maps space weather → grid risk alerts | medium |
| `grid/weatherAircraftInfluence.ts` | Maps severe weather → aircraft alerts | medium |
| `grid/weatherGridInfluence.ts` | Maps weather events → grid risk alerts | medium |

### Network Telemetry
| File | Description | External APIs | Complexity |
|---|---|---|---|
| `network/bandwidthMonitor.ts` | Per-process bandwidth usage | None | medium |
| `network/dnsTest.ts` | DNS resolution test | DNS servers | medium |
| `network/faultDetector.ts` | Network faults via ping/curl probes | `ip-api.com` | medium |
| `network/geoip.ts` | GeoIP lookup/caching for remote IPs | `ip-api.com` | medium |
| `network/networkMonitor.ts` | Live network connection/health/outage monitor | OS native | complex |
| `network/networkTypes.ts` | Network module type definitions | None | simple |
| `network/notificationService.ts` | Email/SMS alert dispatch | SMTP/Twilio | medium |
| `network/qualityMonitor.ts` | Connection quality / latency monitor | None | medium |
| `network/speedTest.ts` | Internet speed-test runner | Speed-test endpoint | medium |
| `network/vpnDetector.ts` | Detects VPN use by comparing public IPs | `ipify.org`, `ip-api.com` | medium |

### OGOS Renderer Components
| File | Description | Complexity |
|---|---|---|
| `App.tsx` | Root 3-column layout (sidebar, map, AI bottom-bar, right panel) | medium |
| `components/AIChatPanel.tsx` | AI analyst chat, model picker, tool-call parsing, streaming | complex |
| `components/AnalysisPanel.tsx` | Sidebar controls for every terrain/SAR analysis type | complex |
| `components/CaseProfilePanel.tsx` | Preloaded case loader (M Cave / Custom) + marker dispatch | simple |
| `components/ClimateIntegrityPanel.tsx` | Climate data verification/invalidation dashboard | medium |
| `components/CollapsiblePanel.tsx` | Generic sidebar collapsible section wrapper | simple |
| `components/DrawTools.tsx` | Floating map-drawing toolbar (bbox, polygon, line, weather pin, 3D/hillshade) | simple |
| `components/ElevationProfile.tsx` | SVG elevation profile chart along a drawn line | medium |
| `components/ExplainabilityOverlay.tsx` | AI-suggested search zones with confidence colors | medium |
| `components/GlobalLayerPanel.tsx` | Toggles for all live global overlay groups | medium |
| `components/GlobalOverlays.tsx` | Renders all 19+ live OSINT layers on MapLibre | complex |
| `components/HypothesisPanel.tsx` | Structured AI-generated search hypotheses with zones | medium |
| `components/IncidentPanel.tsx` | "Fall → Flow → Find" incident analysis pipeline controls | medium |
| `components/LayerSwitcher.tsx` | Basemap/overlay visibility + opacity controls | medium |
| `components/MapCanvas.tsx` | Mounts MapLibre, handles drawing, events, LKP/end-point placement | complex |
| `components/MapOverlays.tsx` | Renders all terrain/SAR analysis results as MapLibre layers | complex |
| `components/MapProvider.tsx` | React context owning the MapLibre instance and selection state | medium |
| `components/MarkerLayer.tsx` | Unified LKP/end/fall/weather/custom marker layer with popups | medium |
| `components/PredictionPanel.tsx` | 7-model prediction engine display dashboard | medium |
| `components/RightPanel.tsx` | 16-tab right-side dashboard (Weather, Grid, Net, Health, etc.) | complex |
| `components/SearchBox.tsx` | Nominatim place-name search + direct coordinate entry | simple |
| `components/SettingsPanel.tsx` | App settings (thresholds, weights, units, cache) | simple |
| `components/Sidebar.tsx` | Left sidebar shell with collapse and clear-map actions | simple |
| `components/TripParamsPanel.tsx` | Trip parameter form (pace, pack, weather, physiology) | simple |
| `components/WeatherPanel.tsx` | RainViewer radar + Open-Meteo forecast display | medium |

### OGOS Hooks
| File | Description |
|---|---|
| `hooks/useAnalysis.ts` | Wraps all analysis IPC calls (slope, search, route, canopy, etc.) |
| `hooks/useClimateData.ts` | Climate live-data IPC updates |
| `hooks/useGeocode.ts` | Nominatim geocoding |
| `hooks/useGridData.ts` | Grid live-data IPC updates |
| `hooks/useMap.ts` | Map context (selection, draw mode, LKP, 3D/hillshade) |
| `hooks/useNetworkData.ts` | Network live-data IPC updates |

---

## GEV — Data Modules (`src/data/*`)

### Live Data Layers
| File | Description | Complexity |
|---|---|---|
| `manager.js` (`DataLayerManager`) | Central registry/lifecycle for all real-time data overlays | High |
| `layerState.js` | Durable layer on/off/options state, share-link codec, localStorage | High |
| `flights.js` | Live OpenSky ADS-B flight tracking: billboard fleet, dead reckoning, click-to-track, 3D models, trails | High |
| `militaryFlights.js` | Live adsb.lol military aircraft layer: amber chevron billboards | High |
| `aisLiveVessels.js` | Live AIS vessel tracking: chevron sprites, MMSI reconciliation, trails | High |
| `traffic.js` | Animated street-traffic dots along OSM roads, optional TomTom congestion flow | High |
| `cctv.js` | CCTV camera data layer: catalog, projections into 3D city, viewshed, calibration | High |
| `radio.js` | Internet radio station directory/player; Radio Browser broker, globe markers | Medium |
| `bikeshare.js` | GBFS bikeshare station overlay with real-time availability | Medium |
| `earthquakes.js` | USGS 24h M2.5+ earthquake ground-discs | Medium |
| `satellites.js` | CelesTrak TLE SGP4 satellite orbits, ISS, tracking, dense mode | High |
| `rocketLaunches.js` | Space-mission roster / launch schedule layer and UI | Medium |
| `militaryAwareness.js` | Contacts context engine: 250 km awareness roster of flights, vessels, installations | High |
| `militaryInstallations.js` | Mapped military installations from Overpass/Google places, color-coded by class | High |
| `firmsHeatmap.js` | NASA FIRMS active-fire heatmap layer | Medium |
| `telegeographySubmarineCables.js` | Submarine cable and landing-point layer | Medium |
| `localLayers.js` | Registry of bundled/local data layers (datacenters, dams, submarine cables, FIRMS fires) | Low |
| `localGeojson.js` | Generic Cesium GeoJSON/overlay renderer for local infrastructure layers | Medium |

### Aircraft Support Modules
| File | Description | Complexity |
|---|---|---|
| `adsbLolFallback.js` | Fallback OpenSky provider via adsb.lol | Low |
| `aircraftClass.js` | Aircraft type classification, 2D/3D scale, model URL mapping | Medium |
| `aircraftIcons.js` | SVG aircraft category billboard icons | Low |
| `aircraftMeta.js` | Flight metadata formatting (velocity, altitude, callsign) | Low |
| `aircraftNearbyPolicy.js` | Proximity inclusion policy for loaded aircraft/models | Low |
| `aircraftRecession.js` | Visual recession/LOD styling for aircraft billboards and 3D models | Medium |
| `motionModel.js` | Aircraft dead-reckoning, kinematics and course smoothing | High |
| `routePlausible.js` | ADSBDB route plausibility validation | Medium |

### AIS Support Modules
| File | Description | Complexity |
|---|---|---|
| `aisStreamAdapter.js` | AIS live socket/transport adapter | Medium |
| `aisWatchdog.js` | AIS connection health watchdog | Low |
| `vesselLabels.js` | AIS type formatting and shared vessel label policy | Medium |

### CCTV Support Modules
| File | Description | Complexity |
|---|---|---|
| `cctvCards.js` | CCTV ambient screen-space thumbnail card policy | Medium |
| `cctvGizmo.js` | Direct-manipulation calibration gizmo for CCTV poses | High |
| `cctvLod.js` | Ambient CCTV card selection / LOD policy | Medium |
| `cctvViewshed.js` | CCTV viewshed coverage volume rendering | High |

### Detection / Tracking / Overlay
| File | Description | Complexity |
|---|---|---|
| `detection.js` | Universal detection overlay: screen-space bounding boxes/IDs on tracked objects | High |
| `detectionCohort.js` | Bounded cohort / selection logic for detection overlay | Medium |
| `detectionDraw.js` | Renderer-agnostic detection drawing helpers | Medium |
| `detectionPolicy.js` | Detection density, profile and allocation-strategy helpers | Medium |
| `detectionPresentation.js` | Detection overlay canvas composite presentation | Medium |
| `detectionRenderDemand.js` | Screen-space demand / label budget for detection | Medium |
| `trackedCamera.js` | Camera follow logic for tracked contacts | High |
| `trackedModelRegime.js` | 3D model scale/coverage regime for tracked contacts | Medium |
| `trackedReadout.js` | Tracked-target world-overlay card bridge | Medium |
| `trackingClickGesture.js` | Click-to-track selection gesture logic | Medium |
| `trailRenderer.js` | Shared track-history polyline trail renderer | Medium |

### Cross-Layer Contracts
| File | Description | Complexity |
|---|---|---|
| `pickRegistry.js` | Cross-layer pick/selection ownership registry | Medium |
| `contextStore.js` | Shared tracked-subject context across layers | Medium |
| `spriteOrder.js` | Cross-layer billboard/primitive draw-order management | Medium |
| `dataCredits.js` | Layer attribution strings and credit registration | Low |
| `labelArbiter.js` | Ambient label placement/collision arbitration | High |
| `groundFloor.js` | Ground/terrain floor sampling and caching for contacts | High |
| `groundSnap.js` | One-shot ground snap for 3D models and billboards | Medium |
| `iconOrientation.js` | Billboard screen rotation, horizon culling, camera pose signature | High |
| `focusDeemphasis.js` | Focus de-emphasis for non-target sprites | Medium |
| `analystEngine.js` | Camera-derived spatial analyst context (view radius, bounds) | Medium |
| `regionalBrief.js` | Regional weather, news, and local info for cockpit | Medium |
| `terrainHeights.js` | Terrain height sampling | Medium |
| `terrainHeightsProxy.js` | Proxy/cached terrain height provider | Low |
| `geoid.js` | EGM2008/EGM96 geoid height lookups | Medium |

### Traffic Support
| File | Description | Complexity |
|---|---|---|
| `flowMatch.js` | Match TomTom flow congestion to Overpass road polylines | High |
| `flowTiles.js` | TomTom flow vector-tile client and MVT decoder | High |
| `tomtomTiles.js` | TomTom traffic-flow tile math and budget accounting | Medium |
| `trafficBounds.js` | Viewport fetch-bounds math for traffic | Low |
| `trafficFlowStyle.js` | Traffic flow bucket/color/speed/density helpers | Low |
| `trafficPresetStyle.js` | Preset-aware traffic dot styling lookup tables | Low |
| `trafficQueue.js` | Platoon/queue spawn math for jammed roads | Low |

### Misc
| File | Description | Complexity |
|---|---|---|
| `naturalEarthRegions.js` | Natural Earth region boundaries layer | Low |
| `neighborhoodPolygons.js` | Neighborhood boundary polygon overlay | Low |
| `issPass.js` | ISS pass/next-overhead prediction utilities | Low |
| `satelliteClass.js` | Satellite category metadata and legend styling | Low |
| `militaryAwarenessEngine.js` | Awareness math and label formatting helpers | Medium |
| `militaryInstallationData.js` | Overpass data parsing for military installations | Medium |
| `militaryRegistry.js` | Known-military ICAO24 registry and flight queries | Low |
| `tr3bRegistry.js` | TR-3B "black-triangle" Easter-egg contact conversion | Low |
| `renderAltitude.js` | Altitude pick/rendering helpers | Low |
| `retryableLoad.js` | Cached one-shot bundled-data loader | Low |
| `scenePick.js` | Scene picking / hit-test helpers | Low |
| `directionText.js` | Cardinal/intercardinal direction text formatting | Low |
| `radioCountry.js` | Country code normalization for radio stations | Low |

---

## GEV — UI / Camera / Scene

### UI Controller
- `ui.js` (`StyleManager`) — orchestrates all DOM panels, visual presets, post-processing, layer toggles, radio, CCTV, context, scenes, share links, style-parameter sliders. **High**

### HTML Panels
| Panel | What it does |
|---|---|
| `#top-center-actions` | Clear layers, share link, reset to globe |
| `#pp-toggles` | DISPLAY rail: HUD, DETECT, 3D, Scope, Celestial, Clean UI, Bloom, Sharpen |
| `#control-panel` | Visual presets: Normal/CRT/NVG/FLIR/Anime/Noir/Snow, map-source chips |
| `#location-bar` | LOCATION: city pills, POI row, search box |
| `#data-panel` | DATA LAYERS: toggles built by DataLayerManager |
| `#cctv-panel` | CCTV: enable, nearest/prev/next, camera select, focus, coverage, auto-hop, projection, gizmo, calibration |
| `#scene-panel` | SCENES: recipe select/new/delete, capture/update shot, start/stop, next, export/import/run log |
| `#global-context-panel` | CONTEXT: Contacts / Space Missions tabs, cockpit entry, search nearby, TR-3B, military awareness, radio |
| `#cockpit-hud` | First-person aircraft view: visor, pitch/roll rails, speed/altitude rims, compass, route chevron, briefing carousel |
| `#view-switcher` | Reset globe / exit cockpit buttons |

### Camera / Scene / Cinematic
| File | Description | Complexity |
|---|---|---|
| `camera.js` | Camera presets (`austin`, `sf`, `nyc`) and `flyToPreset` helpers | Low |
| `cameraVerbs.js` | Cinematic camera verbs: orbit, pan, tilt, dolly, `fly_route`, `once`/`continuous` nudges | High |
| `scenes/director.js` (`SceneDirector`) | Deterministic cinematic playback engine: projects, shot lists, camera flights, hold pauses, JSON export/import | High |
| `scenes/recipes.js` | Built-in social-clip recipes (flights radar, orbital watch, thermal threats) | Medium |
| `scenes/scenePolicy.js` | Shot playback policy: tracking/selection params, layer reconcile rules | Medium |
| `cockpitTracking.js` | Enter/exit aircraft cockpit first-person camera mode | High |

### Supporting UI
- `hud.js` — full-screen intelligence HUD (MGRS, GSD, NIIRS, classification banners, layouts: tactical/operator/minimal). **Medium**
- `overlays/worldOverlay.js` — shared screen-space canvas scheduler for world-anchored labels/cards/detection. **High**
- `overlays/worldOverlayDraw.js` — overlay projection/paint implementation. **High**
- `overlays/worldOverlayTokens.js` — overlay style/token constants. **Low**
- `firstRunExperience.js` — mission launcher card (Live Contacts, Space, Environmental, Explore). **Medium**
- `loadingFeedback.js` — global/feed loading status and traffic sync feedback. **Medium**
- `voice/gevRealtime.js` — real-time voice AI controller / pill UI. **High**
- `voice/gevActions.js` — voice action handlers. **High**
- `voice/voiceCost.js` — live voice cost readout. **Low**
- `splitFlap.js` — split-flap display helper. **Low**
- `mapStackController.js` — map source switching (Google 3D Tiles / OSM fallback). **Medium**
- `renderGovernor.js` — idle render mode governor (ref-counted holds). **High**

### VR / WebXR / OpenXR in GEV
- **Only VR reference**: `src/main.js:102` — `vrButton: false` passed to `Cesium.Viewer` constructor.
- **No WebXR, OpenXR, `navigator.xr`, `XRSession`, or immersive-mode code** found anywhere.
- VR is explicitly disabled.

---

## Module Priority Synthesis

Based on what both repos rely on most heavily:

### Tier 1 — Core World Intelligence
1. **Weather** (Radar + Clouds + Wind) — backbone of world context
2. **Earthquakes** (USGS) — low-volume, high-value, both repos use it
3. **Slope Bands** (DEM analysis) — first analysis plugin, terrain understanding
4. **Hydrology** (water, runoff, flow) — terrain + water = core world logic

### Tier 2 — Movement & Behaviour
5. **Routes** (least-cost path) — SAR + entity movement
6. **Canopy / Vegetation** — movement prediction + hazard
7. **Behavior Engine** — engine starts "thinking"

### Tier 3 — Live Feeds
8. **Fires** (FIRMS)
9. **Aircraft** (ADS-B)
10. **Vessels** (AIS)
11. **Lightning**

### Tier 4 — AI & Vision
12. **CLIP** (tile embeddings + similarity search)
13. **Qwen-VL / Ollama Vision** (scene-aware analysis)
14. **Web Search** (intelligence augmentation)

### Tier 5 — Mission Logic
15. **Search Zones**
16. **Rest Points**
17. **Fall Risk**
18. **Case Profiles**
19. **Export/Import**
20. **Climate Monitoring**

### Cross-Cutting (from GEV)
- **Detection overlay** (screen-space bounding boxes on tracked objects)
- **HUD overlay** (MGRS, GSD, NIIRS, classification banners)
- **World overlay** (shared canvas for labels/cards/detection)
- **Render governor** (idle render mode — needs camera-aware fix)
- **Cinematic camera** (scene director, camera verbs, cockpit mode)
