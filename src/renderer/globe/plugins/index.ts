/**
 * Plugin registry — all available plugins.
 * Import this to get the full list of registered plugins.
 */

import { pluginManager } from './plugin-manager'
import { weatherPlugin } from './weather-plugin'
import { earthquakesPlugin } from './earthquakes-plugin'
import { slopeBandsPlugin } from './slope-plugin'
import { hydrologyPlugin } from './hydrology-plugin'
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
import { caseProfilesPlugin } from './case-profiles-plugin'
import { exportImportPlugin } from './export-import-plugin'
import { vrPlugin } from './vr-plugin'

// Register all plugins (doesn't activate them)
pluginManager.register([
  // Tier 1 — Core World Intelligence
  weatherPlugin,
  earthquakesPlugin,
  slopeBandsPlugin,
  hydrologyPlugin,
  // Tier 2 — Movement & Behaviour
  routesPlugin,
  canopyPlugin,
  behaviorEnginePlugin,
  // Tier 3 — Live Feeds
  firesPlugin,
  aircraftPlugin,
  vesselsPlugin,
  lightningPlugin,
  // Tier 4 — AI & Vision
  clipPlugin,
  visionPlugin,
  webSearchPlugin,
  // Tier 5 — Mission Logic
  searchZonesPlugin,
  restPointsPlugin,
  fallRiskPlugin,
  caseProfilesPlugin,
  exportImportPlugin,
  // VR / OpenXR
  vrPlugin,
])

export {
  pluginManager,
  weatherPlugin,
  earthquakesPlugin,
  slopeBandsPlugin,
  hydrologyPlugin,
  routesPlugin,
  canopyPlugin,
  behaviorEnginePlugin,
  firesPlugin,
  aircraftPlugin,
  vesselsPlugin,
  lightningPlugin,
  clipPlugin,
  visionPlugin,
  webSearchPlugin,
  searchZonesPlugin,
  restPointsPlugin,
  fallRiskPlugin,
  caseProfilesPlugin,
  exportImportPlugin,
  vrPlugin,
}
export type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'
