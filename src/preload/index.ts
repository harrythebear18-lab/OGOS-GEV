import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'

/**
 * Typed preload API. Mirrors OGOS's window.terrain / window.ai / window.climate
 * pattern but routed through our IPC contract.
 */
const api = {
  /* ── Generic ── */
  hello: () => ipcRenderer.invoke(IPC.APP_HELLO),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
  },
  off: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  },

  /* ── Scene ── */
  scene: {
    get: () => ipcRenderer.invoke(IPC.GET_SCENE_CONTEXT),
    set: (patch: unknown) => ipcRenderer.send(IPC.SET_SCENE_CONTEXT, patch),
    onContext: (cb: (ctx: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, ctx: unknown) => cb(ctx)
      ipcRenderer.on(IPC.SCENE_CONTEXT_CHANGED, handler)
    },
    setStack: (stack: string) => ipcRenderer.send(IPC.GLOBE_SET_STACK, stack),
    sendViewport: (vp: unknown) => ipcRenderer.send(IPC.GLOBE_VIEWPORT, vp),
  },

  /* ── Tiles / offline ── */
  tiles: {
    get: (source: string, z: number, x: number, y: number) =>
      ipcRenderer.invoke(IPC.TILE_REQUEST, { source, z, x, y }),
    getStrategy: () => ipcRenderer.invoke(IPC.GET_OFFLINE_STRATEGY),
    setStrategy: (s: string) => ipcRenderer.send(IPC.SET_OFFLINE_STRATEGY, s),
  },

  /* ── Terrain / SAR ── */
  terrain: {
    demSample: (lng: number, lat: number) => ipcRenderer.invoke(IPC.DEM_SAMPLE, { lng, lat }),
    demProfile: (coords: unknown[]) => ipcRenderer.invoke(IPC.DEM_PROFILE, { coords }),
    slopeAnalysis: (req: unknown) => ipcRenderer.invoke(IPC.SLOPE_ANALYSIS, req),
    anomalyAnalysis: (req: unknown) => ipcRenderer.invoke(IPC.ANOMALY_ANALYSIS, req),
    searchZones: (req: unknown) => ipcRenderer.invoke(IPC.SEARCH_ZONES, req),
    restPoints: (req: unknown) => ipcRenderer.invoke(IPC.REST_POINTS, req),
    routePlan: (req: unknown) => ipcRenderer.invoke(IPC.ROUTE_PLAN, req),
    fallRisk: (req: unknown) => ipcRenderer.invoke(IPC.FALL_RISK, req),
    remainsCorridor: (req: unknown) => ipcRenderer.invoke(IPC.REMAINS_CORRIDOR, req),
    runoff: (req: unknown) => ipcRenderer.invoke(IPC.RUNOFF_ANALYSIS, req),
    canopy: (req: unknown) => ipcRenderer.invoke(IPC.CANOPY_ANALYSIS, req),
    behavior: (req: unknown) => ipcRenderer.invoke(IPC.BEHAVIOR_ENGINE, req),
    water: (bounds: unknown) => ipcRenderer.invoke(IPC.WATER_FETCH, { bounds }),
    roads: (bounds: unknown) => ipcRenderer.invoke(IPC.ROAD_FETCH, { bounds }),
  },

  /* ── Infrastructure (OSM Overpass — airports, power, substations, buoys) ── */
  infrastructure: {
    fetch: (bounds: unknown) => ipcRenderer.invoke(IPC.INFRA_FETCH, { bounds }),
  },

  /* ── Imagery ── */
  imagery: {
    search: (req: unknown) => ipcRenderer.invoke(IPC.SENTINEL_SEARCH, req),
    layers: () => ipcRenderer.invoke(IPC.SENTINEL_LAYERS),
    getTle: () => ipcRenderer.invoke(IPC.SAT_TLE_GET),
  },

  /* ── Weather ── */
  weather: {
    radar: () => ipcRenderer.invoke(IPC.WEATHER_RADAR),
    forecast: (point: { lng: number; lat: number }) => ipcRenderer.invoke(IPC.WEATHER_FORECAST, point),
    rainfall: (bounds: unknown) => ipcRenderer.invoke(IPC.WEATHER_RAINFALL, { bounds }),
  },

  /* ── Live data (pushed from main) ── */
  live: {
    onUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.LIVE_UPDATE, handler)
    },
    onAircraft: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.AIRCRAFT_UPDATE, handler)
    },
    onEarthquake: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.EARTHQUAKE_UPDATE, handler)
    },
    onFire: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.FIRE_UPDATE, handler)
    },
    onVessel: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.VESSEL_UPDATE, handler)
    },
    onLightning: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.LIGHTNING_UPDATE, handler)
    },
  },

  /* ── Climate / Ocean (pushed from main) ── */
  climate: {
    onUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.CLIMATE_UPDATE, handler)
    },
    onIntegrity: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.CLIMATE_INTEGRITY, handler)
    },
    onAlert: (cb: (alert: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, alert: unknown) => cb(alert)
      ipcRenderer.on(IPC.CLIMATE_ALERT, handler)
    },
    setViewport: (bounds: unknown) => ipcRenderer.send(IPC.CLIMATE_SET_VIEWPORT, bounds),
    whitelist: (stationId: string) => ipcRenderer.invoke(IPC.CLIMATE_WHITELIST, stationId),
    unwhitelist: (stationId: string) => ipcRenderer.invoke(IPC.CLIMATE_UNWHITELIST, stationId),
  },

  /* ── Storms (pushed) ── */
  storms: {
    onUpdate: (cb: (storms: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, storms: unknown) => cb(storms)
      ipcRenderer.on(IPC.STORM_UPDATE, handler)
    },
    onTrackUpdate: (cb: (tracks: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, tracks: unknown) => cb(tracks)
      ipcRenderer.on(IPC.STORM_TRACK_UPDATE, handler)
    },
  },

  /* ── Space weather (pushed) ── */
  spaceWeather: {
    onUpdate: (cb: (data: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: unknown) => cb(data)
      ipcRenderer.on(IPC.SPACE_WEATHER_UPDATE, handler)
    },
  },

  /* ── Predictions (pushed) ── */
  predictions: {
    onUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.PREDICTION_UPDATE, handler)
    },
  },

  /* ── Grid (pushed + invoke) ── */
  grid: {
    onUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.GRID_UPDATE, handler)
    },
    onAlert: (cb: (alert: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, alert: unknown) => cb(alert)
      ipcRenderer.on(IPC.GRID_ALERT, handler)
    },
    whitelist: (assetId: string) => ipcRenderer.invoke(IPC.GRID_WHITELIST, assetId),
    unwhitelist: (assetId: string) => ipcRenderer.invoke(IPC.GRID_UNWHITELIST, assetId),
  },

  /* ── Network (pushed + invoke) ── */
  network: {
    onUpdate: (cb: (update: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, update: unknown) => cb(update)
      ipcRenderer.on(IPC.NET_UPDATE, handler)
    },
    onAlert: (cb: (alert: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, alert: unknown) => cb(alert)
      ipcRenderer.on(IPC.NET_ALERT, handler)
    },
    onHealth: (cb: (health: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, health: unknown) => cb(health)
      ipcRenderer.on(IPC.NET_HEALTH, handler)
    },
    onVpn: (cb: (status: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: unknown) => cb(status)
      ipcRenderer.on(IPC.NET_VPN, handler)
    },
    onUserLocation: (cb: (loc: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, loc: unknown) => cb(loc)
      ipcRenderer.on(IPC.NET_USER_LOCATION, handler)
    },
    refreshVpn: () => ipcRenderer.invoke(IPC.NET_VPN_REFRESH),
    speedTest: () => ipcRenderer.invoke(IPC.NET_SPEEDTEST_RUN),
    dnsTest: () => ipcRenderer.invoke(IPC.NET_DNSTEST_RUN),
  },

  /* ── AI Bridge ── */
  ai: {
    health: () => ipcRenderer.invoke(IPC.AI_HEALTH),

    // Session management
    createSession: () => ipcRenderer.invoke('ai:session:create'),
    destroySession: (sessionId: string) => ipcRenderer.invoke('ai:session:destroy', { sessionId }),
    getSession: (sessionId: string) => ipcRenderer.invoke('ai:session:get', { sessionId }),

    // Chat with tools (streaming via ai:chat:stream events)
    chat: (sessionId: string, prompt: string, opts?: { image?: string; model?: string }) =>
      ipcRenderer.invoke(IPC.AI_CHAT, { sessionId, prompt, image: opts?.image, model: opts?.model }),

    // Vision (one-shot viewport analysis)
    vision: (prompt: string, image: string, model?: string) =>
      ipcRenderer.invoke(IPC.AI_VISION, { prompt, image, model }),

    // Tool registration (renderer registers action-runner tools)
    registerTools: (tools: unknown[]) => ipcRenderer.invoke('ai:tools:register', { tools }),

    // Tool call resolution (renderer sends back tool results)
    resolveTool: (callId: string, result: unknown) =>
      ipcRenderer.invoke('ai:tool:resolve', { callId, result }),
    rejectTool: (callId: string, error: string) =>
      ipcRenderer.invoke('ai:tool:reject', { callId, error }),

    // Stream listener — renderer subscribes to tokens, tool calls, done
    onStream: (cb: (data: { sessionId: string; type: string; token?: string; toolName?: string; args?: unknown; result?: unknown; content?: string; error?: string; callId?: string }) => void) => {
      const handler = (_event: unknown, data: unknown) => cb(data as any)
      ipcRenderer.on(IPC.AI_CHAT_STREAM, handler)
      return () => ipcRenderer.off(IPC.AI_CHAT_STREAM, handler)
    },

    // Legacy chat (backward compat)
    chatLegacy: (prompt: string, model?: string, context?: string) =>
      ipcRenderer.invoke('ai:chat:legacy', { prompt, model, context }),

    clipHealth: () => ipcRenderer.invoke(IPC.AI_CLIP_HEALTH),
    clipSearch: (query: string, bounds?: unknown) =>
      ipcRenderer.invoke(IPC.AI_CLIP_SEARCH, { query, bounds }),
    webSearch: (query: string, limit?: number) =>
      ipcRenderer.invoke(IPC.WEB_SEARCH, { query, limit }),
  },

  /* ── Export / Import / Case profiles ── */
  files: {
    exportGeoJSON: (data: unknown) => ipcRenderer.invoke(IPC.EXPORT_GEOJSON, data),
    exportKML: (data: unknown) => ipcRenderer.invoke(IPC.EXPORT_KML, data),
    importKml: () => ipcRenderer.invoke(IPC.IMPORT_KML),
    caseProfiles: (id?: string) => ipcRenderer.invoke(IPC.CASE_PROFILES, id ? { id } : {}),
  },

  /* ── Trip params + Hiker calibration ── */
  trip: {
    derive: (params: unknown) => ipcRenderer.invoke(IPC.TRIP_DERIVE, { params }),
    calibrate: (profile: unknown) => ipcRenderer.invoke(IPC.HIKER_CALIBRATE, { profile }),
  },

  /* ── Climate helpers (bathymetry + region classification) ── */
  climateHelpers: {
    depth: (lat: number, lon: number) => ipcRenderer.invoke(IPC.BATHYMETRY_DEPTH, { lat, lon }),
    classify: (lat: number, lon: number, stationType?: string) =>
      ipcRenderer.invoke(IPC.REGION_CLASSIFY, { lat, lon, stationType }),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
