/**
 * Weather Service — RainViewer radar + Open-Meteo forecast.
 * Ported from OSINT-Global-OS. All sources are free, no key required.
 */

import type { LngLat, RadarData, RadarFrame, WeatherResponse, CurrentWeather, HourlyForecast } from '@shared/types'

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json'

export async function fetchRadarData(): Promise<RadarData> {
  const res = await fetch(RAINVIEWER_API)
  if (!res.ok) throw new Error(`RainViewer API error: ${res.status}`)
  const data = await res.json()

  return {
    host: data.host,
    radarPast: (data.radar?.past || []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path })),
    radarNowcast: (data.radar?.nowcast || []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path })),
    satellite: (data.satellite?.infrared || []).map((f: { time: number; path: string }) => ({ time: f.time, path: f.path })),
    generated: Date.now(),
  }
}

export function buildRadarTileUrl(host: string, frame: RadarFrame, opts: {
  size?: number; color?: number; smooth?: boolean; snow?: boolean
} = {}): string {
  const { size = 512, color = 4, smooth = true, snow = true } = opts
  return `${host}${frame.path}/${size}/{z}/{x}/{y}/${color}/${smooth ? 1 : 0}_${snow ? 1 : 0}.png`
}

export function buildSatelliteTileUrl(host: string, frame: RadarFrame, opts: {
  size?: number; color?: number
} = {}): string {
  const { size = 512, color = 0 } = opts
  return `${host}${frame.path}/${size}/{z}/{x}/{y}/${color}/0_0.png`
}

export async function fetchWeather(point: LngLat): Promise<WeatherResponse> {
  const params = new URLSearchParams({
    latitude: point.lat.toString(),
    longitude: point.lng.toString(),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day',
    hourly: 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code',
    forecast_hours: '24',
    timezone: 'auto',
  })

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`)
  const data = await res.json()

  const current: CurrentWeather = {
    temperature: data.current?.temperature_2m ?? 0,
    apparentTemp: data.current?.apparent_temperature ?? 0,
    humidity: data.current?.relative_humidity_2m ?? 0,
    windSpeed: data.current?.wind_speed_10m ?? 0,
    windDir: data.current?.wind_direction_10m ?? 0,
    precipitation: data.current?.precipitation ?? 0,
    weatherCode: data.current?.weather_code ?? 0,
    isDay: data.current?.is_day === 1,
  }

  const hourly: HourlyForecast[] = []
  const times: string[] = data.hourly?.time || []
  for (let i = 0; i < times.length; i++) {
    hourly.push({
      time: times[i],
      temp: data.hourly?.temperature_2m?.[i] ?? 0,
      precipProb: data.hourly?.precipitation_probability?.[i] ?? 0,
      precip: data.hourly?.precipitation?.[i] ?? 0,
      windSpeed: data.hourly?.wind_speed_10m?.[i] ?? 0,
      weatherCode: data.hourly?.weather_code?.[i] ?? 0,
    })
  }

  return { current, hourly, location: point }
}

export function describeWeatherCode(code: number): string {
  const codes: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
  }
  return codes[code] || 'Unknown'
}
