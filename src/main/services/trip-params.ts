/**
 * Trip parameter derivation — converts human + environmental factors into
 * numeric constants that drive the analysis models. Ported from OGOS.
 *
 * Includes physiological risk model:
 *  - Heatstroke risk from temperature, time of day, exertion, age, fitness
 *  - Environmental dehydration rate (how fast conditions dehydrate anyone)
 *  - Speed degradation from heat exhaustion
 *  - Shade urgency (drives rest point scoring in hot conditions)
 *  - Survival window adjusted for physiology
 */

import type {
  TripParams,
  TripDerived,
  Pace,
  PackWeight,
  ExperienceLevel,
  WeatherCondition,
  TimeOfDay,
  AgeGroup,
  FitnessLevel,
} from '@shared/types'

/* ------------------------------------------------------------------ */
/* Speed models                                                        */
/* ------------------------------------------------------------------ */

const PACE_SPEED_MPS: Record<Pace, number> = {
  slow: 0.56, // ~2.0 km/h
  normal: 1.11, // ~4.0 km/h
  fast: 1.67, // ~6.0 km/h
}

const PACK_SPEED_FACTOR: Record<PackWeight, number> = {
  light: 1.0,
  medium: 0.85,
  heavy: 0.70,
}

const PACK_REST_FACTOR: Record<PackWeight, number> = {
  light: 1.0, // rest every 60 min
  medium: 0.75, // rest every 45 min
  heavy: 0.5, // rest every 30 min
}

const FITNESS_SPEED_FACTOR: Record<FitnessLevel, number> = {
  unfit: 0.75,
  average: 1.0,
  fit: 1.15,
}

/* ------------------------------------------------------------------ */
/* Slope thresholds                                                    */
/* ------------------------------------------------------------------ */

const EXPERIENCE_SLOPE_THRESHOLD: Record<ExperienceLevel, number> = {
  novice: 25,
  experienced: 35,
  expert: 45,
}

/* ------------------------------------------------------------------ */
/* Weather models                                                      */
/* ------------------------------------------------------------------ */

const WEATHER_SHELTER_WEIGHT: Record<WeatherCondition, number> = {
  clear: 0.15,
  cloudy: 0.20,
  rain: 0.35,
  snow: 0.45,
  extreme: 0.60,
}

const WEATHER_SURVIVAL_WINDOW_HR: Record<WeatherCondition, number> = {
  clear: 72,
  cloudy: 60,
  rain: 48,
  snow: 24,
  extreme: 12,
}

const WEATHER_SPEED_FACTOR: Record<WeatherCondition, number> = {
  clear: 1.0,
  cloudy: 0.95,
  rain: 0.80,
  snow: 0.60,
  extreme: 0.40,
}

/* ------------------------------------------------------------------ */
/* Physiological models (heatstroke + dehydration)                     */
/* ------------------------------------------------------------------ */

const TOD_SUN_FACTOR: Record<TimeOfDay, number> = {
  morning: 0.4,
  midday: 1.0,
  afternoon: 0.7,
  night: 0.0,
}

const AGE_HEAT_VULNERABILITY: Record<AgeGroup, number> = {
  young: 0.8,
  adult: 1.0,
  elderly: 1.5,
}

const FITNESS_HEAT_TOLERANCE: Record<FitnessLevel, number> = {
  unfit: 0.6,
  average: 0.8,
  fit: 1.0,
}

function computeHeatstrokeRisk(params: TripParams): number {
  const { temperatureC, timeOfDay, ageGroup, fitness, pace, packWeight } = params
  const tempRisk = Math.max(0, Math.min(1, (temperatureC - 20) / 20))
  const sunFactor = TOD_SUN_FACTOR[timeOfDay]
  const ageFactor = AGE_HEAT_VULNERABILITY[ageGroup]
  const fitnessFactor = FITNESS_HEAT_TOLERANCE[fitness]
  const exertionMap: Record<Pace, number> = { slow: 0.7, normal: 1.0, fast: 1.3 }
  const exertion = exertionMap[pace] * PACK_SPEED_FACTOR[packWeight]
  const risk = (tempRisk * sunFactor * ageFactor * exertion) / fitnessFactor
  return Math.max(0, Math.min(1, risk))
}

function computeDehydrationRate(params: TripParams): number {
  const { temperatureC, timeOfDay, pace, packWeight } = params
  const tempRate = 0.3 + Math.max(0, (temperatureC - 15) / 25) * 1.5
  const sunFactor = 0.7 + TOD_SUN_FACTOR[timeOfDay] * 0.5
  const exertionMap: Record<Pace, number> = { slow: 0.8, normal: 1.0, fast: 1.3 }
  const exertion = exertionMap[pace] * PACK_SPEED_FACTOR[packWeight]
  return tempRate * sunFactor * exertion
}

function computePhysioSpeedFactor(_params: TripParams, heatstrokeRisk: number): number {
  return 1.0 - heatstrokeRisk * 0.4
}

function computeShadeUrgency(params: TripParams): number {
  const { temperatureC, timeOfDay } = params
  const tempUrgency = Math.max(0, Math.min(1, (temperatureC - 20) / 15))
  const sunFactor = TOD_SUN_FACTOR[timeOfDay]
  return tempUrgency * sunFactor
}

function computeHoursToSevereDehydration(dehydrationRate: number): number {
  const SEVERE_THRESHOLD_L = 4.0
  if (dehydrationRate <= 0) return Infinity
  return SEVERE_THRESHOLD_L / dehydrationRate
}

function computeAdjustedSurvivalWindow(
  baseWindowHr: number,
  heatstrokeRisk: number,
  hoursToSevereDehydration: number,
): number {
  const heatstrokeWindow = heatstrokeRisk > 0.7 ? 6 : heatstrokeRisk > 0.4 ? 24 : 72
  return Math.min(baseWindowHr, heatstrokeWindow, hoursToSevereDehydration)
}

function computeRiskLabel(heatstrokeRisk: number, survivalWindowHr: number): TripDerived['riskLabel'] {
  if (heatstrokeRisk > 0.7 || survivalWindowHr < 12) return 'critical'
  if (heatstrokeRisk > 0.4 || survivalWindowHr < 24) return 'high'
  if (heatstrokeRisk > 0.2 || survivalWindowHr < 48) return 'moderate'
  return 'low'
}

/* ------------------------------------------------------------------ */
/* Main derivation function                                            */
/* ------------------------------------------------------------------ */

export function deriveTripParams(params: TripParams): TripDerived {
  const heatstrokeRisk = computeHeatstrokeRisk(params)
  const dehydrationRateLPerHr = computeDehydrationRate(params)
  const physioSpeedFactor = computePhysioSpeedFactor(params, heatstrokeRisk)
  const shadeUrgency = computeShadeUrgency(params)
  const hoursToSevereDehydration = computeHoursToSevereDehydration(dehydrationRateLPerHr)

  const baseSpeed = PACE_SPEED_MPS[params.pace]
  const packFactor = PACK_SPEED_FACTOR[params.packWeight]
  const weatherFactor = WEATHER_SPEED_FACTOR[params.weather]
  const fitnessFactor = FITNESS_SPEED_FACTOR[params.fitness]
  const walkSpeedMps = baseSpeed * packFactor * weatherFactor * fitnessFactor * physioSpeedFactor

  const dayFactor = Math.max(0.5, 1 - (params.day - 1) * 0.15)
  const effectiveHours = Math.min(params.hoursSinceLastSeen, 24)
  const maxWalkDistanceM = walkSpeedMps * effectiveHours * 3600 * dayFactor

  const impassableSlopeDeg = EXPERIENCE_SLOPE_THRESHOLD[params.experience]

  const restIntervalMin = 60 * PACK_REST_FACTOR[params.packWeight] * (1 - shadeUrgency * 0.3)

  const shelterWeight = Math.max(
    WEATHER_SHELTER_WEIGHT[params.weather],
    shadeUrgency * 0.5,
  )

  const baseWindow = WEATHER_SURVIVAL_WINDOW_HR[params.weather]
  const survivalWindowHr = computeAdjustedSurvivalWindow(baseWindow, heatstrokeRisk, hoursToSevereDehydration)

  const riskLabel = computeRiskLabel(heatstrokeRisk, survivalWindowHr)

  return {
    walkSpeedMps,
    maxWalkDistanceM,
    impassableSlopeDeg,
    restIntervalMin,
    shelterWeight,
    survivalWindowHr,
    heatstrokeRisk,
    dehydrationRateLPerHr,
    physioSpeedFactor,
    shadeUrgency,
    hoursToSevereDehydration,
    riskLabel,
  }
}

export const DEFAULT_TRIP_PARAMS: TripParams = {
  hoursSinceLastSeen: 12,
  day: 1,
  pace: 'normal',
  packWeight: 'medium',
  experience: 'experienced',
  weather: 'clear',
  temperatureC: 20,
  timeOfDay: 'midday',
  ageGroup: 'adult',
  fitness: 'average',
}

/**
 * Compute search zone radii based on trip params.
 * Zones expand over time — wider rings as hours increase.
 */
export function computeSearchRadii(params: TripParams): number[] {
  const derived = deriveTripParams(params)
  const maxDist = derived.maxWalkDistanceM

  const tightRing = 500
  return [
    tightRing,
    Math.round(maxDist * 0.25),
    Math.round(maxDist * 0.5),
    Math.round(maxDist),
  ].filter((r, i, arr) => i === 0 || r > arr[i - 1])
}
