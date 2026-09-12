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
  'wss://ws1.blitzortung.org/',
  'wss://ws7.blitzortung.org/',
  'wss://ws8.blitzortung.org/',
  'wss://live.lightningmaps.org/',
  'wss://live2.lightningmaps.org/',
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
        // Subscribe to all strikes (Blitzortung protocol v2)
        this.ws?.send(JSON.stringify({ a: 418 }))
        console.log(`[live/lightning] WebSocket connected to ${url}`)
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          // Blitzortung sends LZW-compressed JSON. The LZW stream starts with
          // literal bytes (including '{' = 0x7b), so we can't detect compression
          // by checking the first byte. Always try LZW first, fall back to plain.
          let jsonStr: string
          let strike: any
          try {
            jsonStr = lzwDecode(data)
            strike = JSON.parse(jsonStr)
          } catch (_) {
            // Not LZW or LZW decode failed — try plain UTF-8 JSON
            jsonStr = data.toString('utf8')
            strike = JSON.parse(jsonStr)
          }

          // Debug: log first few messages to see actual field names
          if (this.strikes.length < 3) {
            console.log(`[live/lightning] strike fields:`, Object.keys(strike).join(','), '— sample:', jsonStr.slice(0, 120))
          }

          const lat = typeof strike.lat === 'number' ? strike.lat : parseFloat(strike.lat)
          const lon = typeof strike.lon === 'number' ? strike.lon : parseFloat(strike.lon)
          if (isNaN(lat) || isNaN(lon)) return

          const ts = typeof strike.time === 'number' ? Math.floor(strike.time / 1e6) : Date.now()
          this.strikes.push({
            id: `lightning:${ts}:${lat.toFixed(4)}:${lon.toFixed(4)}`,
            lat, lon,
            timestamp: ts,
            polarity: strike.polType ?? strike.pol ?? 0,
            current: strike.current ?? strike.amp ?? 0,
          })
        } catch (e) {
          if (this.strikes.length === 0) {
            console.warn(`[live/lightning] parse error: ${(e as Error).message}`)
          }
        }
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
// Blitzortung uses a character-based LZW: each UTF-8 character IS a code.
// Code points < 256 are literals; code points >= 256 are dictionary refs.
// Based on the reference implementation from blitzortung.org's map viewer.
function lzwDecode(data: Buffer): string {
  const d = data.toString('utf8').split('')
  if (d.length === 0) return ''
  let c = d[0]
  let f = c
  const g: string[] = [c]
  const e: Record<number, string> = {}  // dictionary
  let o = 256  // next dictionary code

  for (let i = 1; i < d.length; i++) {
    const code = d[i].charCodeAt(0)
    let a: string
    if (code < 256) {
      a = d[i]
    } else if (e[code]) {
      a = e[code]
    } else {
      a = f + c
    }
    g.push(a)
    c = a.charAt(0)
    e[o] = f + c
    o++
    f = a
  }

  return g.join('')
}
