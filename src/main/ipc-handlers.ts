import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { IPC } from '@shared/ipc'
import { TileCache } from './services/tile-cache'
import { getSceneContext, updateSceneContext } from './services/scene-context'
import { broadcastToWindows } from './windows'
import { chat as ollamaChat, vision as ollamaVisionRaw, checkHealth as ollamaHealth, type ChatResult } from './services/ollama-service'
import {
  createSession, getSession, destroySession, chatWithTools, analyzeViewport,
  checkAIHealth, registerTools, resolveToolCall, rejectToolCall, getRegisteredTools,
} from './services/ai-bridge'
import type { ToolDefinition } from './services/ollama-service'
import { getTleStrings } from './services/live/satellites'
import { searchSentinelScenes, GIBS_LAYERS } from './services/sentinel-service'
import { sampleElevation, elevationProfile } from './services/dem-service'
import { analyzeSlopeArea } from './services/slope-service'
import { analyzeAnomalyArea } from './services/anomaly-service'
import { generateSearchZones } from './services/search-service'
import { findRestPoints } from './services/rest-service'
import { planRoute } from './services/route-service'
import { analyzeFallRisk } from './services/fall-risk-service'
import { analyzeRunoff } from './services/runoff-service'
import { analyzeRemainsCorridor } from './services/remains-corridor-service'
import { analyzeCanopy } from './services/canopy-service'
import { runBehaviorEngine } from './services/behavior-engine'
import { fetchWaterFeatures } from './services/water-service'
import { fetchRoads } from './services/road-service'
import { fetchInfrastructure } from './services/infrastructure-service'
import { fetchRadarData, fetchWeather, fetchRainfallForBbox } from './services/weather-service'
import { checkClipHealth, embedText, embedImage, similarity } from './services/clip-service'
import { webSearch } from './services/web-search-service'
import { toGeoJSON, toKML } from './services/export-service'
import { parseKmlFile } from './services/import-service'
import { CASE_PROFILES, getCaseProfile } from './services/case-profiles'
import { deriveTripParams, computeSearchRadii, DEFAULT_TRIP_PARAMS } from './services/trip-params'
import { calibrateHiker, maxReachRadius, beyondLkpSearchCone } from './services/hiker-profile'
import { ensureBathymetryGrid, getOceanDepth } from './services/climate/bathymetry-cache'
import { classifyRegion } from './services/climate/region-classification'
import { getAircraftFeatures } from './services/live/aircraft'
import { getFireFeatures } from './services/live/fires'
import { getVesselFeatures } from './services/live/vessels'
import { getLightningFeatures } from './services/live/lightning'
import { climateMonitor } from './services/climate/climate-monitor'
import { predictionEngine } from './services/prediction/prediction-engine'
import { gridMonitor } from './services/grid/grid-monitor'
import { networkMonitor } from './services/network/network-monitor'
import { VPNDetector } from './services/network/vpn-detector'
import { GeoIPService } from './services/network/geoip'
import { SpeedTestService } from './services/network/speed-test'
import { DNSTestService } from './services/network/dns-test'
import { stormsToWeatherEvents, lightningToWeatherEvents } from './services/grid/weather-grid-influence'
import { generateSeismicGridAlerts } from './services/grid/seismic-grid-influence'
import { generateSpaceWeatherGridAlerts } from './services/grid/space-weather-grid-influence'
import { generateWeatherAircraftAlerts } from './services/grid/weather-aircraft-influence'

export function registerIpcHandlers(): void {
  console.log('[ipc] registering IPC handlers...')
  /* ── App / scene ── */
  ipcMain.handle(IPC.APP_HELLO, () => 'OSINT Sentinel Workstation ready')

  ipcMain.on(IPC.GLOBE_VIEWPORT, (_event, payload) => {
    updateSceneContext({
      camera: {
        center: payload.center,
        height: payload.height,
        heading: payload.heading,
        pitch: payload.pitch,
        roll: payload.roll,
      },
      bbox: payload.bbox,
    })
    broadcastToWindows(IPC.SCENE_CONTEXT_CHANGED, getSceneContext())
  })

  ipcMain.handle(IPC.GET_SCENE_CONTEXT, () => getSceneContext())
  ipcMain.on(IPC.SET_SCENE_CONTEXT, (_event, patch) => {
    updateSceneContext(patch)
    broadcastToWindows(IPC.SCENE_CONTEXT_CHANGED, getSceneContext())
  })

  ipcMain.on(IPC.GLOBE_SET_STACK, (_event, stack) => {
    updateSceneContext({ activeLayers: [stack] })
    broadcastToWindows(IPC.SCENE_CONTEXT_CHANGED, getSceneContext())
  })

  /* ── Tile / offline ── */
  ipcMain.handle(IPC.TILE_REQUEST, async (_event, req) => {
    const buf = await TileCache.get(req.source, req.z, req.x, req.y)
    if (!buf) return null
    // Convert Buffer to ArrayBuffer for IPC transfer to renderer
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
  ipcMain.handle(IPC.GET_OFFLINE_STRATEGY, () => TileCache.getStrategy())
  ipcMain.on(IPC.SET_OFFLINE_STRATEGY, (_event, strategy) => TileCache.setStrategy(strategy))

  /* ── Terrain / SAR analysis ── */
  ipcMain.handle(IPC.DEM_SAMPLE, async (_event, req) => {
    const elevation = await sampleElevation(req.lng, req.lat)
    return { elevation }
  })

  ipcMain.handle(IPC.DEM_PROFILE, async (_event, req) => {
    return elevationProfile(req.coords)
  })

  ipcMain.handle(IPC.SLOPE_ANALYSIS, async (_event, req) => {
    return analyzeSlopeArea(req)
  })

  ipcMain.handle(IPC.ANOMALY_ANALYSIS, async (_event, req) => {
    return analyzeAnomalyArea(req)
  })

  ipcMain.handle(IPC.SEARCH_ZONES, async (_event, req) => {
    return generateSearchZones(req)
  })

  ipcMain.handle(IPC.REST_POINTS, async (_event, req) => {
    return findRestPoints(req)
  })

  ipcMain.handle(IPC.ROUTE_PLAN, async (_event, req) => {
    return planRoute(req)
  })

  ipcMain.handle(IPC.FALL_RISK, async (_event, req) => {
    return analyzeFallRisk(req)
  })

  ipcMain.handle(IPC.REMAINS_CORRIDOR, async (_event, req) => {
    return analyzeRemainsCorridor(req)
  })

  ipcMain.handle(IPC.RUNOFF_ANALYSIS, async (_event, req) => {
    return analyzeRunoff(req)
  })

  ipcMain.handle(IPC.CANOPY_ANALYSIS, async (_event, req) => {
    return analyzeCanopy(req)
  })

  ipcMain.handle(IPC.BEHAVIOR_ENGINE, async (_event, req) => {
    return runBehaviorEngine(req)
  })

  ipcMain.handle(IPC.WATER_FETCH, async (_event, req) => {
    return fetchWaterFeatures(req.bounds)
  })

  ipcMain.handle(IPC.ROAD_FETCH, async (_event, req) => {
    return fetchRoads(req.bounds)
  })

  ipcMain.handle(IPC.INFRA_FETCH, async (_event, req) => {
    return fetchInfrastructure(req.bounds)
  })

  /* ── Satellite imagery (GIBS) ── */
  ipcMain.handle(IPC.SENTINEL_SEARCH, async (_event, req) => {
    return searchSentinelScenes(req)
  })

  ipcMain.handle(IPC.SENTINEL_LAYERS, () => {
    return GIBS_LAYERS
  })

  ipcMain.handle(IPC.SAT_TLE_GET, async () => {
    try {
      const tles = await getTleStrings()
      return { tles, error: undefined }
    } catch (e) {
      return { tles: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  /* ── Weather ── */
  ipcMain.handle(IPC.WEATHER_RADAR, async () => {
    return fetchRadarData()
  })

  ipcMain.handle(IPC.WEATHER_FORECAST, async (_event, point) => {
    return fetchWeather(point)
  })

  ipcMain.handle(IPC.WEATHER_RAINFALL, async (_event, req) => {
    return fetchRainfallForBbox(req.bounds)
  })

  /* ── AI Bridge ── */
  ipcMain.handle(IPC.AI_HEALTH, async () => {
    return checkAIHealth()
  })

  // Create a new AI session
  ipcMain.handle('ai:session:create', async () => {
    const session = createSession()
    return { sessionId: session.id, model: session.model, visionModel: session.visionModel }
  })

  // Destroy an AI session
  ipcMain.handle('ai:session:destroy', async (_event, args) => {
    destroySession(args.sessionId)
    return { ok: true }
  })

  // Get session state
  ipcMain.handle('ai:session:get', async (_event, args) => {
    const session = getSession(args.sessionId)
    if (!session) return { error: 'Session not found' }
    return {
      sessionId: session.id,
      model: session.model,
      visionModel: session.visionModel,
      messageCount: session.messages.length,
      streaming: session.streaming,
    }
  })

  // Chat with tools (streaming via IPC events)
  ipcMain.handle(IPC.AI_CHAT, async (_event, args) => {
    const { sessionId, prompt, image, model } = args
    const result = await chatWithTools(sessionId, prompt, { image, model })
    return result
  })

  // Vision (one-shot viewport analysis)
  ipcMain.handle(IPC.AI_VISION, async (_event, args) => {
    const { prompt, image, model } = args
    return analyzeViewport(image, prompt, model)
  })

  // Register tools from renderer (action-runner)
  ipcMain.handle('ai:tools:register', async (_event, args) => {
    registerTools(args.tools as ToolDefinition[])
    return { count: getRegisteredTools().length }
  })

  // Resolve a tool call (renderer sends back the result)
  ipcMain.handle('ai:tool:resolve', async (_event, args) => {
    resolveToolCall(args.callId, args.result)
    return { ok: true }
  })

  // Reject a tool call (renderer sends back an error)
  ipcMain.handle('ai:tool:reject', async (_event, args) => {
    rejectToolCall(args.callId, args.error)
    return { ok: true }
  })

  // Legacy: keep old AI_CHAT handler for backward compat
  ipcMain.handle('ai:chat:legacy', async (_event, args) => {
    const { prompt, model, context } = args
    const ctx = getSceneContext()
    const sysContext = context ?? JSON.stringify(ctx)
    const fullPrompt = `[scene-context]\n${sysContext}\n\n[user]\n${prompt}`
    try {
      const result: ChatResult = await ollamaChat({
        messages: [{ role: 'user', content: fullPrompt }],
        model,
      })
      return { content: result.content, model: result.model || model || 'unknown', error: undefined }
    } catch (e) {
      return { content: '', model: model || 'unknown', error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.AI_CLIP_HEALTH, async () => {
    return checkClipHealth()
  })

  ipcMain.handle(IPC.AI_CLIP_EMBED_TEXT, async (_event, text: string) => {
    try {
      const embedding = await embedText(text)
      return { embedding, error: undefined }
    } catch (e) {
      return { embedding: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.AI_CLIP_EMBED_IMAGE, async (_event, imagePath: string) => {
    try {
      const embedding = await embedImage(imagePath)
      return { embedding, error: undefined }
    } catch (e) {
      return { embedding: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.AI_CLIP_SIMILARITY, async (_event, a: number[], b: number[]) => {
    try {
      const score = await similarity(a, b)
      return { score, error: undefined }
    } catch (e) {
      return { score: 0, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle(IPC.AI_CLIP_SEARCH, async (_event, args) => {
    const health = await checkClipHealth()
    if (!health.running) {
      return { results: [], error: 'CLIP server not running (start py scripts/clip_server.py)' }
    }
    return { results: [], error: 'CLIP search requires indexed tile images (not yet implemented)' }
  })

  ipcMain.handle(IPC.WEB_SEARCH, async (_event, args) => {
    console.log('[ipc] WEB_SEARCH:', args)
    const ctx = getSceneContext()
    const location = ctx.lkp ?? ctx.camera?.center ?? undefined
    return webSearch(args, location)
  })

  /* ── Export / Import ── */
  ipcMain.handle(IPC.EXPORT_GEOJSON, async (_event, data) => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Export GeoJSON',
      defaultPath: 'analysis.geojson',
      filters: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }],
    })
    if (canceled || !filePath) return null
    const geojson = toGeoJSON(data || {})
    fs.writeFileSync(filePath, geojson, 'utf8')
    return { path: filePath }
  })

  ipcMain.handle(IPC.EXPORT_KML, async (_event, data) => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Export KML',
      defaultPath: 'analysis.kml',
      filters: [{ name: 'KML', extensions: ['kml'] }],
    })
    if (canceled || !filePath) return null
    const kml = toKML(data || {})
    fs.writeFileSync(filePath, kml, 'utf8')
    return { path: filePath }
  })

  ipcMain.handle(IPC.IMPORT_KML, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Import KML / KMZ',
      filters: [
        { name: 'KML/KMZ', extensions: ['kml', 'kmz'] },
      ],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    return parseKmlFile(filePaths[0])
  })

  /* ── Case profiles ── */
  ipcMain.handle(IPC.CASE_PROFILES, async (_event, args) => {
    if (args?.id) {
      return { profile: getCaseProfile(args.id) }
    }
    return { profiles: CASE_PROFILES }
  })

  /* ── Trip params + Hiker calibration ── */
  ipcMain.handle(IPC.TRIP_DERIVE, async (_event, args) => {
    const params = args?.params ?? DEFAULT_TRIP_PARAMS
    const derived = deriveTripParams(params)
    const radii = computeSearchRadii(params)
    return { derived, radii }
  })

  ipcMain.handle(IPC.HIKER_CALIBRATE, async (_event, args) => {
    const profile = args?.profile
    if (!profile) return null
    const derived = deriveTripParams(profile.tripParams)
    const model = calibrateHiker(profile, derived.walkSpeedMps, derived.impassableSlopeDeg)
    const reachRadius = maxReachRadius(model, profile.tripParams.hoursSinceLastSeen)
    const beyondLkpCone = beyondLkpSearchCone(model)
    return { model, reachRadius, beyondLkpCone }
  })

  /* ── Climate helpers (bathymetry + region classification) ── */
  ipcMain.handle(IPC.BATHYMETRY_DEPTH, async (_event, args) => {
    await ensureBathymetryGrid()
    const lat = args?.lat
    const lon = args?.lon
    if (typeof lat !== 'number' || typeof lon !== 'number') return null
    const depth = getOceanDepth(lat, lon)
    return depth === undefined ? null : { depthM: depth }
  })

  ipcMain.handle(IPC.REGION_CLASSIFY, async (_event, args) => {
    const lat = args?.lat
    const lon = args?.lon
    const stationType = args?.stationType
    if (typeof lat !== 'number' || typeof lon !== 'number') return null
    return classifyRegion(lat, lon, stationType)
  })

  /* ── Live feeds (pull-based fallback for plugins) ── */
  ipcMain.handle('live:aircraft', async () => {
    return getAircraftFeatures()
  })
  ipcMain.handle('live:fires', async () => {
    return getFireFeatures()
  })
  ipcMain.handle('live:vessels', async () => {
    return getVesselFeatures()
  })
  ipcMain.handle('live:lightning', async () => {
    return getLightningFeatures()
  })

  /* ── Climate / Ocean ── */
  ipcMain.on(IPC.CLIMATE_SET_VIEWPORT, (_event, bounds) => {
    climateMonitor.setViewportBounds(bounds)
  })
  ipcMain.handle(IPC.CLIMATE_WHITELIST, (_event, stationId: string) => {
    climateMonitor.whitelistStation?.(stationId)
  })
  ipcMain.handle(IPC.CLIMATE_UNWHITELIST, (_event, stationId: string) => {
    climateMonitor.unwhitelistStation?.(stationId)
  })

  /* ── Grid ── */
  ipcMain.handle(IPC.GRID_WHITELIST, (_event, assetId: string) => {
    gridMonitor.whitelistAsset(assetId)
  })
  ipcMain.handle(IPC.GRID_UNWHITELIST, (_event, assetId: string) => {
    gridMonitor.unwhitelistAsset(assetId)
  })
  ipcMain.handle(IPC.GRID_GET_WHITELIST, () => {
    return gridMonitor.getWhitelist()
  })
  ipcMain.handle(IPC.GRID_SET_CROSS_DOMAIN, (_event, enabled: boolean) => {
    gridMonitor.setCrossDomainEnabled(enabled)
  })
  ipcMain.handle(IPC.GRID_GET_CROSS_DOMAIN, () => {
    return gridMonitor.isCrossDomainEnabled()
  })

  /* ── Network ── */
  const geoIP = new GeoIPService()
  const vpnDetector = new VPNDetector(geoIP)
  const speedTestService = new SpeedTestService()
  speedTestService.setOnProgress((progress: number) => {
    broadcastToWindows(IPC.SPEEDTEST_PROGRESS, progress)
  })
  const dnsTestService = new DNSTestService()

  ipcMain.handle(IPC.NET_VPN_REFRESH, async () => {
    try {
      const status = await vpnDetector.detect()
      broadcastToWindows(IPC.NET_VPN, status)
      return status
    } catch (e) {
      console.error('[ipc] VPN detection error:', e)
      return null
    }
  })

  ipcMain.handle(IPC.NET_GEOIP_LOOKUP, async (_event, ip: string) => {
    return geoIP.lookup(ip)
  })

  ipcMain.handle(IPC.NET_SPEEDTEST_RUN, async () => {
    return speedTestService.runSpeedTest()
  })

  ipcMain.handle(IPC.NET_DNSTEST_RUN, async () => {
    return dnsTestService.testAllServers()
  })

  /* ── Cross-domain influence (climate → grid, every 60s) ── */
  const crossDomainTimer = setInterval(() => {
    if (!gridMonitor.isCrossDomainEnabled()) return
    try {
      const storms = climateMonitor.getStorms()
      const lightning = climateMonitor.getLightning()
      const lightningInput = lightning.map((f) => ({
        lat: f.position.lat,
        lon: f.position.lon,
        timestamp: f.freshness,
      }))
      const events = [
        ...stormsToWeatherEvents(storms),
        ...lightningToWeatherEvents(lightningInput),
      ]
      if (events.length > 0) {
        gridMonitor.setWeatherEvents(events)
      }

      const earthquakes = climateMonitor.getEarthquakes() as any[]
      if (earthquakes.length > 0) {
        const eqInput = earthquakes.map((e) => ({
          id: e.id,
          mag: e.mag,
          lat: e.lat,
          lon: e.lon,
          tsunami: e.tsunami,
        }))
        const alerts = generateSeismicGridAlerts(eqInput, gridMonitor.getAssets() as any[])
        for (const alert of alerts) gridMonitor.emit('alert', alert)
      }

      const spaceWx = climateMonitor.getSpaceWeather()
      if (spaceWx) {
        const alerts = generateSpaceWeatherGridAlerts(spaceWx, gridMonitor.getAssets() as any[])
        for (const alert of alerts) gridMonitor.emit('alert', alert)
      }

      const aircraft = climateMonitor.getAircraft()
      if (events.length > 0 && aircraft.length > 0) {
        const aircraftInput = aircraft.map((f) => ({
          icao24: (f.meta.icao24 as string) || f.id,
          callsign: (f.meta.callsign as string) || f.id,
          lat: f.position.lat,
          lon: f.position.lon,
          altitudeFt: f.position.height ? f.position.height * 3.281 : undefined,
          onGround: f.meta.onGround as boolean | undefined,
        }))
        const aircraftAlerts = generateWeatherAircraftAlerts(events, aircraftInput)
        if (aircraftAlerts.length > 0) {
          broadcastToWindows(IPC.AIRCRAFT_WEATHER_ALERTS, aircraftAlerts)
        }
      }
    } catch (e) {
      console.error('[ipc] cross-domain error:', e)
    }
  }, 60_000)

  console.log('[ipc] all IPC handlers registered')
}
