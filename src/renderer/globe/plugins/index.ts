/**
 * Plugin registry — all available plugins.
 * Import this to get the full list of registered plugins.
 */

import { pluginManager } from './plugin-manager'
import { weatherPlugin } from './weather-plugin'
import { earthquakesPlugin } from './earthquakes-plugin'
import { slopeBandsPlugin } from './slope-plugin'
import { anomalyPlugin } from './anomaly-plugin'
import { hydrologyPlugin } from './hydrology-plugin'
import { waterPlugin } from './water-plugin'
import { roadsPlugin } from './roads-plugin'
import { routesPlugin } from './routes-plugin'
import { canopyPlugin } from './canopy-plugin'
import { behaviorEnginePlugin } from './behavior-plugin'
import { firesPlugin } from './fires-plugin'
import { aircraftPlugin } from './aircraft-plugin'
import { vesselsPlugin } from './vessels-plugin'
import { lightningPlugin } from './lightning-plugin'
import { clipPlugin } from './clip-plugin'
import { visionPlugin } from './vision-plugin'
import { webSearchPlugin } from './web-search-plugin'
import { searchZonesPlugin } from './search-zones-plugin'
import { restPointsPlugin } from './rest-points-plugin'
import { fallRiskPlugin } from './fall-risk-plugin'
import { remainsCorridorPlugin } from './remains-corridor-plugin'
import { caseProfilesPlugin } from './case-profiles-plugin'
import { exportImportPlugin } from './export-import-plugin'
import { hikerProfilePlugin } from './hiker-profile-plugin'
import { vrPlugin } from './vr-plugin'
import { climateStationsPlugin } from './climate-stations-plugin'
import { stormsPlugin } from './storms-plugin'
import { spaceWeatherPlugin } from './space-weather-plugin'
import { gridAssetsPlugin } from './grid-assets-plugin'
import { networkPlugin } from './network-plugin'
import { predictionsPlugin } from './predictions-plugin'
import { detectionPlugin } from './detection-plugin'

// Register all plugins (doesn't activate them)
pluginManager.register([
  // Tier 1 — Core World Intelligence
  weatherPlugin,
  earthquakesPlugin,
  slopeBandsPlugin,
  anomalyPlugin,
  hydrologyPlugin,
  waterPlugin,
  roadsPlugin,
  // Tier 2 — Movement & Behaviour
  routesPlugin,
  canopyPlugin,
  behaviorEnginePlugin,
  // Tier 3 — Live Feeds
  firesPlugin,
  aircraftPlugin,
  vesselsPlugin,
  lightningPlugin,
  // Tier 3b — Climate / Ocean (ported from OGOS)
  climateStationsPlugin,
  stormsPlugin,
  spaceWeatherPlugin,
  // Tier 3c — Infrastructure (ported from OGOS)
  gridAssetsPlugin,
  networkPlugin,
  // Tier 4 — AI & Vision
  clipPlugin,
  visionPlugin,
  webSearchPlugin,
  detectionPlugin,
  // Tier 4b — Predictions (ported from OGOS)
  predictionsPlugin,
  detectionPlugin,
  // Tier 5 — Mission Logic
  searchZonesPlugin,
  restPointsPlugin,
  fallRiskPlugin,
  remainsCorridorPlugin,
  caseProfilesPlugin,
  exportImportPlugin,
  hikerProfilePlugin,
  // VR / OpenXR
  vrPlugin,
])

export {
  pluginManager,
  weatherPlugin,
  earthquakesPlugin,
  slopeBandsPlugin,
  anomalyPlugin,
  hydrologyPlugin,
  waterPlugin,
  roadsPlugin,
  routesPlugin,
  canopyPlugin,
  behaviorEnginePlugin,
  firesPlugin,
  aircraftPlugin,
  vesselsPlugin,
  lightningPlugin,
  climateStationsPlugin,
  stormsPlugin,
  spaceWeatherPlugin,
  gridAssetsPlugin,
  networkPlugin,
  predictionsPlugin,
  detectionPlugin,
  clipPlugin,
  visionPlugin,
  webSearchPlugin,
  searchZonesPlugin,
  restPointsPlugin,
  fallRiskPlugin,
  remainsCorridorPlugin,
  caseProfilesPlugin,
  exportImportPlugin,
  hikerProfilePlugin,
  vrPlugin,
}
export type { EarthEnginePlugin, PluginContext, PluginStats, PluginControlSpec } from './plugin-manager'
