export const IPC = {
  // App / scene
  APP_HELLO: 'app:hello',
  GLOBE_VIEWPORT: 'globe:viewport',
  GLOBE_SET_STACK: 'globe:set-stack',
  SCENE_CONTEXT_CHANGED: 'scene:context-changed',
  GET_SCENE_CONTEXT: 'scene:get-context',
  SET_SCENE_CONTEXT: 'scene:set-context',

  // Tile / offline
  TILE_REQUEST: 'tile:request',
  GET_OFFLINE_STRATEGY: 'offline:get-strategy',
  SET_OFFLINE_STRATEGY: 'offline:set-strategy',

  // Terrain / SAR analysis (ported from OGOS)
  DEM_SAMPLE: 'terrain:dem:sample',
  DEM_PROFILE: 'terrain:dem:profile',
  SLOPE_ANALYSIS: 'terrain:slope:analysis',
  ANOMALY_ANALYSIS: 'terrain:anomaly:analysis',
  SEARCH_ZONES: 'terrain:search:zones',
  REST_POINTS: 'terrain:rest:points',
  RUNOFF_ANALYSIS: 'terrain:runoff:analysis',
  ROUTE_PLAN: 'terrain:route:plan',
  FALL_RISK: 'terrain:fall-risk',
  REMAINS_CORRIDOR: 'terrain:remains-corridor',
  CANOPY_ANALYSIS: 'terrain:canopy:analysis',
  BEHAVIOR_ENGINE: 'terrain:behavior:engine',
  WATER_FETCH: 'terrain:water:fetch',

  // Satellite imagery (GIBS)
  SENTINEL_SEARCH: 'imagery:sentinel:search',
  SENTINEL_LAYERS: 'imagery:sentinel:layers',

  // Weather
  WEATHER_RADAR: 'weather:radar',
  WEATHER_FORECAST: 'weather:forecast',

  // Live data feeds (pushed from main to renderer)
  LIVE_UPDATE: 'live:update',
  CLIMATE_UPDATE: 'climate:update',
  AIRCRAFT_UPDATE: 'aircraft:update',
  EARTHQUAKE_UPDATE: 'earthquake:update',
  FIRE_UPDATE: 'fire:update',
  VESSEL_UPDATE: 'vessel:update',
  LIGHTNING_UPDATE: 'lightning:update',

  // AI
  AI_CHAT: 'ai:chat',
  AI_CHAT_STREAM: 'ai:chat:stream',
  AI_VISION: 'ai:vision',
  AI_HEALTH: 'ai:health',
  AI_CLIP_HEALTH: 'ai:clip:health',
  AI_CLIP_EMBED_TEXT: 'ai:clip:embed-text',
  AI_CLIP_EMBED_IMAGE: 'ai:clip:embed-image',
  AI_CLIP_SIMILARITY: 'ai:clip:similarity',
  AI_CLIP_SEARCH: 'ai:clip:search',
  WEB_SEARCH: 'ai:web-search',

  // VR / OpenXR (Quest 3S via PC Link)
  XR_START: 'xr:start',
  XR_STOP: 'xr:stop',
  XR_STATUS: 'xr:status',
  XR_POSE: 'xr:pose',
  XR_FRAME: 'xr:frame',
  XR_CONTROLLERS: 'xr:controllers',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
