/* Grid data catalog + internal types + utility helpers.
 * Ported from OGOS gridData.ts / gridTypes.ts / gridDataUtils.ts.
 * Uses shared types from @shared/types, extended internally for verification logic. */

import type {
  GridAsset,
  GridInterconnect,
  GridAssetMeasurement,
} from '@shared/types'

/* ------------------------------------------------------------------ */
/* Internal types (extended from shared types for verification logic) */
/* ------------------------------------------------------------------ */

export type GridDataSource =
  | 'EIA_GRID' | 'ENTSOE' | 'USGS_EGRID' | 'OPENELEC'
  | 'SYNTHETIC' | 'DATACENTER_MAP' | 'AI_CLUSTER'

export type GridIntegrityStatus =
  | 'verified' | 'warning' | 'failed' | 'stale' | 'unknown' | 'invalidated'

/** GridAsset extended with invalidation fields used internally. */
export interface InternalGridAsset extends GridAsset {
  invalidated?: boolean
  invalidationReason?: string
}

/** AssetMeasurement extended with fields used by verification logic. */
export interface AssetMeasurement extends GridAssetMeasurement {
  itLoadMw?: number
  totalFacilityLoadMw?: number
  coolingLoadMw?: number
  availableRacks?: number
  storedMwh?: number
  maxStorageMwh?: number
  throughputTbps?: number
  latencyMs?: number
}

export interface AssetCheck {
  check: string
  status: GridIntegrityStatus
  message: string
  value?: string
}

export interface AssetHealth {
  assetId: string
  status: GridIntegrityStatus
  integrityScore: number
  lastTransmission: number
  expectedIntervalMs: number
  actualIntervalMs: number
  transmissionCount: number
  missedTransmissions: number
  transmissionRegularity: number
  fieldsExpected: string[]
  fieldsReceived: string[]
  fieldsMissing: string[]
  driftDetected: boolean
  driftDetails: string[]
  calibrationStatus: 'ok' | 'drift' | 'unknown'
  consecutiveFailures: number
  uptimePercent: number
  checks: AssetCheck[]
}

export interface PipelineCheck {
  check: string
  status: GridIntegrityStatus
  message: string
}

export interface DataFlowHealth {
  source: GridDataSource
  sourceName: string
  status: GridIntegrityStatus
  pipelineScore: number
  lastFetchTime: number
  fetchLatencyMs: number
  avgLatencyMs: number
  payloadSizeBytes: number
  assetsExpected: number
  assetsReceived: number
  completenessPercent: number
  duplicateCount: number
  outOfOrderCount: number
  missingFieldCount: number
  totalPackets: number
  droppedPackets: number
  pipelineChecks: PipelineCheck[]
  latencyHistory: number[]
}

export interface NearbyComparison {
  assetId: string
  assetName: string
  source: string
  distanceKm: number
  field: string
  theirValue: number
  ourValue: number
  delta: number
  withinTolerance: boolean
}

export interface PhysicalCheck {
  field: string
  value: number
  min: number
  max: number
  passed: boolean
  message: string
}

export interface StatisticalCheck {
  status: GridIntegrityStatus
  zScore: number
  mean: number
  stdDev: number
  sampleSize: number
  message: string
}

export interface TemporalCheck {
  status: GridIntegrityStatus
  previousValue?: number
  currentValue: number
  rateOfChange: number
  maxExpectedRate: number
  message: string
}

export interface CrossSourceCheck {
  field: string
  sources: string[]
  values: number[]
  spread: number
  agreement: boolean
  message: string
}

export type VerificationFlagType =
  | 'asset_drift' | 'data_gap' | 'statistical_outlier' | 'physical_implausible'
  | 'cross_source_mismatch' | 'temporal_jump' | 'pipeline_error'
  | 'calibration_issue' | 'stuck_sensor' | 'regional_anomaly'
  | 'capacity_exceeded' | 'thermal_stress' | 'interconnect_failure'
  | 'missing_data'

export interface VerificationFlag {
  type: VerificationFlagType
  severity: 'info' | 'warning' | 'critical'
  message: string
  field?: string
}

export interface CrossVerification {
  assetId: string
  assetName: string
  source: string
  lat: number
  lon: number
  status: GridIntegrityStatus
  verificationScore: number
  measurement: AssetMeasurement
  nearbyComparisons: NearbyComparison[]
  physicalPlausibility: PhysicalCheck[]
  statisticalOutlier: StatisticalCheck
  temporalConsistency: TemporalCheck
  crossSourceAgreement: CrossSourceCheck[]
  flags: VerificationFlag[]
}

export interface IntegritySummary {
  overallScore: number
  sensorLayerScore: number
  dataFlowLayerScore: number
  resultsLayerScore: number
  totalAssetsMonitored: number
  assetsVerified: number
  assetsWarning: number
  assetsFailed: number
  pipelinesActive: number
  pipelinesDegraded: number
  resultsValidated: number
  resultsFlagged: number
  totalFlags: number
  criticalFlags: number
  warningFlags: number
  dataPointsVerified: number
  crossSourceMatches: number
  crossSourceMismatches: number
}

export interface IntegrityUpdate {
  assetHealth: [string, AssetHealth][]
  dataFlowHealth: DataFlowHealth[]
  crossVerifications: CrossVerification[]
  summary: IntegritySummary
  timestamp: number
  newAssets?: InternalGridAsset[]
}

export interface GridStats {
  totalAssets: number
  activeAssets: number
  powerPlants: number
  substations: number
  transformers: number
  renewableFarms: number
  batteryStorages: number
  dataCenters: number
  aiCenters: number
  edgeNodes: number
  totalGenerationMw: number
  totalLoadMw: number
  avgUtilization: number
  anomalies: number
  dataFreshness: number
  totalCapacityMw: number
}

export interface TrafficDataPoint {
  timestamp: number
  totalAssets: number
  activeAssets: number
  newMeasurements: number
  avgUtilization: number
  totalLoadMw: number
  integrityScore: number
  assetsVerified: number
  assetsFlagged: number
}

export type InternalSeverity = 'info' | 'warning' | 'critical'

export type GridAlertType =
  | 'asset_drift' | 'data_gap' | 'statistical_outlier' | 'physical_implausible'
  | 'cross_source_mismatch' | 'temporal_jump' | 'pipeline_error'
  | 'calibration_issue' | 'new_asset' | 'asset_offline' | 'stuck_sensor'
  | 'regional_anomaly' | 'capacity_exceeded' | 'thermal_stress'
  | 'interconnect_failure'

export interface InternalGridAlert {
  id: string
  timestamp: number
  type: GridAlertType
  assetId: string
  assetName: string
  source: string
  lat: number
  lon: number
  message: string
  severity: InternalSeverity
  field?: string
  weatherCorrelated?: boolean
  seismicCorrelated?: boolean
  spaceWeatherCorrelated?: boolean
}

export interface MonitorSettings {
  fetchIntervalMs: number
  showParticles: boolean
  showInterconnects: boolean
  alertSeverityThreshold: InternalSeverity
}

export const DEFAULT_SETTINGS: MonitorSettings = {
  fetchIntervalMs: 10_000,
  showParticles: true,
  showInterconnects: true,
  alertSeverityThreshold: 'info',
}

export const SOURCE_NAMES: Record<GridDataSource, string> = {
  EIA_GRID: 'U.S. EIA Grid Monitor',
  ENTSOE: 'ENTSO-E Transparency Platform',
  USGS_EGRID: 'EPA eGRID',
  OPENELEC: 'Open Electricity',
  SYNTHETIC: 'Synthetic Test Feed',
  DATACENTER_MAP: 'DataCenterMap Public Index',
  AI_CLUSTER: 'AI Cluster Registry',
}

/** Map internal severity to shared GridAlert severity. */
export function mapSeverity(s: InternalSeverity): 'low' | 'moderate' | 'high' | 'critical' {
  if (s === 'info') return 'low'
  if (s === 'warning') return 'moderate'
  return 'critical'
}

/* ------------------------------------------------------------------ */
/* BASE_ASSETS — static catalog of power plants, substations, DCs,    */
/* AI centers, renewable farms, battery storage, transformers, edges  */
/* ------------------------------------------------------------------ */

export const BASE_ASSETS: InternalGridAsset[] = [
  // Power plants
  { id: 'PP-THREE-GORGES', name: 'Three Gorges Dam', type: 'power_plant', source: 'SYNTHETIC', lat: 30.8233, lon: 111.0031, country: 'China', region: 'Hubei', energyType: 'hydro', capacityMw: 22500, owner: 'China Yangtze Power', lastUpdate: Date.now(), active: true },
  { id: 'PP-ITAIPU', name: 'Itaipu Dam', type: 'power_plant', source: 'SYNTHETIC', lat: -25.4083, lon: -54.5883, country: 'Brazil/Paraguay', region: 'Paraná', energyType: 'hydro', capacityMw: 14000, owner: 'Itaipu Binacional', lastUpdate: Date.now(), active: true },
  { id: 'PP-XILUODU', name: 'Xiluodu Dam', type: 'power_plant', source: 'SYNTHETIC', lat: 28.2542, lon: 103.6536, country: 'China', region: 'Sichuan/Yunnan', energyType: 'hydro', capacityMw: 13860, owner: 'China Yangtze Power', lastUpdate: Date.now(), active: true },
  { id: 'PP-BELCHATOW', name: 'Bełchatów Power Station', type: 'power_plant', source: 'SYNTHETIC', lat: 51.2667, lon: 19.3167, country: 'Poland', region: 'Łódź', energyType: 'coal', capacityMw: 5298, owner: 'PGE', lastUpdate: Date.now(), active: true },
  { id: 'PP-KORI', name: 'Kori Nuclear Plant', type: 'power_plant', source: 'SYNTHETIC', lat: 35.3208, lon: 129.2986, country: 'South Korea', region: 'Busan', energyType: 'nuclear', capacityMw: 7489, owner: 'KHNP', lastUpdate: Date.now(), active: true },
  { id: 'PP-GRAND-COULEE', name: 'Grand Coulee Dam', type: 'power_plant', source: 'SYNTHETIC', lat: 47.9567, lon: -118.9833, country: 'USA', region: 'Washington', energyType: 'hydro', capacityMw: 6809, owner: 'BPA', lastUpdate: Date.now(), active: true },
  { id: 'PP-SHIN-KORI', name: 'Shin Kori Nuclear', type: 'power_plant', source: 'SYNTHETIC', lat: 35.3278, lon: 129.3014, country: 'South Korea', region: 'Ulsan', energyType: 'nuclear', capacityMw: 5360, owner: 'KHNP', lastUpdate: Date.now(), active: true },
  { id: 'PP-TAEAN', name: 'Taean Coal Power', type: 'power_plant', source: 'SYNTHETIC', lat: 36.9044, lon: 126.2389, country: 'South Korea', region: 'South Chungcheong', energyType: 'coal', capacityMw: 6100, owner: 'KOWEPO', lastUpdate: Date.now(), active: true },
  { id: 'PP-SURALAYA', name: 'Suralaya Power Station', type: 'power_plant', source: 'SYNTHETIC', lat: -6.0167, lon: 105.95, country: 'Indonesia', region: 'Banten', energyType: 'coal', capacityMw: 4025, owner: 'PLN', lastUpdate: Date.now(), active: true },
  { id: 'PP-HUANENG', name: 'Huaneng Yingkou', type: 'power_plant', source: 'SYNTHETIC', lat: 40.65, lon: 122.28, country: 'China', region: 'Liaoning', energyType: 'coal', capacityMw: 3200, owner: 'CHNG', lastUpdate: Date.now(), active: true },
  { id: 'PP-NIAGARA', name: 'Niagara Power Project', type: 'power_plant', source: 'SYNTHETIC', lat: 43.1431, lon: -79.0419, country: 'USA', region: 'New York', energyType: 'hydro', capacityMw: 2525, owner: 'NYPA', lastUpdate: Date.now(), active: true },
  { id: 'PP-DIABLO-CANYON', name: 'Diablo Canyon', type: 'power_plant', source: 'SYNTHETIC', lat: 35.2108, lon: -120.8558, country: 'USA', region: 'California', energyType: 'nuclear', capacityMw: 2320, owner: 'PG&E', lastUpdate: Date.now(), active: true },
  { id: 'PP-VOGTLE', name: 'Vogtle Nuclear', type: 'power_plant', source: 'SYNTHETIC', lat: 33.1436, lon: -82.2225, country: 'USA', region: 'Georgia', energyType: 'nuclear', capacityMw: 2430, owner: 'Georgia Power', lastUpdate: Date.now(), active: true },
  { id: 'PP-DARLINGTON', name: 'Darlington Nuclear', type: 'power_plant', source: 'SYNTHETIC', lat: 43.8728, lon: -78.7192, country: 'Canada', region: 'Ontario', energyType: 'nuclear', capacityMw: 3512, owner: 'OPG', lastUpdate: Date.now(), active: true },
  { id: 'PP-DUVHA', name: 'Duvha Power Station', type: 'power_plant', source: 'SYNTHETIC', lat: -25.95, lon: 29.2833, country: 'South Africa', region: 'Mpumalanga', energyType: 'coal', capacityMw: 3600, owner: 'Eskom', lastUpdate: Date.now(), active: true },
  { id: 'PP-KENDAL', name: 'Kendal Power Station', type: 'power_plant', source: 'SYNTHETIC', lat: -26.0833, lon: 28.9667, country: 'South Africa', region: 'Mpumalanga', energyType: 'coal', capacityMw: 4116, owner: 'Eskom', lastUpdate: Date.now(), active: true },
  { id: 'PP-NUCLEOELECTRICA', name: 'Cernavodă Nuclear', type: 'power_plant', source: 'SYNTHETIC', lat: 44.32, lon: 28.05, country: 'Romania', region: 'Constanța', energyType: 'nuclear', capacityMw: 1400, owner: 'Nuclearelectrica', lastUpdate: Date.now(), active: true },
  { id: 'PP-LAURENTIDES', name: 'Laurentides Hydro', type: 'power_plant', source: 'SYNTHETIC', lat: 48.5, lon: -71.2, country: 'Canada', region: 'Quebec', energyType: 'hydro', capacityMw: 2400, owner: 'Hydro-Québec', lastUpdate: Date.now(), active: true },
  { id: 'PP-DRAX', name: 'Drax Power Station', type: 'power_plant', source: 'SYNTHETIC', lat: 53.7397, lon: -0.9997, country: 'UK', region: 'Yorkshire', energyType: 'mixed', capacityMw: 2595, owner: 'Drax Group', lastUpdate: Date.now(), active: true },
  { id: 'PP-RWE-LIGNITE', name: 'RWE Lignite Plant', type: 'power_plant', source: 'SYNTHETIC', lat: 50.95, lon: 6.55, country: 'Germany', region: 'North Rhine-Westphalia', energyType: 'coal', capacityMw: 4200, owner: 'RWE', lastUpdate: Date.now(), active: true },
  { id: 'PP-NEURATH', name: 'Neurath Power Station', type: 'power_plant', source: 'SYNTHETIC', lat: 51.0167, lon: 6.5333, country: 'Germany', region: 'North Rhine-Westphalia', energyType: 'coal', capacityMw: 4400, owner: 'RWE', lastUpdate: Date.now(), active: true },
  { id: 'PP-NORDIC-NUCLEAR', name: 'Oskarshamn Nuclear', type: 'power_plant', source: 'SYNTHETIC', lat: 57.4136, lon: 16.6714, country: 'Sweden', region: 'Kalmar', energyType: 'nuclear', capacityMw: 1400, owner: 'OKG', lastUpdate: Date.now(), active: true },
  { id: 'PP-SAYANO', name: 'Sayano-Shushenskaya Dam', type: 'power_plant', source: 'SYNTHETIC', lat: 52.825, lon: 91.3717, country: 'Russia', region: 'Khakassia', energyType: 'hydro', capacityMw: 6400, owner: 'RusHydro', lastUpdate: Date.now(), active: true },
  { id: 'PP-BRASIL-TERMO', name: 'Termelétrica Parnaíba', type: 'power_plant', source: 'SYNTHETIC', lat: -2.9, lon: -41.8, country: 'Brazil', region: 'Maranhão', energyType: 'gas', capacityMw: 1383, owner: 'Eneva', lastUpdate: Date.now(), active: true },

  // Substations / grid hubs
  { id: 'SS-PJM-AKRON', name: 'PJM Akron Hub', type: 'substation', source: 'SYNTHETIC', lat: 41.08, lon: -81.52, country: 'USA', region: 'Ohio', voltageKv: 345, owner: 'FirstEnergy', lastUpdate: Date.now(), active: true },
  { id: 'SS-ERCOT-HOUSTON', name: 'ERCOT Houston Hub', type: 'substation', source: 'SYNTHETIC', lat: 29.76, lon: -95.37, country: 'USA', region: 'Texas', voltageKv: 345, owner: 'ERCOT', lastUpdate: Date.now(), active: true },
  { id: 'SS-CAISO-BAY', name: 'CAISO Bay Area Hub', type: 'substation', source: 'SYNTHETIC', lat: 37.77, lon: -122.42, country: 'USA', region: 'California', voltageKv: 500, owner: 'CAISO', lastUpdate: Date.now(), active: true },
  { id: 'SS-NYISO-NYC', name: 'NYISO NYC Hub', type: 'substation', source: 'SYNTHETIC', lat: 40.71, lon: -74.01, country: 'USA', region: 'New York', voltageKv: 345, owner: 'NYISO', lastUpdate: Date.now(), active: true },
  { id: 'SS-UK-GRID', name: 'National Grid London', type: 'substation', source: 'SYNTHETIC', lat: 51.5, lon: -0.1, country: 'UK', region: 'London', voltageKv: 400, owner: 'National Grid', lastUpdate: Date.now(), active: true },
  { id: 'SS-EUROPE-NORTH', name: 'Nordic Grid Hub', type: 'substation', source: 'SYNTHETIC', lat: 59.33, lon: 18.06, country: 'Sweden', region: 'Stockholm', voltageKv: 400, owner: 'Svenska kraftnät', lastUpdate: Date.now(), active: true },
  { id: 'SS-CHINA-EAST', name: 'East China Grid Hub', type: 'substation', source: 'SYNTHETIC', lat: 31.23, lon: 121.47, country: 'China', region: 'Shanghai', voltageKv: 1000, owner: 'SGCC', lastUpdate: Date.now(), active: true },
  { id: 'SS-CHINA-SOUTH', name: 'Southern Grid Hub', type: 'substation', source: 'SYNTHETIC', lat: 23.13, lon: 113.26, country: 'China', region: 'Guangzhou', voltageKv: 800, owner: 'CSG', lastUpdate: Date.now(), active: true },
  { id: 'SS-INDIA-NORTH', name: 'Northern Region Load Center', type: 'substation', source: 'SYNTHETIC', lat: 28.61, lon: 77.21, country: 'India', region: 'Delhi', voltageKv: 765, owner: 'POSOCO', lastUpdate: Date.now(), active: true },
  { id: 'SS-GERMAN-RHUR', name: 'RWE Ruhr Substation', type: 'substation', source: 'SYNTHETIC', lat: 51.45, lon: 7.0, country: 'Germany', region: 'Ruhr', voltageKv: 380, owner: 'Amprion', lastUpdate: Date.now(), active: true },
  { id: 'SS-TRANSGRID-NSW', name: 'TransGrid NSW', type: 'substation', source: 'SYNTHETIC', lat: -33.87, lon: 151.21, country: 'Australia', region: 'Sydney', voltageKv: 330, owner: 'TransGrid', lastUpdate: Date.now(), active: true },
  { id: 'SS-TEPCO-TOKYO', name: 'TEPCO Tokyo Substation', type: 'substation', source: 'SYNTHETIC', lat: 35.68, lon: 139.77, country: 'Japan', region: 'Tokyo', voltageKv: 500, owner: 'TEPCO', lastUpdate: Date.now(), active: true },
  { id: 'SS-KEPCO-SEOUL', name: 'KEPCO Seoul Substation', type: 'substation', source: 'SYNTHETIC', lat: 37.57, lon: 126.98, country: 'South Korea', region: 'Seoul', voltageKv: 345, owner: 'KEPCO', lastUpdate: Date.now(), active: true },
  { id: 'SS-ONTARIO', name: 'Hydro One Toronto', type: 'substation', source: 'SYNTHETIC', lat: 43.65, lon: -79.38, country: 'Canada', region: 'Ontario', voltageKv: 500, owner: 'Hydro One', lastUpdate: Date.now(), active: true },
  { id: 'SS-SOUTH-AFRICA', name: 'Eskom Johannesburg', type: 'substation', source: 'SYNTHETIC', lat: -26.2, lon: 28.04, country: 'South Africa', region: 'Gauteng', voltageKv: 400, owner: 'Eskom', lastUpdate: Date.now(), active: true },
  { id: 'SS-IBERIA', name: 'REE Madrid Hub', type: 'substation', source: 'SYNTHETIC', lat: 40.42, lon: -3.7, country: 'Spain', region: 'Madrid', voltageKv: 400, owner: 'Red Eléctrica', lastUpdate: Date.now(), active: true },
  { id: 'SS-ITALY-NORTH', name: 'Terna North Hub', type: 'substation', source: 'SYNTHETIC', lat: 45.46, lon: 9.19, country: 'Italy', region: 'Milan', voltageKv: 380, owner: 'Terna', lastUpdate: Date.now(), active: true },
  { id: 'SS-FRANCE-PARIS', name: 'RTE Paris Hub', type: 'substation', source: 'SYNTHETIC', lat: 48.85, lon: 2.35, country: 'France', region: 'Paris', voltageKv: 400, owner: 'RTE', lastUpdate: Date.now(), active: true },
  { id: 'SS-BRAZIL-SUDESTE', name: 'ONS Sudeste Hub', type: 'substation', source: 'SYNTHETIC', lat: -23.55, lon: -46.63, country: 'Brazil', region: 'São Paulo', voltageKv: 440, owner: 'ONS', lastUpdate: Date.now(), active: true },
  { id: 'SS-MEXICO-CITY', name: 'CFE Mexico City Hub', type: 'substation', source: 'SYNTHETIC', lat: 19.43, lon: -99.13, country: 'Mexico', region: 'Mexico City', voltageKv: 400, owner: 'CFE', lastUpdate: Date.now(), active: true },

  // Data centers
  { id: 'DC-ASHBURN-VA', name: 'Ashburn Data Center Cluster', type: 'data_center', source: 'DATACENTER_MAP', lat: 39.04, lon: -77.49, country: 'USA', region: 'Virginia', capacityMw: 1200, owner: 'AWS/Azure/Google', lastUpdate: Date.now(), active: true, tags: ['cloud', 'east-coast'] },
  { id: 'DC-PHOENIX-AZ', name: 'Phoenix Data Center Cluster', type: 'data_center', source: 'DATACENTER_MAP', lat: 33.45, lon: -112.07, country: 'USA', region: 'Arizona', capacityMw: 800, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'southwest'] },
  { id: 'DC-SILICON-VALLEY', name: 'Silicon Valley Data Centers', type: 'data_center', source: 'DATACENTER_MAP', lat: 37.39, lon: -122.06, country: 'USA', region: 'California', capacityMw: 900, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'west-coast'] },
  { id: 'DC-QUINCEY-WA', name: 'Quincy Data Centers', type: 'data_center', source: 'DATACENTER_MAP', lat: 47.23, lon: -119.85, country: 'USA', region: 'Washington', capacityMw: 600, owner: 'Microsoft/Google', lastUpdate: Date.now(), active: true, tags: ['cloud', 'hydro-backed'] },
  { id: 'DC-ATLANTA-GA', name: 'Atlanta Data Center Cluster', type: 'data_center', source: 'DATACENTER_MAP', lat: 33.75, lon: -84.39, country: 'USA', region: 'Georgia', capacityMw: 700, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'southeast'] },
  { id: 'DC-CHICAGO-IL', name: 'Chicago Data Center Cluster', type: 'data_center', source: 'DATACENTER_MAP', lat: 41.88, lon: -87.63, country: 'USA', region: 'Illinois', capacityMw: 850, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'midwest'] },
  { id: 'DC-DALLAS-TX', name: 'Dallas Data Center Cluster', type: 'data_center', source: 'DATACENTER_MAP', lat: 32.78, lon: -96.8, country: 'USA', region: 'Texas', capacityMw: 950, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'texas'] },
  { id: 'DC-AMSTERDAM', name: 'Amsterdam Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 52.37, lon: 4.9, country: 'Netherlands', region: 'Noord-Holland', capacityMw: 1000, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-west'] },
  { id: 'DC-FRANKFURT', name: 'Frankfurt Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 50.11, lon: 8.68, country: 'Germany', region: 'Hesse', capacityMw: 1100, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-central'] },
  { id: 'DC-DUBLIN', name: 'Dublin Data Center Cluster', type: 'data_center', source: 'DATACENTER_MAP', lat: 53.35, lon: -6.26, country: 'Ireland', region: 'Leinster', capacityMw: 650, owner: 'Microsoft/Google', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-west'] },
  { id: 'DC-LONDON', name: 'London Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 51.51, lon: -0.13, country: 'UK', region: 'London', capacityMw: 950, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-west'] },
  { id: 'DC-PARIS', name: 'Paris Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 48.86, lon: 2.35, country: 'France', region: 'Paris', capacityMw: 700, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-west'] },
  { id: 'DC-SINGAPORE', name: 'Singapore Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 1.35, lon: 103.82, country: 'Singapore', region: 'Singapore', capacityMw: 800, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-TOKYO', name: 'Tokyo Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 35.68, lon: 139.77, country: 'Japan', region: 'Tokyo', capacityMw: 900, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-OSAKA', name: 'Osaka Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 34.69, lon: 135.5, country: 'Japan', region: 'Osaka', capacityMw: 600, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-SYDNEY', name: 'Sydney Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: -33.87, lon: 151.21, country: 'Australia', region: 'Sydney', capacityMw: 500, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-SAO-PAULO', name: 'São Paulo Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: -23.55, lon: -46.63, country: 'Brazil', region: 'São Paulo', capacityMw: 450, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'latam'] },
  { id: 'DC-MUMBAI', name: 'Mumbai Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 19.08, lon: 72.88, country: 'India', region: 'Maharashtra', capacityMw: 550, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-HYDERABAD', name: 'Hyderabad Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 17.39, lon: 78.49, country: 'India', region: 'Telangana', capacityMw: 400, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-SHANGHAI', name: 'Shanghai Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 31.23, lon: 121.47, country: 'China', region: 'Shanghai', capacityMw: 850, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-BEIJING', name: 'Beijing Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 39.9, lon: 116.41, country: 'China', region: 'Beijing', capacityMw: 800, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'apac'] },
  { id: 'DC-TORONTO', name: 'Toronto Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 43.65, lon: -79.38, country: 'Canada', region: 'Ontario', capacityMw: 500, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'na-east'] },
  { id: 'DC-MONTREAL', name: 'Montreal Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 45.5, lon: -73.57, country: 'Canada', region: 'Quebec', capacityMw: 450, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'na-east'] },
  { id: 'DC-STOCKHOLM', name: 'Stockholm Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 59.33, lon: 18.06, country: 'Sweden', region: 'Stockholm', capacityMw: 400, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-north'] },
  { id: 'DC-WARSAW', name: 'Warsaw Data Center Hub', type: 'data_center', source: 'DATACENTER_MAP', lat: 52.23, lon: 21.01, country: 'Poland', region: 'Masovia', capacityMw: 350, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['cloud', 'eu-east'] },

  // AI centers
  { id: 'AI-OPENAI-SC', name: 'OpenAI Stargate South Carolina', type: 'ai_center', source: 'AI_CLUSTER', lat: 34.0, lon: -81.03, country: 'USA', region: 'South Carolina', capacityMw: 2000, owner: 'OpenAI/Oracle', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-XAI-MEMPHIS', name: 'xAI Colossus Memphis', type: 'ai_center', source: 'AI_CLUSTER', lat: 35.15, lon: -90.05, country: 'USA', region: 'Tennessee', capacityMw: 1500, owner: 'xAI', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-META-LOUISIANA', name: 'Meta Louisiana AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 30.5, lon: -91.0, country: 'USA', region: 'Louisiana', capacityMw: 1600, owner: 'Meta', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-GOOGLE-IOWA', name: 'Google Iowa AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 41.59, lon: -93.62, country: 'USA', region: 'Iowa', capacityMw: 1200, owner: 'Google', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-MICROSOFT-AZ', name: 'Microsoft Arizona AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 33.4, lon: -111.9, country: 'USA', region: 'Arizona', capacityMw: 1000, owner: 'Microsoft', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-AMAZON-TEXAS', name: 'Amazon Texas AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 30.27, lon: -97.74, country: 'USA', region: 'Texas', capacityMw: 1100, owner: 'Amazon', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-ANTHROPIC-TN', name: 'Anthropic Tennessee Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 35.92, lon: -86.87, country: 'USA', region: 'Tennessee', capacityMw: 900, owner: 'Anthropic', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-NVIDIA-TX', name: 'NVIDIA Texas AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 32.77, lon: -96.8, country: 'USA', region: 'Texas', capacityMw: 800, owner: 'NVIDIA', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-UK-SCIENCE', name: 'UK AI Research Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 51.5, lon: -0.1, country: 'UK', region: 'London', capacityMw: 600, owner: 'Government/Industry', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-FRANCE-SACLAY', name: 'France AI Saclay', type: 'ai_center', source: 'AI_CLUSTER', lat: 48.73, lon: 2.17, country: 'France', region: 'Paris-Saclay', capacityMw: 500, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-GERMANY-JUELICH', name: 'Jülich AI Compute', type: 'ai_center', source: 'AI_CLUSTER', lat: 50.92, lon: 6.36, country: 'Germany', region: 'Jülich', capacityMw: 450, owner: 'Forschungszentrum', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-SINGAPORE-NSCC', name: 'Singapore NSCC AI', type: 'ai_center', source: 'AI_CLUSTER', lat: 1.3, lon: 103.8, country: 'Singapore', region: 'Singapore', capacityMw: 400, owner: 'NSCC', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-JAPAN-ABCI', name: 'ABCI Japan', type: 'ai_center', source: 'AI_CLUSTER', lat: 35.68, lon: 139.77, country: 'Japan', region: 'Tokyo', capacityMw: 350, owner: 'AIST', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-CHINA-WUXI', name: 'National Supercomputing Wuxi', type: 'ai_center', source: 'AI_CLUSTER', lat: 31.57, lon: 120.3, country: 'China', region: 'Jiangsu', capacityMw: 600, owner: 'NSCC', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-CHINA-SHENZHEN', name: 'Pengcheng Lab Shenzhen', type: 'ai_center', source: 'AI_CLUSTER', lat: 22.54, lon: 114.06, country: 'China', region: 'Guangdong', capacityMw: 500, owner: 'PCL', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-KOREA-KAIST', name: 'KAIST AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 36.37, lon: 127.36, country: 'South Korea', region: 'Daejeon', capacityMw: 300, owner: 'KAIST', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-INDIA-BANGALORE', name: 'India AI Cluster Bangalore', type: 'ai_center', source: 'AI_CLUSTER', lat: 12.97, lon: 77.59, country: 'India', region: 'Karnataka', capacityMw: 400, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-UAE-MBZR', name: 'UAE AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 24.45, lon: 54.38, country: 'UAE', region: 'Abu Dhabi', capacityMw: 350, owner: 'G42', lastUpdate: Date.now(), active: true, tags: ['ai', 'training'] },
  { id: 'AI-CANADA-MILA', name: 'MILA Montreal', type: 'ai_center', source: 'AI_CLUSTER', lat: 45.5, lon: -73.57, country: 'Canada', region: 'Quebec', capacityMw: 300, owner: 'MILA', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },
  { id: 'AI-ISRAEL', name: 'Israel AI Cluster', type: 'ai_center', source: 'AI_CLUSTER', lat: 32.09, lon: 34.78, country: 'Israel', region: 'Tel Aviv', capacityMw: 250, owner: 'Multiple', lastUpdate: Date.now(), active: true, tags: ['ai', 'research'] },

  // Renewable farms
  { id: 'RE-GANSU-WIND', name: 'Gansu Wind Farm', type: 'renewable_farm', source: 'OPENELEC', lat: 40.0, lon: 95.0, country: 'China', region: 'Gansu', energyType: 'wind', capacityMw: 20000, owner: 'SGCC', lastUpdate: Date.now(), active: true },
  { id: 'RE-HORNSEA', name: 'Hornsea Wind Farm', type: 'renewable_farm', source: 'OPENELEC', lat: 53.88, lon: 1.57, country: 'UK', region: 'North Sea', energyType: 'wind', capacityMw: 1218, owner: 'Ørsted', lastUpdate: Date.now(), active: true },
  { id: 'RE-WALNEY', name: 'Walney Extension', type: 'renewable_farm', source: 'OPENELEC', lat: 54.05, lon: -3.74, country: 'UK', region: 'Irish Sea', energyType: 'wind', capacityMw: 659, owner: 'Ørsted', lastUpdate: Date.now(), active: true },
  { id: 'RE-TENGGER', name: 'Tengger Desert Solar', type: 'renewable_farm', source: 'OPENELEC', lat: 37.8, lon: 105.0, country: 'China', region: 'Inner Mongolia', energyType: 'solar', capacityMw: 1547, owner: 'SGCC', lastUpdate: Date.now(), active: true },
  { id: 'RE-BHADLA', name: 'Bhadla Solar Park', type: 'renewable_farm', source: 'OPENELEC', lat: 27.5, lon: 71.8, country: 'India', region: 'Rajasthan', energyType: 'solar', capacityMw: 2245, owner: 'NTPC', lastUpdate: Date.now(), active: true },
  { id: 'RE-PAVAGADA', name: 'Pavagada Solar Park', type: 'renewable_farm', source: 'OPENELEC', lat: 14.25, lon: 77.0, country: 'India', region: 'Karnataka', energyType: 'solar', capacityMw: 2050, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'RE-NOORDOOSTPOOLDER', name: 'Noordoostpolder Wind', type: 'renewable_farm', source: 'OPENELEC', lat: 52.7, lon: 5.75, country: 'Netherlands', region: 'Flevoland', energyType: 'wind', capacityMw: 429, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'RE-LONDON-ARRAY', name: 'London Array', type: 'renewable_farm', source: 'OPENELEC', lat: 51.37, lon: 1.18, country: 'UK', region: 'Thames Estuary', energyType: 'wind', capacityMw: 630, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'RE-GEMINI', name: 'Gemini Wind Farm', type: 'renewable_farm', source: 'OPENELEC', lat: 54.03, lon: 6.03, country: 'Netherlands', region: 'North Sea', energyType: 'wind', capacityMw: 600, owner: 'Northland Power', lastUpdate: Date.now(), active: true },
  { id: 'RE-ALTA-WIND', name: 'Alta Wind Energy Center', type: 'renewable_farm', source: 'OPENELEC', lat: 35.03, lon: -118.32, country: 'USA', region: 'California', energyType: 'wind', capacityMw: 1548, owner: 'Terra-Gen', lastUpdate: Date.now(), active: true },
  { id: 'RE-SHEPHERDS-FLAT', name: 'Shepherds Flat Wind', type: 'renewable_farm', source: 'OPENELEC', lat: 45.7, lon: -119.7, country: 'USA', region: 'Oregon', energyType: 'wind', capacityMw: 845, owner: 'Caithness', lastUpdate: Date.now(), active: true },
  { id: 'RE-IVANPAH', name: 'Ivanpah Solar', type: 'renewable_farm', source: 'OPENELEC', lat: 35.57, lon: -115.47, country: 'USA', region: 'California', energyType: 'solar', capacityMw: 392, owner: 'BrightSource', lastUpdate: Date.now(), active: true },
  { id: 'RE-TOPAZ', name: 'Topaz Solar Farm', type: 'renewable_farm', source: 'OPENELEC', lat: 35.38, lon: -120.18, country: 'USA', region: 'California', energyType: 'solar', capacityMw: 550, owner: 'First Solar', lastUpdate: Date.now(), active: true },
  { id: 'RE-SAHARA', name: 'Sahara Solar', type: 'renewable_farm', source: 'OPENELEC', lat: 30.0, lon: -7.0, country: 'Morocco', region: 'Ouarzazate', energyType: 'solar', capacityMw: 510, owner: 'MASEN', lastUpdate: Date.now(), active: true },
  { id: 'RE-AUSTRALIA-SOLAR', name: 'Australia Solar Farm', type: 'renewable_farm', source: 'OPENELEC', lat: -34.5, lon: 142.0, country: 'Australia', region: 'New South Wales', energyType: 'solar', capacityMw: 400, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'RE-BRAZIL-WIND', name: 'Brazil Northeast Wind', type: 'renewable_farm', source: 'OPENELEC', lat: -5.0, lon: -38.0, country: 'Brazil', region: 'Ceará', energyType: 'wind', capacityMw: 1000, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'RE-NORWAY-HYDRO', name: 'Norway Hydro Complex', type: 'renewable_farm', source: 'OPENELEC', lat: 61.0, lon: 7.0, country: 'Norway', region: 'Sogn og Fjordane', energyType: 'hydro', capacityMw: 2500, owner: 'Statkraft', lastUpdate: Date.now(), active: true },
  { id: 'RE-QUEBEC-HYDRO', name: 'Quebec Wind/Hydro', type: 'renewable_farm', source: 'OPENELEC', lat: 50.0, lon: -73.0, country: 'Canada', region: 'Quebec', energyType: 'hydro', capacityMw: 3000, owner: 'Hydro-Québec', lastUpdate: Date.now(), active: true },
  { id: 'RE-KENYA-GEOTHERMAL', name: 'Kenya Geothermal', type: 'renewable_farm', source: 'OPENELEC', lat: -0.9, lon: 36.3, country: 'Kenya', region: 'Olkaria', energyType: 'geothermal', capacityMw: 800, owner: 'KenGen', lastUpdate: Date.now(), active: true },
  { id: 'RE-ICELAND-GEOTHERMAL', name: 'Iceland Geothermal', type: 'renewable_farm', source: 'OPENELEC', lat: 64.0, lon: -19.0, country: 'Iceland', region: 'Reykjanes', energyType: 'geothermal', capacityMw: 750, owner: 'Orka', lastUpdate: Date.now(), active: true },

  // Battery storage
  { id: 'BS-MOSS-LANDING', name: 'Moss Landing Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 36.8, lon: -121.78, country: 'USA', region: 'California', capacityMw: 1500, owner: 'Vistra/PG&E', lastUpdate: Date.now(), active: true },
  { id: 'BS-HORNSDALE', name: 'Hornsdale Power Reserve', type: 'battery_storage', source: 'SYNTHETIC', lat: -33.08, lon: 138.52, country: 'Australia', region: 'South Australia', capacityMw: 194, owner: 'Neoen', lastUpdate: Date.now(), active: true },
  { id: 'BS-DRAX', name: 'Drax Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 53.74, lon: -1.0, country: 'UK', region: 'Yorkshire', capacityMw: 200, owner: 'Drax', lastUpdate: Date.now(), active: true },
  { id: 'BS-SCOTLAND', name: 'Coalburn Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 55.6, lon: -3.9, country: 'UK', region: 'Scotland', capacityMw: 500, owner: 'ScottishPower', lastUpdate: Date.now(), active: true },
  { id: 'BS-UK-COTTAM', name: 'Cottam Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 53.3, lon: -0.78, country: 'UK', region: 'Nottinghamshire', capacityMw: 600, owner: 'EPUK', lastUpdate: Date.now(), active: true },
  { id: 'BS-FLORIDA', name: 'Florida Manatee Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 27.5, lon: -82.5, country: 'USA', region: 'Florida', capacityMw: 900, owner: 'FPL', lastUpdate: Date.now(), active: true },
  { id: 'BS-TEXAS', name: 'Texas ERCOT Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 29.8, lon: -95.4, country: 'USA', region: 'Texas', capacityMw: 1200, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'BS-CHINA', name: 'China Grid Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 30.0, lon: 120.0, country: 'China', region: 'Zhejiang', capacityMw: 2000, owner: 'SGCC', lastUpdate: Date.now(), active: true },
  { id: 'BS-GERMANY', name: 'Germany Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 51.0, lon: 10.0, country: 'Germany', region: 'Thuringia', capacityMw: 400, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'BS-INDIA', name: 'India SECI Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 28.5, lon: 77.0, country: 'India', region: 'Rajasthan', capacityMw: 300, owner: 'SECI', lastUpdate: Date.now(), active: true },
  { id: 'BS-JAPAN', name: 'Japan Grid Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 36.0, lon: 140.0, country: 'Japan', region: 'Ibaraki', capacityMw: 250, owner: 'TEPCO', lastUpdate: Date.now(), active: true },
  { id: 'BS-SOUTH-AFRICA', name: 'South Africa BESS', type: 'battery_storage', source: 'SYNTHETIC', lat: -26.0, lon: 28.0, country: 'South Africa', region: 'Gauteng', capacityMw: 150, owner: 'Eskom', lastUpdate: Date.now(), active: true },
  { id: 'BS-CHILE', name: 'Chile BESS', type: 'battery_storage', source: 'SYNTHETIC', lat: -23.0, lon: -70.0, country: 'Chile', region: 'Antofagasta', capacityMw: 200, owner: 'AES', lastUpdate: Date.now(), active: true },
  { id: 'BS-ABU-DHABI', name: 'Abu Dhabi Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 24.4, lon: 54.5, country: 'UAE', region: 'Abu Dhabi', capacityMw: 300, owner: 'Masdar', lastUpdate: Date.now(), active: true },
  { id: 'BS-AUSTRALIA-VIC', name: 'Victoria Big Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: -38.0, lon: 145.0, country: 'Australia', region: 'Victoria', capacityMw: 300, owner: 'Neoen', lastUpdate: Date.now(), active: true },
  { id: 'BS-IRELAND', name: 'Ireland Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 53.0, lon: -7.0, country: 'Ireland', region: 'Offaly', capacityMw: 100, owner: 'Multiple', lastUpdate: Date.now(), active: true },
  { id: 'BS-SWEDEN', name: 'Sweden Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 59.0, lon: 17.0, country: 'Sweden', region: 'Stockholm', capacityMw: 120, owner: 'Vattenfall', lastUpdate: Date.now(), active: true },
  { id: 'BS-FRANCE', name: 'France Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 48.0, lon: 2.0, country: 'France', region: 'Centre', capacityMw: 250, owner: 'TotalEnergies', lastUpdate: Date.now(), active: true },
  { id: 'BS-SOUTH-KOREA', name: 'South Korea Battery', type: 'battery_storage', source: 'SYNTHETIC', lat: 35.0, lon: 127.0, country: 'South Korea', region: 'Jeolla', capacityMw: 350, owner: 'KEPCO', lastUpdate: Date.now(), active: true },

  // Transformers
  { id: 'TR-PJM-345-138', name: 'PJM 345/138 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 39.9, lon: -76.7, country: 'USA', region: 'Pennsylvania', voltageKv: 345, owner: 'PJM', lastUpdate: Date.now(), active: true },
  { id: 'TR-ERCOT-345-138', name: 'ERCOT 345/138 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 30.3, lon: -97.7, country: 'USA', region: 'Texas', voltageKv: 345, owner: 'ERCOT', lastUpdate: Date.now(), active: true },
  { id: 'TR-UK-400-132', name: 'UK 400/132 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 52.5, lon: -1.5, country: 'UK', region: 'Midlands', voltageKv: 400, owner: 'National Grid', lastUpdate: Date.now(), active: true },
  { id: 'TR-CHINA-1000-500', name: 'China 1000/500 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 32.0, lon: 118.0, country: 'China', region: 'Jiangsu', voltageKv: 1000, owner: 'SGCC', lastUpdate: Date.now(), active: true },
  { id: 'TR-GERMAN-380-110', name: 'Germany 380/110 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 50.0, lon: 8.5, country: 'Germany', region: 'Hesse', voltageKv: 380, owner: 'TenneT', lastUpdate: Date.now(), active: true },
  { id: 'TR-INDIA-765-400', name: 'India 765/400 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 26.5, lon: 80.0, country: 'India', region: 'Uttar Pradesh', voltageKv: 765, owner: 'Power Grid', lastUpdate: Date.now(), active: true },
  { id: 'TR-BRAZIL-440-138', name: 'Brazil 440/138 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: -22.0, lon: -47.0, country: 'Brazil', region: 'São Paulo', voltageKv: 440, owner: 'ONS', lastUpdate: Date.now(), active: true },
  { id: 'TR-AUSTRALIA-330-132', name: 'Australia 330/132 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: -33.5, lon: 150.0, country: 'Australia', region: 'NSW', voltageKv: 330, owner: 'TransGrid', lastUpdate: Date.now(), active: true },
  { id: 'TR-SKOREA-345-154', name: 'Korea 345/154 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 37.0, lon: 127.0, country: 'South Korea', region: 'Gyeonggi', voltageKv: 345, owner: 'KEPCO', lastUpdate: Date.now(), active: true },
  { id: 'TR-CANADA-500-230', name: 'Canada 500/230 kV Transformer', type: 'transformer', source: 'SYNTHETIC', lat: 45.0, lon: -75.0, country: 'Canada', region: 'Ontario', voltageKv: 500, owner: 'Hydro One', lastUpdate: Date.now(), active: true },

  // Edge nodes
  { id: 'EDGE-NYC', name: 'NYC Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 40.71, lon: -74.01, country: 'USA', region: 'New York', capacityMw: 20, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-LA', name: 'Los Angeles Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 34.05, lon: -118.24, country: 'USA', region: 'California', capacityMw: 25, owner: 'Fastly', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-LONDON', name: 'London Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 51.51, lon: -0.08, country: 'UK', region: 'London', capacityMw: 18, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-SINGAPORE', name: 'Singapore Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 1.35, lon: 103.85, country: 'Singapore', region: 'Singapore', capacityMw: 22, owner: 'Akamai', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-TOKYO', name: 'Tokyo Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 35.68, lon: 139.77, country: 'Japan', region: 'Tokyo', capacityMw: 20, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-SYDNEY', name: 'Sydney Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: -33.87, lon: 151.21, country: 'Australia', region: 'Sydney', capacityMw: 15, owner: 'Fastly', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-SAO-PAULO', name: 'São Paulo Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: -23.55, lon: -46.63, country: 'Brazil', region: 'São Paulo', capacityMw: 15, owner: 'Akamai', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-MUMBAI', name: 'Mumbai Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 19.08, lon: 72.88, country: 'India', region: 'Maharashtra', capacityMw: 18, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-FRANKFURT', name: 'Frankfurt Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 50.11, lon: 8.68, country: 'Germany', region: 'Hesse', capacityMw: 20, owner: 'Fastly', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-DUBAI', name: 'Dubai Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 25.2, lon: 55.27, country: 'UAE', region: 'Dubai', capacityMw: 12, owner: 'Akamai', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-JOHANNESBURG', name: 'Johannesburg Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: -26.2, lon: 28.04, country: 'South Africa', region: 'Gauteng', capacityMw: 10, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-TORONTO', name: 'Toronto Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 43.65, lon: -79.38, country: 'Canada', region: 'Ontario', capacityMw: 14, owner: 'Fastly', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-MEXICO', name: 'Mexico City Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 19.43, lon: -99.13, country: 'Mexico', region: 'Mexico City', capacityMw: 12, owner: 'Akamai', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-SEOUL', name: 'Seoul Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 37.57, lon: 126.98, country: 'South Korea', region: 'Seoul', capacityMw: 16, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-HONG-KONG', name: 'Hong Kong Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 22.32, lon: 114.17, country: 'China', region: 'Hong Kong', capacityMw: 18, owner: 'Akamai', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-STOCKHOLM', name: 'Stockholm Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 59.33, lon: 18.06, country: 'Sweden', region: 'Stockholm', capacityMw: 10, owner: 'Fastly', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-PARIS', name: 'Paris Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 48.85, lon: 2.35, country: 'France', region: 'Paris', capacityMw: 15, owner: 'Cloudflare', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-MILAN', name: 'Milan Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 45.46, lon: 9.19, country: 'Italy', region: 'Milan', capacityMw: 12, owner: 'Akamai', lastUpdate: Date.now(), active: true },
  { id: 'EDGE-MADRID', name: 'Madrid Edge Node', type: 'edge_node', source: 'DATACENTER_MAP', lat: 40.42, lon: -3.7, country: 'Spain', region: 'Madrid', capacityMw: 11, owner: 'Fastly', lastUpdate: Date.now(), active: true },
]

/* ------------------------------------------------------------------ */
/* Utility helpers (ported from gridDataUtils.ts)                     */
/* ------------------------------------------------------------------ */

/** Haversine distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Build interconnects between assets based on proximity. */
export function buildInterconnects(assets: InternalGridAsset[]): GridInterconnect[] {
  const links: GridInterconnect[] = []
  const linkSet = new Set<string>()
  let id = 0

  const dcAndAi = assets.filter((a) => a.type === 'data_center' || a.type === 'ai_center' || a.type === 'edge_node')
  const substations = assets.filter((a) => a.type === 'substation' || a.type === 'power_plant' || a.type === 'renewable_farm' || a.type === 'battery_storage')

  for (const dc of dcAndAi) {
    const nearby = substations
      .map((s) => ({ s, d: distanceKm(dc.lat, dc.lon, s.lat, s.lon) }))
      .filter((x) => x.d < 400)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
    for (const n of nearby) {
      const s = n.s
      const key = [dc.id, s.id].sort().join('|')
      if (linkSet.has(key)) continue
      linkSet.add(key)
      links.push({
        id: `link-${id++}`,
        sourceAssetId: dc.id,
        targetAssetId: s.id,
        type: 'fiber',
        capacityTbps: dc.type === 'ai_center' ? 50 + Math.random() * 100 : 10 + Math.random() * 40,
        latencyMs: Math.round((n.d / 200) * 10),
        active: true,
        lastUpdate: Date.now(),
      })
    }
  }

  for (let i = 0; i < substations.length; i++) {
    for (let j = i + 1; j < substations.length; j++) {
      const a = substations[i]
      const b = substations[j]
      const d = distanceKm(a.lat, a.lon, b.lat, b.lon)
      if (d > 800) continue
      const key = [a.id, b.id].sort().join('|')
      if (linkSet.has(key)) continue
      linkSet.add(key)
      links.push({
        id: `link-${id++}`,
        sourceAssetId: a.id,
        targetAssetId: b.id,
        type: d < 400 ? 'ac_line' : 'dc_line',
        capacityMw: Math.round(500 + Math.random() * 2000),
        latencyMs: Math.round((d / 300) * 10),
        active: true,
        lastUpdate: Date.now(),
      })
    }
  }

  const transformers = assets.filter((a) => a.type === 'transformer')
  for (const t of transformers) {
    const nearby = substations
      .map((s) => ({ s, d: distanceKm(t.lat, t.lon, s.lat, s.lon) }))
      .filter((x) => x.d < 300 && x.s.id !== t.id)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
    for (const n of nearby) {
      const key = [t.id, n.s.id].sort().join('|')
      if (linkSet.has(key)) continue
      linkSet.add(key)
      links.push({
        id: `link-${id++}`,
        sourceAssetId: t.id,
        targetAssetId: n.s.id,
        type: 'ac_line',
        capacityMw: Math.round(200 + Math.random() * 800),
        latencyMs: Math.round((n.d / 300) * 10),
        active: true,
        lastUpdate: Date.now(),
      })
    }
  }

  return links
}

/** Generate synthetic measurements for all assets. */
export function generateMeasurements(assets: InternalGridAsset[]): Map<string, AssetMeasurement> {
  const m = new Map<string, AssetMeasurement>()
  const now = Date.now()
  for (const asset of assets) {
    const measurement: AssetMeasurement = {
      assetId: asset.id,
      timestamp: now,
    }

    if (asset.type === 'power_plant' || asset.type === 'renewable_farm') {
      const capacity = asset.capacityMw ?? 1000
      const loadFactor = asset.energyType === 'solar' ? 0.25 : asset.energyType === 'wind' ? 0.35 : asset.energyType === 'hydro' ? 0.45 : 0.7
      measurement.generationMw = capacity * loadFactor * (0.85 + Math.random() * 0.3)
      measurement.loadMw = measurement.generationMw
      measurement.voltageKv = asset.voltageKv ?? (asset.type === 'power_plant' ? 400 : 220)
      measurement.frequencyHz = 50 + (Math.random() - 0.5) * 0.2
      measurement.temperatureC = 20 + Math.random() * 40
      measurement.carbonIntensityGco2Kwh = asset.energyType === 'coal' ? 850 : asset.energyType === 'gas' ? 450 : asset.energyType === 'nuclear' ? 12 : asset.energyType === 'hydro' ? 24 : 20 + Math.random() * 30
    } else if (asset.type === 'substation' || asset.type === 'transformer') {
      measurement.voltageKv = asset.voltageKv ?? 220
      measurement.frequencyHz = 50 + (Math.random() - 0.5) * 0.2
      measurement.loadMw = Math.random() * 800
      measurement.temperatureC = 25 + Math.random() * 30
    } else if (asset.type === 'battery_storage') {
      const capacity = asset.capacityMw ?? 100
      measurement.storedMwh = capacity * Math.random() * 2
      measurement.maxStorageMwh = capacity * 2
      measurement.loadMw = (Math.random() - 0.5) * capacity
      measurement.temperatureC = 20 + Math.random() * 15
    } else if (asset.type === 'data_center' || asset.type === 'ai_center') {
      const capacity = asset.capacityMw ?? 50
      measurement.utilizationPercent = 40 + Math.random() * 50
      measurement.itLoadMw = capacity * ((measurement.utilizationPercent ?? 0) / 100)
      measurement.totalFacilityLoadMw = measurement.itLoadMw * (1.2 + Math.random() * 0.3)
      measurement.pue = 1.1 + Math.random() * 0.4
      measurement.temperatureC = 22 + Math.random() * 10
      measurement.carbonIntensityGco2Kwh = 300 + Math.random() * 300
    } else if (asset.type === 'edge_node') {
      measurement.itLoadMw = (asset.capacityMw ?? 10) * (0.3 + Math.random() * 0.5)
      measurement.totalFacilityLoadMw = measurement.itLoadMw * 1.3
      measurement.pue = 1.3 + Math.random() * 0.2
    }

    measurement.loadMw = measurement.loadMw ?? measurement.totalFacilityLoadMw ?? measurement.itLoadMw ?? 0
    m.set(asset.id, measurement)
  }
  return m
}
