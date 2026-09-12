/**
 * System Verifier — automated health check for all workstation subsystems.
 *
 * Checks every live feed, climate source, AI service, native addon, system
 * health, and privacy state. Returns a structured report the renderer can
 * display as a floating panel.
 *
 * Privacy-aware: network diagnostics (public IP, ISP, DNS) are only probed
 * at security stage 3 (NETWORK mode). Stages 0-2 skip those probes and
 * report them as "gated by security stage".
 */

import { liveData } from './live/live-data'
import { climateMonitor } from './climate/climate-monitor'
import { isClipServerRunning } from './clip-manager'
import { checkHealth as checkOllamaHealth } from './ollama-service'
import { existsSync } from 'fs'
import { join } from 'path'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface CheckResult {
  name: string
  category: string
  status: CheckStatus
  detail: string
  /** Optional numeric metric (count, latency ms, etc.) */
  value?: number
}

export interface VerifyReport {
  timestamp: number
  durationMs: number
  securityStage: number
  checks: CheckResult[]
  summary: {
    ok: number
    warn: number
    fail: number
    skip: number
    total: number
  }
}

/** Progress event emitted during verification. */
export interface VerifyProgress {
  completed: number
  total: number
  currentCategory: string
  lastCheck: string | null
}

/** Run all verification checks. Security stage gates network probes. */
export async function verifySystem(
  securityStage: number,
  onProgress?: (p: VerifyProgress) => void,
): Promise<VerifyReport> {
  const start = Date.now()
  const checks: CheckResult[] = []

  // Total expected checks (used for progress bar)
  const total = 22
  const emit = (currentCategory: string) => {
    onProgress?.({
      completed: checks.length,
      total,
      currentCategory,
      lastCheck: checks.length > 0 ? checks[checks.length - 1].name : null,
    })
  }

  // Helper that pushes a check and emits progress
  const add = (category: string, check: CheckResult) => {
    checks.push(check)
    emit(category)
  }

  // ── Live feeds (always checked — no privacy concern, they're public APIs) ──
  await checkLiveFeeds(add)

  // ── Climate / ERDDAP ──
  await checkClimate(add)

  // ── AI services ──
  await checkAiServices(add)

  // ── Native addons ──
  checkNativeAddons(add)

  // ── System health ──
  await checkSystemHealth(add, securityStage)

  // ── Privacy/security state ──
  checkPrivacyState(add, securityStage)

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    skip: checks.filter((c) => c.status === 'skip').length,
    total: checks.length,
  }

  return {
    timestamp: start,
    durationMs: Date.now() - start,
    securityStage,
    checks,
    summary,
  }
}

// ── Live feeds ──
async function checkLiveFeeds(add: (cat: string, c: CheckResult) => void): Promise<void> {
  // We can't directly read liveData.features (private), so we re-fetch counts
  // by calling the same getters the plugins use. This also verifies the
  // fetchers actually respond.
  const feedChecks: Array<{ name: string; fn: () => Promise<unknown> }> = []

  try {
    const { getAircraftFeatures } = await import('./live/aircraft')
    const { getVesselFeatures } = await import('./live/vessels')
    const { getFireFeatures } = await import('./live/fires')
    const { getLightningFeatures } = await import('./live/lightning')
    const { getSatelliteFeatures } = await import('./live/satellites')

    feedChecks.push(
      { name: 'Aircraft (ADS-B)', fn: async () => (await getAircraftFeatures()).length },
      { name: 'Vessels (AIS)', fn: async () => (await getVesselFeatures()).length },
      { name: 'Fires (kanari/FIRMS)', fn: async () => (await getFireFeatures()).length },
      { name: 'Lightning (Blitzortung)', fn: async () => (await getLightningFeatures()).length },
      { name: 'Satellites (TLE)', fn: async () => (await getSatelliteFeatures()).length },
    )
  } catch (e) {
    add('live', { name: 'Live feeds import', category: 'live', status: 'fail', detail: `Import failed: ${(e as Error).message}` })
    return
  }

  // Earthquakes — fetched via USGS directly in live-data, re-fetch here
  try {
    const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const data = (await res.json()) as { features: unknown[] }
      add('live', { name: 'Earthquakes (USGS)', category: 'live', status: 'ok', detail: `${data.features.length} quakes M≥2.5`, value: data.features.length })
    } else {
      add('live', { name: 'Earthquakes (USGS)', category: 'live', status: 'warn', detail: `HTTP ${res.status}` })
    }
  } catch (e) {
    add('live', { name: 'Earthquakes (USGS)', category: 'live', status: 'fail', detail: (e as Error).message })
  }

  // Run feed checks in parallel
  const results = await Promise.allSettled(feedChecks.map(async (f) => {
    const count = await f.fn()
    return { name: f.name, count: count as number }
  }))

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const name = feedChecks[i].name
    if (r.status === 'fulfilled') {
      const count = r.value.count
      if (count > 0) {
        add('live', { name, category: 'live', status: 'ok', detail: `${count} features`, value: count })
      } else {
        add('live', { name, category: 'live', status: 'warn', detail: '0 features (feed may be down or empty)' })
      }
    } else {
      add('live', { name, category: 'live', status: 'fail', detail: (r.reason as Error)?.message ?? 'unknown error' })
    }
  }
}

// ── Climate / ERDDAP ──
async function checkClimate(add: (cat: string, c: CheckResult) => void): Promise<void> {
  // Read from climateMonitor's cached state (no re-fetch — that's a 4-min cycle)
  const stations = climateMonitor.getStations()
  const storms = climateMonitor.getStorms()
  const spaceWeather = climateMonitor.getSpaceWeather()

  add('climate', {
    name: 'Climate stations (all sources)',
    category: 'climate',
    status: stations.length > 0 ? 'ok' : 'warn',
    detail: `${stations.length} stations cached`,
    value: stations.length,
  })

  add('climate', {
    name: 'Active storms (NHC + NWS)',
    category: 'climate',
    status: storms.length > 0 ? 'ok' : 'warn',
    detail: `${storms.length} active storms`,
    value: storms.length,
  })

  add('climate', {
    name: 'Space weather (SWPC)',
    category: 'climate',
    status: spaceWeather ? 'ok' : 'warn',
    detail: spaceWeather
      ? `Kp=${spaceWeather.kpIndex ?? 'n/a'}, SW=${spaceWeather.solarWindSpeed ?? 'n/a'} km/s`
      : 'no data yet (may still be fetching)',
  })

  // Test ERDDAP reachability directly (privacy-safe — public API)
  try {
    const res = await fetch('https://coastwatch.pfeg.noaa.gov/erddap/info/cwwcNDBCMet/index.json', {
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      add('climate', { name: 'ERDDAP coastwatch.pfeg.noaa.gov', category: 'climate', status: 'ok', detail: 'reachable' })
    } else {
      add('climate', { name: 'ERDDAP coastwatch.pfeg.noaa.gov', category: 'climate', status: 'warn', detail: `HTTP ${res.status}` })
    }
  } catch (e) {
    add('climate', {
      name: 'ERDDAP coastwatch.pfeg.noaa.gov',
      category: 'climate',
      status: 'fail',
      detail: `unreachable — ${(e as Error).message} (check VPN/DNS)`,
    })
  }

  // NHC reachability
  try {
    const res = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      add('climate', { name: 'NHC storms (nhc.noaa.gov)', category: 'climate', status: 'ok', detail: 'reachable' })
    } else {
      add('climate', { name: 'NHC storms (nhc.noaa.gov)', category: 'climate', status: 'warn', detail: `HTTP ${res.status}` })
    }
  } catch (e) {
    add('climate', {
      name: 'NHC storms (nhc.noaa.gov)',
      category: 'climate',
      status: 'fail',
      detail: `unreachable — ${(e as Error).message} (DNS may be failing)`,
    })
  }
}

// ── AI services ──
async function checkAiServices(add: (cat: string, c: CheckResult) => void): Promise<void> {
  // CLIP server
  try {
    const res = await fetch('http://localhost:9776/health', { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json() as { model?: string; running?: boolean }
      add('ai', {
        name: 'CLIP server (:9776)',
        category: 'ai',
        status: 'ok',
        detail: `online — model: ${data.model ?? 'unknown'}`,
      })
    } else {
      add('ai', { name: 'CLIP server (:9776)', category: 'ai', status: 'warn', detail: `HTTP ${res.status}` })
    }
  } catch (e) {
    add('ai', {
      name: 'CLIP server (:9776)',
      category: 'ai',
      status: 'fail',
      detail: `not responding — ${(e as Error).message}`,
    })
  }

  // Ollama
  try {
    const health = await checkOllamaHealth()
    if (health.running) {
      add('ai', {
        name: 'Ollama (:11434)',
        category: 'ai',
        status: 'ok',
        detail: `${health.models.length} models available`,
        value: health.models.length,
      })
    } else {
      add('ai', { name: 'Ollama (:11434)', category: 'ai', status: 'fail', detail: 'not running' })
    }
  } catch (e) {
    add('ai', { name: 'Ollama (:11434)', category: 'ai', status: 'fail', detail: (e as Error).message })
  }
}

// ── Native addons ──
function checkNativeAddons(add: (cat: string, c: CheckResult) => void): void {
  // OpenXR bridge
  const addonPath = join(__dirname, '..', 'native', 'openxr-bridge', 'build', 'Release', 'xr-native.node')
  const addonExists = existsSync(addonPath)
  add('native', {
    name: 'OpenXR native addon',
    category: 'native',
    status: addonExists ? 'ok' : 'warn',
    detail: addonExists ? 'built (Meta Quest 3S ready)' : 'not built — run: cd native/openxr-bridge && npm install && npm run build',
  })
}

// ── System health ──
async function checkSystemHealth(add: (cat: string, c: CheckResult) => void, securityStage: number): Promise<void> {
  // Memory usage (process)
  const mem = process.memoryUsage()
  const memMB = mem.rss / 1024 / 1024
  add('system', {
    name: 'Main process memory',
    category: 'system',
    status: memMB < 1500 ? 'ok' : memMB < 3000 ? 'warn' : 'fail',
    detail: `${memMB.toFixed(0)} MB RSS`,
    value: Math.round(memMB),
  })

  // Uptime
  const uptimeMin = process.uptime() / 60
  add('system', {
    name: 'Process uptime',
    category: 'system',
    status: 'ok',
    detail: `${uptimeMin.toFixed(1)} min`,
  })

  // Network reachability — public APIs (privacy-safe, no user info leaked)
  try {
    const res = await fetch('https://api.openstreetmap.org/', { signal: AbortSignal.timeout(8000) })
    add('system', {
      name: 'Internet reachability',
      category: 'system',
      status: res.ok ? 'ok' : 'warn',
      detail: res.ok ? 'OSM reachable' : `HTTP ${res.status}`,
    })
  } catch (e) {
    add('system', { name: 'Internet reachability', category: 'system', status: 'fail', detail: (e as Error).message })
  }

  // Stage 3 only: network diagnostics (public IP, DNS)
  if (securityStage >= 3) {
    try {
      const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json() as { ip: string }
        add('system', {
          name: 'Public IP (stage 3)',
          category: 'system',
          status: 'ok',
          detail: `${data.ip}`,
        })
      } else {
        add('system', { name: 'Public IP (stage 3)', category: 'system', status: 'warn', detail: `HTTP ${res.status}` })
      }
    } catch (e) {
      add('system', { name: 'Public IP (stage 3)', category: 'system', status: 'fail', detail: (e as Error).message })
    }
  } else {
    add('system', {
      name: 'Public IP (stage 3)',
      category: 'system',
      status: 'skip',
      detail: `gated — requires stage 3 (current: stage ${securityStage})`,
    })
  }
}

// ── Privacy/security state ──
function checkPrivacyState(add: (cat: string, c: CheckResult) => void, securityStage: number): void {
  const stageNames = ['LOCK (locationless)', 'AI (regional context)', 'FULL OSINT', 'NETWORK']
  const stageName = stageNames[securityStage] ?? `Stage ${securityStage}`

  add('privacy', {
    name: 'Security stage',
    category: 'privacy',
    status: 'ok',
    detail: `stage ${securityStage} — ${stageName}`,
  })

  add('privacy', {
    name: 'AI privacy mode',
    category: 'privacy',
    status: 'ok',
    detail: securityStage < 2 ? 'active (coordinates coarsened, locationless phrasing)' : 'disabled (exact coordinates allowed)',
  })

  add('privacy', {
    name: 'Web search privacy',
    category: 'privacy',
    status: 'ok',
    detail: securityStage >= 2 ? 'enabled (full context)' : 'gated (no viewport/context sent)',
  })

  add('privacy', {
    name: 'Network diagnostics',
    category: 'privacy',
    status: securityStage >= 3 ? 'ok' : 'skip',
    detail: securityStage >= 3 ? 'unlocked' : `gated — requires stage 3`,
  })
}
