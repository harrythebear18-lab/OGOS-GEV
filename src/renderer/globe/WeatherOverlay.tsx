/**
 * WeatherOverlay — elegant weather forecast display.
 *
 * Floating panel showing:
 *  - Current conditions card (temp, feels-like, wind, humidity, precip, weather code)
 *  - 24h hourly forecast strip (temp + precip probability chart)
 *  - Radar/satellite toggle controls
 *
 * Fetches forecast for the LKP pin or viewport center via IPC.
 * Subscribes to weather plugin state through a polling refresh.
 */

import { useState, useEffect, useRef } from 'react'
import type { WeatherResponse, CurrentWeather, HourlyForecast, RadarData } from '@shared/types'
import { describeWeatherCode } from '../weather-codes'

interface WeatherOverlayProps {
  onClose: () => void
}

export default function WeatherOverlay({ onClose }: WeatherOverlayProps) {
  const [forecast, setForecast] = useState<WeatherResponse | null>(null)
  const [radar, setRadar] = useState<RadarData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRadar, setShowRadar] = useState(true)
  const [showSatellite, setShowSatellite] = useState(false)
  const lastPointRef = useRef<{ lng: number; lat: number } | null>(null)

  // Subscribe to scene context to get LKP / viewport center
  useEffect(() => {
    let mounted = true
    window.api.scene.onContext((ctx: unknown) => {
      const c = ctx as any
      const lkp = c?.lkp
      const center = c?.camera?.center
      const point = lkp ?? center
      if (!point || !mounted) return
      // Only refetch if moved >0.05°
      const last = lastPointRef.current
      if (last && Math.abs(point.lng - last.lng) < 0.05 && Math.abs(point.lat - last.lat) < 0.05) return
      lastPointRef.current = point
      fetchForecast(point)
    })

    // Fetch radar data on mount
    fetchRadar()

    return () => { mounted = false }
  }, [])

  async function fetchForecast(point: { lng: number; lat: number }): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.weather.forecast(point) as WeatherResponse | null
      if (result) setForecast(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function fetchRadar(): Promise<void> {
    try {
      const result = await window.api.weather.radar() as RadarData | null
      if (result) setRadar(result)
    } catch (err) {
      console.warn('[weather-overlay] radar fetch failed:', err)
    }
  }

  const c = forecast?.current
  const hourly = forecast?.hourly ?? []

  return (
    <div style={overlayStyle.container}>
      {/* Header */}
      <div style={overlayStyle.header}>
        <span style={overlayStyle.title}>🌦 WEATHER</span>
        <button style={overlayStyle.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* Radar toggles */}
      <div style={overlayStyle.radarRow}>
        <button
          style={overlayStyle.toggleBtn(showRadar)}
          onClick={() => {
            const next = !showRadar
            setShowRadar(next)
            window.api.scene.set({ weatherRadar: next })
          }}
        >
          RADAR
        </button>
        <button
          style={overlayStyle.toggleBtn(showSatellite)}
          onClick={() => {
            const next = !showSatellite
            setShowSatellite(next)
            window.api.scene.set({ weatherSatellite: next })
          }}
        >
          SAT IR
        </button>
        {radar && (
          <span style={overlayStyle.radarInfo}>
            {radar.radarPast.length + radar.radarNowcast.length} frames
          </span>
        )}
      </div>

      {/* Current conditions */}
      {loading && !c && <div style={overlayStyle.loading}>Fetching forecast…</div>}
      {error && <div style={overlayStyle.error}>{error}</div>}
      {!c && !loading && !error && (
        <div style={overlayStyle.hint}>Place an LKP pin or move the camera to load forecast</div>
      )}
      {c && <CurrentConditionsCard current={c} />}

      {/* 24h hourly forecast chart */}
      {hourly.length > 0 && <HourlyForecastChart hourly={hourly} />}
    </div>
  )
}

/** Current conditions card with weather icon + key metrics */
function CurrentConditionsCard({ current }: { current: CurrentWeather }) {
  const tempColor = current.temperature > 30 ? '#ff6a3a' : current.temperature > 20 ? '#ffea4a' : current.temperature > 5 ? '#4aff8a' : '#4a8aff'
  const weatherDesc = describeWeatherCode(current.weatherCode)
  const isDay = current.isDay

  // Simple weather icon based on code
  const icon = weatherIcon(current.weatherCode, isDay)

  return (
    <div style={cardStyle.container}>
      <div style={cardStyle.mainRow}>
        <span style={cardStyle.icon}>{icon}</span>
        <div style={cardStyle.tempCol}>
          <span style={{ ...cardStyle.temp, color: tempColor }}>
            {current.temperature.toFixed(0)}°C
          </span>
          <span style={cardStyle.feels}>Feels {current.apparentTemp.toFixed(0)}°C</span>
        </div>
        <div style={cardStyle.descCol}>
          <span style={cardStyle.desc}>{weatherDesc}</span>
          <span style={cardStyle.location}>
            {isDay ? '☀ Day' : '🌙 Night'}
          </span>
        </div>
      </div>
      <div style={cardStyle.metricsGrid}>
        <Metric label="WIND" value={`${current.windSpeed.toFixed(0)} km/h`} color="#4affd4" />
        <Metric label="DIR" value={`${current.windDir.toFixed(0)}°`} color="#4affd4" />
        <Metric label="HUMID" value={`${current.humidity.toFixed(0)}%`} color="#4a8aff" />
        <Metric label="PRECIP" value={`${current.precipitation.toFixed(1)}mm`} color={current.precipitation > 0 ? '#4a8aff' : '#6b7d92'} />
      </div>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={cardStyle.metric}>
      <span style={cardStyle.metricLabel}>{label}</span>
      <span style={{ ...cardStyle.metricVal, color }}>{value}</span>
    </div>
  )
}

/** 24h hourly forecast chart — temp line + precip probability bars */
function HourlyForecastChart({ hourly }: { hourly: HourlyForecast[] }) {
  if (hourly.length === 0) return null
  const hours = hourly.slice(0, 24)
  const temps = hours.map((h) => h.temp)
  const maxTemp = Math.max(...temps)
  const minTemp = Math.min(...temps)
  const tempRange = Math.max(maxTemp - minTemp, 1)
  const maxPrecipProb = Math.max(...hours.map((h) => h.precipProb), 1)

  const W = 280
  const H = 80
  const padL = 24
  const padR = 8
  const padT = 8
  const padB = 16
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  // Temp line points
  const tempPoints = hours.map((h, i) => {
    const x = padL + (i / (hours.length - 1)) * chartW
    const y = padT + (1 - (h.temp - minTemp) / tempRange) * chartH
    return { x, y, temp: h.temp }
  })
  const tempPath = tempPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <div style={chartStyle.container}>
      <div style={chartStyle.header}>
        <span style={chartStyle.title}>24H FORECAST</span>
        <span style={chartStyle.range}>
          <span style={{ color: '#ff8a4a' }}>{maxTemp.toFixed(0)}°</span>
          <span style={{ color: '#6b7d92' }}> / </span>
          <span style={{ color: '#4a8aff' }}>{minTemp.toFixed(0)}°</span>
        </span>
      </div>
      <svg width={W} height={H} style={chartStyle.svg}>
        {/* Precip probability bars */}
        {hours.map((h, i) => {
          const x = padL + (i / (hours.length - 1)) * chartW
          const barW = chartW / hours.length * 0.7
          const barH = (h.precipProb / maxPrecipProb) * chartH * 0.4
          return (
            <rect
              key={i}
              x={x - barW / 2}
              y={padT + chartH - barH}
              width={barW}
              height={barH}
              fill={h.precipProb > 50 ? '#4a8aff' : h.precipProb > 20 ? '#4a9eff' : '#1e3a5a'}
              opacity={0.5}
            />
          )
        })}
        {/* Temp line */}
        <path d={tempPath} fill="none" stroke="#ffea4a" strokeWidth={1.5} />
        {/* Temp points */}
        {tempPoints.filter((_, i) => i % 3 === 0).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="#ffea4a" />
        ))}
        {/* Hour labels */}
        {hours.filter((_, i) => i % 6 === 0).map((h, i) => {
          const idx = hours.indexOf(h)
          const x = padL + (idx / (hours.length - 1)) * chartW
          const hr = new Date(h.time).getHours()
          return (
            <text key={i} x={x} y={H - 4} fill="#6b7d92" fontSize={7} textAnchor="middle" fontFamily="monospace">
              {hr}:00
            </text>
          )
        })}
      </svg>
      <div style={chartStyle.legend}>
        <span style={chartStyle.legendItem}><span style={chartStyle.legendLine('yellow')} />Temp</span>
        <span style={chartStyle.legendItem}><span style={chartStyle.legendBar('blue')} />Precip %</span>
      </div>
    </div>
  )
}

/** Weather icon emoji based on WMO weather code */
function weatherIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '☀️' : '🌙'
  if (code <= 2) return isDay ? '🌤️' : '☁️'
  if (code === 3) return '☁️'
  if (code >= 45 && code <= 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '🌨️'
  if (code >= 80 && code <= 82) return '🌧️'
  if (code >= 85 && code <= 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

// ── Styles ──

const overlayStyle: Record<string, any> = {
  container: {
    position: 'absolute',
    top: 60,
    right: 12,
    zIndex: 200,
    width: 300,
    background: 'rgba(11, 15, 20, 0.95)',
    border: '1px solid #1e2a3a',
    borderRadius: 4,
    padding: 8,
    color: '#c0c8d0',
    fontFamily: 'monospace',
    fontSize: 11,
    backdropFilter: 'blur(8px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#4a9eff',
    letterSpacing: 1,
    fontSize: 10,
    fontWeight: 'bold',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8a9a',
    cursor: 'pointer',
    fontSize: 12,
  },
  radarRow: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    marginBottom: 6,
  },
  toggleBtn: (active: boolean): React.CSSProperties => ({
    padding: '2px 8px',
    fontSize: 8,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    cursor: 'pointer',
    border: active ? '1px solid #4a9eff' : '1px solid #2a3a4a',
    borderRadius: 2,
    background: active ? 'rgba(74, 158, 255, 0.15)' : 'transparent',
    color: active ? '#4a9eff' : '#6b7d92',
    fontWeight: 'bold',
  }),
  radarInfo: {
    fontSize: 8,
    color: '#6b7d92',
    marginLeft: 'auto',
  },
  loading: {
    color: '#6b7d92',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '12px 0',
  },
  error: {
    color: '#ff8a8a',
    fontSize: 9,
    padding: '4px 0',
  },
  hint: {
    color: '#6b7d92',
    fontSize: 9,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '8px 0',
  },
}

const cardStyle: Record<string, any> = {
  container: {
    background: 'rgba(11, 15, 20, 0.6)',
    border: '1px solid #1e2a3a',
    borderRadius: 3,
    padding: 8,
    marginBottom: 4,
  },
  mainRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  icon: {
    fontSize: 28,
  },
  tempCol: {
    display: 'flex',
    flexDirection: 'column',
  },
  temp: {
    fontSize: 22,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  feels: {
    fontSize: 9,
    color: '#6b7d92',
  },
  descCol: {
    display: 'flex',
    flexDirection: 'column',
    marginLeft: 'auto',
    textAlign: 'right',
  },
  desc: {
    fontSize: 10,
    color: '#c0c8d0',
  },
  location: {
    fontSize: 8,
    color: '#6b7d92',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: 4,
  },
  metric: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'rgba(11, 15, 20, 0.5)',
    borderRadius: 2,
    padding: '3px 2px',
  },
  metricLabel: {
    fontSize: 7,
    color: '#6b7d92',
    letterSpacing: 0.5,
  },
  metricVal: {
    fontSize: 10,
    fontWeight: 'bold',
  },
}

const chartStyle: Record<string, any> = {
  container: {
    background: 'rgba(11, 15, 20, 0.6)',
    border: '1px solid #1e2a3a',
    borderRadius: 3,
    padding: 6,
    marginTop: 4,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 9,
    color: '#6b7d92',
    letterSpacing: 1,
    fontWeight: 'bold',
  },
  range: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  svg: {
    display: 'block',
  },
  legend: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    marginTop: 2,
  },
  legendItem: {
    fontSize: 8,
    color: '#6b7d92',
    display: 'flex',
    alignItems: 'center',
    gap: 3,
  },
  legendLine: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    width: 10,
    height: 2,
    background: color === 'yellow' ? '#ffea4a' : '#4a8aff',
  }),
  legendBar: (_color: string): React.CSSProperties => ({
    display: 'inline-block',
    width: 6,
    height: 8,
    background: '#4a8aff',
    opacity: 0.5,
  }),
}
