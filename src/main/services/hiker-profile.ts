/**
 * Hiker Profile Calibration Engine. Ported from OGOS.
 *
 * Turns a HikerProfile (claimed times, psychology, anchors) into a
 * CalibratedHikerModel that the route planner can actually use.
 *
 * The core problem: people lie, exaggerate, or simply misjudge their
 * own hiking stats. A hiker without GPS who says "10 hours" could have
 * actually hiked 6 hours (with long rest breaks) or 12 hours (pushed hard).
 *
 * We solve this two ways:
 *  1. Perception scaling: based on claimed accuracy, scale reported times
 *  2. Anchor calibration: if we have a known point with a known time
 *     (e.g., "phone found 4 hours from truck"), we can solve for the
 *     hiker's ACTUAL speed and use that to validate/scale their claims.
 */

import type {
  HikerProfile,
  CalibratedHikerModel,
  PerceptionAccuracy,
  NavigationMethod,
  RiskTolerance,
  GoalOrientation,
  RoutePreference,
  LngLat,
  CalibrationAnchor,
} from '@shared/types'

/* ------------------------------------------------------------------ */
/* Perception scaling                                                  */
/* ------------------------------------------------------------------ */

const PERCEPTION_SCALE: Record<PerceptionAccuracy, { scale: number; uncertainty: number }> = {
  precise: { scale: 1.0, uncertainty: 0.05 },
  approximate: { scale: 0.9, uncertainty: 0.2 },
  exaggerated: { scale: 0.6, uncertainty: 0.35 },
  unreliable: { scale: 0.75, uncertainty: 0.5 },
}

const NAV_DISORIENTATION_RISK: Record<NavigationMethod, number> = {
  gps: 0.02,
  'compass-map': 0.08,
  landmark: 0.25,
  none: 0.45,
}

const RISK_SLOPE_ADJUST: Record<RiskTolerance, number> = {
  cautious: -5,
  moderate: 0,
  aggressive: 8,
  reckless: 15,
}

const GOAL_TO_PREFERENCE: Record<GoalOrientation, RoutePreference> = {
  transit: 'least-effort',
  exploration: 'scenic-trail',
  summit: 'peak-ridge',
  search: 'peak-ridge',
  lost: 'valley-contour',
}

const SEARCH_DETOUR_FACTOR = 1.4
const EXPLORATION_DETOUR_FACTOR = 1.25
const LOST_WANDER_FACTOR = 1.6

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function bearingDegrees(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
            Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function getDetourFactor(goal: GoalOrientation): number {
  switch (goal) {
    case 'transit': return 1.0
    case 'exploration': return EXPLORATION_DETOUR_FACTOR
    case 'summit': return 1.2
    case 'search': return SEARCH_DETOUR_FACTOR
    case 'lost': return LOST_WANDER_FACTOR
    default: return 1.0
  }
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

export function calibrateHiker(
  profile: HikerProfile,
  derivedWalkSpeedMps: number,
  derivedSlopeThreshold: number,
): CalibratedHikerModel {
  const {
    perceptionAccuracy, navigationMethod, riskTolerance, goalOrientation,
    claimedTripHours, calibrationAnchors, claimedMultiDay, plannedDays, hasCampingGear,
  } = profile

  const perception = PERCEPTION_SCALE[perceptionAccuracy]
  const disorientationRisk = NAV_DISORIENTATION_RISK[navigationMethod]
  const slopeAdjust = RISK_SLOPE_ADJUST[riskTolerance]
  const routePreference = GOAL_TO_PREFERENCE[goalOrientation]

  let actualWalkSpeedMps = derivedWalkSpeedMps
  let perceptionScale = perception.scale
  let uncertaintyHours = perception.uncertainty
  let estimatedActualHours = claimedTripHours * perceptionScale

  const isMultiDay = claimedMultiDay && hasCampingGear && plannedDays > 1

  let effectiveHoursPerDay = 16
  if (isMultiDay) {
    effectiveHoursPerDay = plannedDays >= 3 ? 12 : plannedDays === 2 ? 14 : 16
  }

  if (calibrationAnchors.length >= 2) {
    const [start, ...rest] = calibrationAnchors
    const speeds: number[] = []
    const detourFactor = getDetourFactor(goalOrientation)

    for (const anchor of rest) {
      if (anchor.hoursFromStart <= 0) continue
      const straightDist = haversineMeters(start.point.lng, start.point.lat, anchor.point.lng, anchor.point.lat)
      const estimatedPathDist = straightDist * detourFactor
      const anchorSpeed = estimatedPathDist / (anchor.hoursFromStart * 3600)
      if (anchorSpeed > 0 && anchorSpeed < 3) {
        speeds.push(anchorSpeed)
      }
    }

    if (speeds.length > 0) {
      speeds.sort((a, b) => a - b)
      const medianSpeed = speeds[Math.floor(speeds.length / 2)]
      actualWalkSpeedMps = medianSpeed

      if (derivedWalkSpeedMps > 0) {
        perceptionScale = medianSpeed / derivedWalkSpeedMps
        uncertaintyHours = Math.min(uncertaintyHours, 0.15)
      }

      if (claimedTripHours > 0) {
        estimatedActualHours = claimedTripHours * perceptionScale
      }
    }
  }

  const detourFactor = getDetourFactor(goalOrientation)
  if (detourFactor > 1) {
    actualWalkSpeedMps = actualWalkSpeedMps / detourFactor
  }

  if (disorientationRisk > 0.2) {
    const disorientationPenalty = 1 + (disorientationRisk - 0.2) * 0.5
    actualWalkSpeedMps = actualWalkSpeedMps / disorientationPenalty
    uncertaintyHours += disorientationRisk * 0.3
  }

  const effectiveSlopeThreshold = Math.max(15, Math.min(60, derivedSlopeThreshold + slopeAdjust))

  let totalTripHours: number
  if (isMultiDay) {
    let total = 0
    for (let day = 1; day <= plannedDays; day++) {
      const dayHours = day >= 3 ? 12 : day === 2 ? 14 : 16
      total += dayHours
    }
    totalTripHours = total
  } else {
    totalTripHours = Math.min(estimatedActualHours, 16)
  }

  let lastKnownWaypoint: CalibratedHikerModel['lastKnownWaypoint']

  const nonEndpointAnchors = calibrationAnchors.filter((a) => !a.isEndpoint)
  if (nonEndpointAnchors.length > 0) {
    const sortedAnchors = [...nonEndpointAnchors].sort((a, b) => b.hoursFromStart - a.hoursFromStart)
    const lkp = sortedAnchors[0]
    const startAnchor = calibrationAnchors[0]

    const timeAfterLkp = Math.max(0, totalTripHours - lkp.hoursFromStart)
    const maxBeyondLkpM = actualWalkSpeedMps * timeAfterLkp * 3600

    let probableBearing = -1
    if (startAnchor && lkp.point !== startAnchor.point) {
      probableBearing = bearingDegrees(startAnchor.point, lkp.point)
    }

    lastKnownWaypoint = {
      point: lkp.point,
      hoursFromStart: lkp.hoursFromStart,
      maxBeyondLkpM,
      probableBearing,
    }
  }

  return {
    actualWalkSpeedMps,
    estimatedActualHours,
    uncertaintyHours,
    routePreference,
    effectiveSlopeThreshold,
    disorientationRisk,
    perceptionScale,
    isMultiDay,
    effectiveHoursPerDay,
    totalTripHours,
    lastKnownWaypoint,
  }
}

/**
 * Compute the maximum radius the hiker could have reached from their
 * start point, given the calibrated model.
 */
export function maxReachRadius(
  model: CalibratedHikerModel,
  hoursAvailable: number,
): { nominalM: number; expandedM: number; contractedM: number } {
  const effectiveHours = model.isMultiDay ? model.totalTripHours : hoursAvailable

  const maxDist = model.actualWalkSpeedMps * effectiveHours * 3600
  const uncertaintyDist = model.actualWalkSpeedMps * model.uncertaintyHours * 3600

  const multiDayExtra = model.isMultiDay ? model.actualWalkSpeedMps * 4 * 3600 : 0

  return {
    nominalM: maxDist,
    expandedM: maxDist + uncertaintyDist + multiDayExtra,
    contractedM: Math.max(0, maxDist - uncertaintyDist - multiDayExtra),
  }
}

/**
 * Compute the search area BEYOND the last known waypoint.
 *
 * Returns a search cone: a bearing, angular spread, and min/max radius
 * defining the area beyond the LKP that should be searched.
 */
export function beyondLkpSearchCone(
  model: CalibratedHikerModel,
): {
  center: LngLat
  bearing: number
  angularSpreadDeg: number
  minRadiusM: number
  maxRadiusM: number
} | null {
  if (!model.lastKnownWaypoint) return null

  const lkp = model.lastKnownWaypoint

  let angularSpread = 60
  if (model.disorientationRisk > 0.3) {
    angularSpread = 120
  } else if (model.disorientationRisk < 0.1) {
    angularSpread = 30
  }

  const bearing = lkp.probableBearing < 0 ? 0 : lkp.probableBearing
  if (lkp.probableBearing < 0) {
    angularSpread = 360
  }

  const minRadiusM = 0
  const maxRadiusM = lkp.maxBeyondLkpM

  return {
    center: lkp.point,
    bearing,
    angularSpreadDeg: angularSpread,
    minRadiusM,
    maxRadiusM,
  }
}

/**
 * Assess whether the hiker's claimed trip is consistent with the
 * calibrated model. Returns a credibility assessment.
 */
export function assessClaimCredibility(
  profile: HikerProfile,
  model: CalibratedHikerModel,
  straightLineDistanceM: number,
): {
  credible: boolean
  reason: string
  impliedSpeedMps: number
  expectedSpeedMps: number
} {
  if (profile.claimedTripHours <= 0) {
    return {
      credible: true,
      reason: 'No claimed time to assess',
      impliedSpeedMps: 0,
      expectedSpeedMps: model.actualWalkSpeedMps,
    }
  }

  const detourFactor = getDetourFactor(profile.goalOrientation)
  const impliedPathDist = straightLineDistanceM * detourFactor
  const impliedSpeed = impliedPathDist / (profile.claimedTripHours * 3600)
  const expectedSpeed = model.actualWalkSpeedMps

  const ratio = impliedSpeed / expectedSpeed
  if (ratio > 2.0) {
    return {
      credible: false,
      reason: `Claimed time implies ${impliedSpeed.toFixed(2)} m/s — over 2x their calibrated speed. Likely exaggerated or the distance is wrong.`,
      impliedSpeedMps: impliedSpeed,
      expectedSpeedMps: expectedSpeed,
    }
  } else if (ratio > 1.5) {
    return {
      credible: false,
      reason: `Claimed time implies ${impliedSpeed.toFixed(2)} m/s — 50% faster than their calibrated speed. Probably exaggerated.`,
      impliedSpeedMps: impliedSpeed,
      expectedSpeedMps: expectedSpeed,
    }
  } else if (ratio < 0.3) {
    return {
      credible: false,
      reason: `Claimed time implies only ${impliedSpeed.toFixed(2)} m/s — 70% slower than expected. They may have been struggling, injured, or the trip was much shorter than claimed.`,
      impliedSpeedMps: impliedSpeed,
      expectedSpeedMps: expectedSpeed,
    }
  }

  return {
    credible: true,
    reason: `Claimed time implies ${impliedSpeed.toFixed(2)} m/s, consistent with their calibrated speed of ${expectedSpeed.toFixed(2)} m/s.`,
    impliedSpeedMps: impliedSpeed,
    expectedSpeedMps: expectedSpeed,
  }
}
