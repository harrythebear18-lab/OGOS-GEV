import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { TileCache } from './services/tile-cache'
import { getSceneContext, updateSceneContext } from './services/scene-context'
import { broadcastToWindows } from './windows'
import { chat as ollamaChat, vision as ollamaVisionRaw, checkHealth as ollamaHealth, type ChatResult } from './services/ollama-service'
import { searchSentinelScenes, GIBS_LAYERS } from './services/sentinel-service'
import { sampleElevation, elevationProfile } from './services/dem-service'
import { analyzeSlopeArea } from './services/slope-service'
import { analyzeAnomalyArea } from './services/anomaly-service'
import { generateSearchZones } from './services/search-service'
import { findRestPoints } from './services/rest-service'
import { planRoute } from './services/route-service'
import { analyzeFallRisk } from './services/fall-risk-service'
import { analyzeRunoff } from './services/runoff-service'
import { analyzeCanopy } from './services/canopy-service'
import { runBehaviorEngine } from './services/behavior-engine'
import { fetchWaterFeatures } from './services/water-service'
import { fetchRadarData, fetchWeather } from './services/weather-service'
import { checkClipHealth, embedText, embedImage, similarity } from './services/clip-service'
import { webSearch } from './services/web-search-service'
import { getAircraftFeatures } from './services/live/aircraft'
import { getFireFeatures } from './services/live/fires'
import { getVesselFeatures } from './services/live/vessels'
import { getLightningFeatures } from './services/live/lightning'

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

  /* ── Satellite imagery (GIBS) ── */
  ipcMain.handle(IPC.SENTINEL_SEARCH, async (_event, req) => {
    return searchSentinelScenes(req)
  })

  ipcMain.handle(IPC.SENTINEL_LAYERS, () => {
    return GIBS_LAYERS
  })

  /* ── Weather ── */
  ipcMain.handle(IPC.WEATHER_RADAR, async () => {
    return fetchRadarData()
  })

  ipcMain.handle(IPC.WEATHER_FORECAST, async (_event, point) => {
    return fetchWeather(point)
  })

  /* ── AI ── */
  ipcMain.handle(IPC.AI_HEALTH, async () => {
    return ollamaHealth()
  })

  ipcMain.handle(IPC.AI_CHAT, async (_event, args) => {
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

  ipcMain.handle(IPC.AI_VISION, async (_event, args) => {
    const { prompt, image, model } = args
    try {
      const text = await ollamaVisionRaw(image, prompt, model)
      return { content: text, model: model || 'qwen2.5vl:7b', error: undefined }
    } catch (e) {
      return { content: '', model: model || 'qwen2.5vl:7b', error: e instanceof Error ? e.message : String(e) }
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

  console.log('[ipc] all IPC handlers registered')
}
