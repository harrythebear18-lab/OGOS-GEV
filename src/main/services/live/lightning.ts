/**
 * Lightning feed — Blitzortung real-time lightning detections.
 * Uses Blitzortung WebSocket (same approach as OSINT-Global-OS).
 *
 * WebSocket: wss://ws1.blitzortung.org:3000/ through wss://ws8.blitzortung.org:3000/
 * The WebSocket delivers strikes in real-time. We accumulate them and serve on poll.
 *
 * Messages may be LZW-compressed (binary) or plain JSON.
 */

import type { LiveFeature } from '@shared/types'
import { WebSocket } from 'ws'

const WS_SERVERS = [
  'wss://ws1.blitzortung.org:3000/',
  'wss://ws2.blitzortung.org:3000/',
  'wss://ws3.blitzortung.org:3000/',
  'wss://ws4.blitzortung.org:3000/',
  'wss://ws5.blitzortung.org:3000/',
  'wss://ws6.blitzortung.org:3000/',
  'wss://ws7.blitzortung.org:3000/',
  'wss://ws8.blitzortung.org:3000/',
]

const STRIKE_LIFETIME = 30 * 60 * 1000  // 30 minutes
const MAX_STRIKES = 5000

interface Strike {
  id: string
  lat: number
  lon: number
  timestamp: number
  polarity: number
  current: number
}

class BlitzortungFeed {
  private strikes: Strike[] = []
  private ws: WebSocket | null = null
  private connected = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectDelay = 5000
  private errorLogged = false
  private started = false

  start(): void {
    if (this.started) return
    this.started = true
    this.connect()
  }

  stop(): void {
    this.started = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
    this.connected = false
  }

  getStrikes(): LiveFeature[] {
    const now = Date.now()
    // Prune old strikes
    this.strikes = this.strikes.filter((s) => s.timestamp >= now - STRIKE_LIFETIME)
    if (this.strikes.length > MAX_STRIKES) {
      this.strikes = this.strikes.slice(-MAX_STRIKES)
    }

    return this.strikes.map((s) => ({
      id: s.id,
      type: 'lightning' as const,
      position: { lon: s.lon, lat: s.lat, height: 0 },
      meta: {
        polarity: s.polarity,
        current: s.current,
        time: s.timestamp,
        color: s.polarity > 0 ? '#ff4aff' : '#ffea4a',
      },
      freshness: s.timestamp,
    }))
  }

  private connect(): void {
    if (this.connected && this.ws) return
    const url = WS_SERVERS[Math.floor(Math.random() * WS_SERVERS.length)]
    try {
      this.ws = new WebSocket(url)
      this.ws.on('open', () => {
        this.connected = true
        this.reconnectDelay = 5000
        this.errorLogged = false
        // Subscribe to all strikes
        this.ws?.send(JSON.stringify({ a: 111 }))
        console.log(`[live/lightning] WebSocket connected to ${url}`)
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          let jsonStr: string
          // Check if data is compressed (not starting with { or [)
          if (data.length > 0 && data[0] !== 0x7b && data[0] !== 0x5b) {
            jsonStr = lzwDecode(data)
          } else {
            jsonStr = data.toString('utf8')
          }
          const strike = JSON.parse(jsonStr)
          const lat = typeof strike.lat === 'number' ? strike.lat : parseFloat(strike.lat)
          const lon = typeof strike.lon === 'number' ? strike.lon : parseFloat(strike.lon)
          if (isNaN(lat) || isNaN(lon)) return

          const ts = typeof strike.time === 'number' ? Math.floor(strike.time / 1e6) : Date.now()
          this.strikes.push({
            id: `lightning:${ts}:${lat.toFixed(4)}:${lon.toFixed(4)}`,
            lat, lon,
            timestamp: ts,
            polarity: strike.pol ?? 0,
            current: strike.current ?? 0,
          })
        } catch { /* ignore malformed */ }
      })

      this.ws.on('close', () => {
        this.connected = false
        this.ws = null
        if (this.started) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
          this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay)
        }
      })

      this.ws.on('error', (err: Error) => {
        if (!this.errorLogged) {
          console.warn(`[live/lightning] WebSocket error: ${err.message}`)
          this.errorLogged = true
        }
      })
    } catch (e) {
      console.warn('[live/lightning] WebSocket connect failed:', e)
      if (this.started) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay)
      }
    }
  }
}

// Singleton feed
const feed = new BlitzortungFeed()
let feedStarted = false

export function startLightningFeed(): void {
  if (!feedStarted) {
    feedStarted = true
    feed.start()
  }
}

export function stopLightningFeed(): void {
  feed.stop()
  feedStarted = false
}

export async function getLightningFeatures(): Promise<LiveFeature[]> {
  if (!feedStarted) {
    startLightningFeed()
    // Give it a moment to connect
    await new Promise((r) => setTimeout(r, 1000))
  }
  const strikes = feed.getStrikes()
  if (strikes.length > 0) {
    console.log(`[live/lightning] ${strikes.length} strikes from Blitzortung WebSocket`)
  }
  return strikes
}

// ── LZW Decoder for Blitzortung compressed messages ──
// Blitzortung uses LZW compression for some WebSocket messages
function lzwDecode(data: Buffer): string {
  const dict: number[][] = []
  for (let i = 0; i < 256; i++) {
    dict.push([i])
  }

  const result: number[] = []
  let dictSize = 256
  let bits = 8
  let pos = 0

  // Read variable-length codes
  const readBits = (n: number): number => {
    let val = 0
    for (let i = 0; i < n; i++) {
      const byteIdx = Math.floor(pos / 8)
      const bitIdx = pos % 8
      if (byteIdx >= data.length) return -1
      val = (val << 1) | ((data[byteIdx] >> (7 - bitIdx)) & 1)
      pos++
    }
    return val
  }

  let prev: number[] | null = null
  while (true) {
    const code = readBits(bits)
    if (code === -1) break
    if (code === 256) {
      // Reset
      dict.length = 256
      for (let i = 0; i < 256; i++) dict[i] = [i]
      dictSize = 256
      bits = 8
      prev = null
      continue
    }

    let entry: number[]
    if (code < dict.length) {
      entry = dict[code]
    } else if (prev !== null) {
      entry = [...prev, prev[0]]
    } else {
      break
    }

    result.push(...entry)
    if (prev !== null && dictSize < 4096) {
      dict.push([...prev, entry[0]])
      dictSize++
      if (dictSize >= (1 << bits) && bits < 12) {
        bits++
      }
    }
    prev = entry
  }

  return Buffer.from(result).toString('utf8')
}
