/**
 * Space weather fetcher — ported from OGOS weatherFetcher.ts SpaceWeatherFetcher.
 * Fetches from NOAA SWPC (Space Weather Prediction Center):
 *   - GOES X-ray flux (current solar flare class/intensity)
 *   - Planetary K-index (geomagnetic activity)
 *   - Geospace propagated solar wind (speed, density)
 *   - GOES proton/electron flux
 *
 * Returns our shared SpaceWeather type (simplified current-conditions snapshot).
 */

import type { SpaceWeather } from '@shared/types'

function safeNum(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined
  const n = typeof val === 'number' ? val : parseFloat(val)
  return isNaN(n) ? undefined : n
}

export class SpaceWeatherFetcher {
  static async fetch(): Promise<SpaceWeather> {
    const [flare, kp, solarWind, protonFlux, electronFlux] = await Promise.allSettled([
      this.fetchXrayFlare(),
      this.fetchKpIndex(),
      this.fetchSolarWind(),
      this.fetchProtonFlux(),
      this.fetchElectronFlux(),
    ])

    const flareData = flare.status === 'fulfilled' ? flare.value : null
    const kpIndex = kp.status === 'fulfilled' ? kp.value : undefined
    const sw = solarWind.status === 'fulfilled' ? solarWind.value : null
    const pf = protonFlux.status === 'fulfilled' ? protonFlux.value : undefined
    const ef = electronFlux.status === 'fulfilled' ? electronFlux.value : undefined

    // Derive aurora forecast from Kp index
    let auroraForecast: string | undefined
    if (kpIndex !== undefined) {
      if (kpIndex >= 7) auroraForecast = 'High — visible at mid-latitudes'
      else if (kpIndex >= 5) auroraForecast = 'Moderate — visible at high latitudes'
      else if (kpIndex >= 3) auroraForecast = 'Low — visible near polar regions'
      else auroraForecast = 'Minimal'
    }

    const result: SpaceWeather = {
      xrayFlareClass: flareData?.classType,
      xrayFlareIntensity: flareData?.intensity,
      protonFlux: pf,
      electronFlux: ef,
      solarWindSpeed: sw?.speed,
      solarWindDensity: sw?.density,
      kpIndex,
      auroraForecast,
      timestamp: Date.now(),
    }

    console.log(
      `[climate/space-weather] flare=${result.xrayFlareClass ?? 'n/a'}${result.xrayFlareIntensity ?? ''}, ` +
      `Kp=${result.kpIndex ?? 'n/a'}, SW=${result.solarWindSpeed ?? 'n/a'} km/s, ` +
      `density=${result.solarWindDensity ?? 'n/a'}/cm³`,
    )
    return result
  }

  /** Fetch current X-ray flare class from GOES primary 6-hour flux data */
  private static async fetchXrayFlare(): Promise<{ classType: string; intensity: number } | null> {
    try {
      const res = await fetch(
        'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return null
      const data = await res.json()
      if (!Array.isArray(data)) return null

      // Filter to the 0.1-0.8nm channel (long channel, used for classification)
      const longChannel = (data as any[]).filter((e) => e.energy === '0.1-0.8nm')
      if (longChannel.length === 0) return null

      // Find the peak flux in the data
      let peakFlux = 0
      let peakTime = 0
      for (const entry of longChannel) {
        const flux = entry.observed_flux ?? entry.flux ?? 0
        if (flux > peakFlux) {
          peakFlux = flux
          peakTime = entry.time_tag ? new Date(entry.time_tag).getTime() : Date.now()
        }
      }

      if (peakFlux <= 0) return null

      // Classify: X >= 1e-4, M >= 1e-5, C >= 1e-6, B >= 1e-7, A >= 1e-8
      let cls = 'A'
      let intensity = peakFlux / 1e-8
      if (peakFlux >= 1e-4) {
        cls = 'X'
        intensity = peakFlux / 1e-4
      } else if (peakFlux >= 1e-5) {
        cls = 'M'
        intensity = peakFlux / 1e-5
      } else if (peakFlux >= 1e-6) {
        cls = 'C'
        intensity = peakFlux / 1e-6
      } else if (peakFlux >= 1e-7) {
        cls = 'B'
        intensity = peakFlux / 1e-7
      }

      return { classType: cls, intensity: Math.round(intensity * 10) / 10 }
    } catch {
      return null
    }
  }

  /** Fetch current planetary K-index from NOAA SWPC */
  private static async fetchKpIndex(): Promise<number | undefined> {
    try {
      const res = await fetch(
        'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return undefined
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return undefined

      const lastKp = data[data.length - 1] as any
      // Format: [time_tag, Kp, a_running, station_count]
      return safeNum(lastKp?.[1]) ?? safeNum(lastKp?.Kp) ?? safeNum(lastKp?.kp)
    } catch {
      return undefined
    }
  }

  /** Fetch solar wind speed and density from geospace propagated solar wind */
  private static async fetchSolarWind(): Promise<{ speed?: number; density?: number } | null> {
    try {
      const res = await fetch(
        'https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json',
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return null
      const data = await res.json()
      if (!Array.isArray(data) || data.length < 2) return null

      // Format: [time_tag, speed, density, temperature, ...]
      const lastEntry = data[data.length - 1] as any[]
      return {
        speed: safeNum(lastEntry?.[1]),
        density: safeNum(lastEntry?.[2]),
      }
    } catch {
      return null
    }
  }

  /** Fetch proton flux from GOES (>=10 MeV) */
  private static async fetchProtonFlux(): Promise<number | undefined> {
    try {
      const res = await fetch(
        'https://services.swpc.noaa.gov/json/goes/primary/protons-1-day.json',
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return undefined
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return undefined

      // Find the latest entry with >=10 MeV proton flux
      const tenMeV = (data as any[]).filter((e) => e.energy === '>=10 MeV' || e.energy === '10')
      if (tenMeV.length === 0) return undefined
      const last = tenMeV[tenMeV.length - 1]
      return safeNum(last?.flux ?? last?.Flux)
    } catch {
      return undefined
    }
  }

  /** Fetch electron flux from GOES (>=2 MeV) */
  private static async fetchElectronFlux(): Promise<number | undefined> {
    try {
      const res = await fetch(
        'https://services.swpc.noaa.gov/json/goes/primary/electrons-1-day.json',
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return undefined
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return undefined

      // Find the latest entry with >=2 MeV electron flux
      const twoMeV = (data as any[]).filter((e) => e.energy === '>=2 MeV' || e.energy === '2')
      if (twoMeV.length === 0) return undefined
      const last = twoMeV[twoMeV.length - 1]
      return safeNum(last?.flux ?? last?.Flux)
    } catch {
      return undefined
    }
  }
}
