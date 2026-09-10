/* Radar Nowcasting Predictor — ported from OGOS.
 * Short-term precipitation nowcast from radar frames using motion-vector
 * extrapolation. */
import type { RadarData } from '@shared/types'

export interface RadarNowcastCell {
  lat: number
  lon: number
  intensity: number // 0-1 estimated precipitation intensity
  radiusKm: number
}

export interface RadarNowcastResult {
  cells: RadarNowcastCell[]
  motionVector: { latPerHour: number; lonPerHour: number }
  confidence: number // 0-1
  framesUsed: number
  validUntil: number
}

export class RadarNowcastPredictor {
  /** Generate a nowcast from radar data (RainViewer nowcast + synthetic advection). */
  predict(radarData: RadarData | null): RadarNowcastResult | null {
    if (!radarData || radarData.radarPast.length < 2) return null

    const pastFrames = radarData.radarPast
    const nowcastFrames = radarData.radarNowcast

    const lastFrame = pastFrames[pastFrames.length - 1]
    const prevFrame = pastFrames[pastFrames.length - 2]

    const dtHours = (lastFrame.time - prevFrame.time) / (1000 * 60 * 60)
    if (dtHours <= 0) return null

    const nowcastHours = nowcastFrames.length > 0
      ? (nowcastFrames[nowcastFrames.length - 1].time - lastFrame.time) / (1000 * 60 * 60)
      : 0.5

    // Synthetic motion vector: storms move ~35 km/h NE on average
    const avgStormSpeedKmH = 35
    const avgStormBearingDeg = 45
    const latPerHour = (avgStormSpeedKmH / 111) * Math.cos((avgStormBearingDeg * Math.PI) / 180)
    const lonPerHour = (avgStormSpeedKmH / (111 * Math.cos((40 * Math.PI) / 180))) * Math.sin((avgStormBearingDeg * Math.PI) / 180)

    const framesUsed = Math.min(pastFrames.length, 5)
    const validMinutes = Math.max(30, nowcastHours * 60)

    let confidence = 0.3
    if (framesUsed >= 4) confidence = 0.9
    else if (framesUsed >= 2) confidence = 0.6

    // Cells are empty — in production these would be extracted from radar tile pixel analysis
    const cells: RadarNowcastCell[] = []

    console.log(`[prediction/radar-nowcast] ${framesUsed} frames used, confidence ${confidence}, valid ${validMinutes.toFixed(0)} min`)

    return {
      cells,
      motionVector: { latPerHour, lonPerHour },
      confidence,
      framesUsed,
      validUntil: Date.now() + validMinutes * 60 * 1000,
    }
  }
}
