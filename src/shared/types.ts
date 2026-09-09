/* Shared type contracts between main process and renderer.
 * These travel over IPC — keep them serializable (no class instances, no Maps). */

/* ------------------------------------------------------------------ */
/* Basic geometry                                                       */
/* ------------------------------------------------------------------ */

export interface LngLat {
  lng: number
  lat: number
}

export interface BBox {
  west: number
  south: number
  east: number
  north: number
}

/* ------------------------------------------------------------------ */
/* Scene context                                                        */
/* ------------------------------------------------------------------ */

export interface GlobeViewport {
  center: LngLat
  height: number
  heading: number
  pitch: number
  roll: number
  bbox: BBox | null
}

export interface SceneContext {
  activeLayers: string[]
  selectedFeature: unknown | null
  lkp: LngLat | null
  endPoint: LngLat | null
  bbox: BBox | null
  timeRange: { start: number; end: number } | null
  camera: {
    center: LngLat
    height: number
    heading: number
    pitch: number
    roll: number
  } | null
}

export type OfflineStrategy = 'prefer-cache' | 'cache-only' | 'online'

export interface TileRequest {
  source: string
  z: number
  x: number
  y: number
}

/* ------------------------------------------------------------------ */
/* Satellite imagery (NASA GIBS)                                       */
/* ------------------------------------------------------------------ */

export interface GIBSLayer {
  id: string
  name: string
  gibsLayer: string
  format: 'jpeg' | 'png'
  tileMatrixSet: string
  maxZoom: number
  temporalResolution: string
  description: string
  category: 'true-color' | 'false-color' | 'thermal' | 'vegetation' | 'geostationary'
}

export interface SentinelScene {
  id: string
  tileUrl: string
  date: string
  cloudCover: number
  bounds: [LngLat, LngLat]
  isImageOverlay?: boolean
  maxZoom?: number
}

export interface SentinelRequest {
  bounds: [LngLat, LngLat]
  maxCloudCover?: number
  limit?: number
  layerId?: string
  date?: string
}

export interface SentinelResponse {
  layers: GIBSLayer[]
  scenes: SentinelScene[]
  best?: SentinelScene
}

/* ------------------------------------------------------------------ */
/* DEM                                                                  */
/* ------------------------------------------------------------------ */

export interface DemSampleRequest {
  lng: number
  lat: number
}

export interface DemSampleResponse {
  elevation: number | null
}

export interface DemProfileRequest {
  coords: LngLat[]
}

export interface DemProfilePoint {
  lng: number
  lat: number
  elevation: number | null
  distance: number
}

export interface DemProfileResponse {
  points: DemProfilePoint[]
  totalAscent: number
  totalDescent: number
  maxSlopeDeg: number
}

/* ------------------------------------------------------------------ */
/* Slope analysis                                                       */
/* ------------------------------------------------------------------ */

export type ActivityProfile = 'hiking' | 'scrambling' | 'sar'

export interface SlopeAnalysisRequest {
  bounds: [LngLat, LngLat]
  profile?: ActivityProfile
  demZoom?: number
}

export interface SlopeBand {
  id: string
  coords: LngLat[]
  slopeDeg: number
  class: 'passable' | 'steep' | 'impassable'
}

export interface SlopeAnalysisResponse {
  grid: number[][]
  bounds: [LngLat, LngLat]
  bands: SlopeBand[]
  legend: { deg: number; label: string; color: string }[]
}

/* ------------------------------------------------------------------ */
/* Anomaly analysis                                                     */
/* ------------------------------------------------------------------ */

export type AnalysisMode = 'active-sar' | 'legacy-research'

export interface AnomalyAnalysisRequest {
  bounds: [LngLat, LngLat]
  threshold?: number
  demZoom?: number
  mode?: AnalysisMode
}

export interface AnomalyZone {
  id: string
  coords: LngLat[]
  strength: number
  type: 'depression' | 'prominence'
  sizeM: number
}

export interface AnomalyAnalysisResponse {
  zones: AnomalyZone[]
  bounds: [LngLat, LngLat]
}

/* ------------------------------------------------------------------ */
/* Search zones / rest points / routing                                 */
/* ------------------------------------------------------------------ */

export interface SearchZonesRequest {
  lkp: LngLat
  radii?: number[]
  profile?: ActivityProfile
}

export interface SearchZone {
  id: string
  radius: number
  coords: LngLat[]
  probability: number
}

export interface SearchZonesResponse {
  zones: SearchZone[]
  lkp: LngLat
}

export interface RestPointsRequest {
  lkp: LngLat
  maxHours?: number
  bounds?: [LngLat, LngLat]
}

export interface RestPoint {
  id: string
  lng: number
  lat: number
  score: number
  reasons: string[]
}

export interface RestPointsResponse {
  points: RestPoint[]
}

export interface RoutePlanRequest {
  start: LngLat
  end: LngLat
  preference?: 'least-effort' | 'peak-ridge' | 'valley-contour'
  bounds?: [LngLat, LngLat]
}

export interface RoutePlanResponse {
  primary: LngLat[]
  alternatives: LngLat[][]
  distanceM: number
  ascentM: number
  descentM: number
}

export interface FallRiskRequest {
  route?: LngLat[]
  bounds?: [LngLat, LngLat]
}

export interface FallRiskResponse {
  zones: { id: string; coords: LngLat[]; risk: 'low' | 'moderate' | 'high' }[]
}

export interface RemainsCorridorRequest {
  fallPoint: LngLat
  bounds?: [LngLat, LngLat]
}

export interface RemainsCorridorResponse {
  corridor: LngLat[]
  width: number
}

/* ------------------------------------------------------------------ */
/* Runoff / hydrology                                                   */
/* ------------------------------------------------------------------ */

export interface RunoffAnalysisRequest {
  bounds: [LngLat, LngLat]
  rainfallMm?: number
}

export interface RunoffAnalysisResponse {
  flowPaths: LngLat[][]
  pools: { id: string; coords: LngLat[]; depthM: number }[]
  floodZones: { id: string; coords: LngLat[] }[]
}

/* ------------------------------------------------------------------ */
/* Canopy                                                               */
/* ------------------------------------------------------------------ */

export interface CanopyAnalysisRequest {
  bounds: [LngLat, LngLat]
  demZoom?: number
  mode?: AnalysisMode
}

export interface CanopyAnalysisResponse {
  zones: {
    id: string
    coords: LngLat[]
    type: 'defoliation' | 'dead-trees' | 'clearing' | 'thinning' | 'healthy-forest'
    avgNdvi: number
    severity: number
  }[]
  bounds: [LngLat, LngLat]
}

/* ------------------------------------------------------------------ */
/* Behavior engine                                                      */
/* ------------------------------------------------------------------ */

export interface BehaviorEngineRequest {
  lkp: LngLat
  hours: number
  bounds?: [LngLat, LngLat]
}

export interface BehaviorEngineResponse {
  paths: LngLat[][]
  densityZones: { id: string; coords: LngLat[]; density: number }[]
}

/* ------------------------------------------------------------------ */
/* Water features (OSM Overpass)                                       */
/* ------------------------------------------------------------------ */

export interface WaterFeature {
  id: string
  type: 'stream' | 'river' | 'lake' | 'pond' | 'spring' | 'wetland' | 'reservoir'
  coords: LngLat[]
  name?: string
}

export interface WaterResponse {
  features: WaterFeature[]
  bounds: [LngLat, LngLat]
}

/* ------------------------------------------------------------------ */
/* Weather (RainViewer + Open-Meteo)                                  */
/* ------------------------------------------------------------------ */

export interface RadarFrame {
  time: number
  path: string
}

export interface RadarData {
  host: string
  radarPast: RadarFrame[]
  radarNowcast: RadarFrame[]
  satellite: RadarFrame[]
  generated: number
}

export interface CurrentWeather {
  temperature: number
  apparentTemp: number
  humidity: number
  windSpeed: number
  windDir: number
  precipitation: number
  weatherCode: number
  isDay: boolean
}

export interface HourlyForecast {
  time: string
  temp: number
  precipProb: number
  precip: number
  windSpeed: number
  weatherCode: number
}

export interface WeatherResponse {
  current: CurrentWeather
  hourly: HourlyForecast[]
  location: LngLat
}

/* ------------------------------------------------------------------ */
/* Live data feeds                                                      */
/* ------------------------------------------------------------------ */

export type LiveFeatureType = 'satellite' | 'aircraft' | 'vessel' | 'fire' | 'quake' | 'lightning'

export interface LiveFeature {
  id: string
  type: LiveFeatureType
  position: { lon: number; lat: number; height?: number }
  velocity?: { speed?: number; heading?: number; x?: number; y?: number; z?: number }
  meta: Record<string, unknown>
  freshness: number
}

export interface LiveUpdate {
  type: 'delta' | 'full'
  features?: LiveFeature[]
  added?: LiveFeature[]
  removed?: LiveFeature[]
  source: string
  timestamp: number
}

/* ------------------------------------------------------------------ */
/* AI (Ollama / CLIP / web search)                                    */
/* ------------------------------------------------------------------ */

export interface OllamaModel {
  name: string
  size: number
  digest: string
  capabilities: string[]
}

export interface AiHealthResponse {
  running: boolean
  models: OllamaModel[]
}

export interface AiChatRequest {
  prompt: string
  model?: string
  context?: string
}

export interface AiChatResponse {
  content: string
  model: string
  error?: string
}

export interface AiVisionRequest {
  prompt: string
  image: string
  model?: string
}

export interface ClipHealthResponse {
  running: boolean
  model?: string
}

export interface ClipSearchRequest {
  query: string
  bounds?: [LngLat, LngLat]
}

export interface ClipSearchResponse {
  results: { id: string; score: number; lng: number; lat: number }[]
}

export interface WebSearchRequest {
  query: string
  limit?: number
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchResponse {
  results: WebSearchResult[]
}
