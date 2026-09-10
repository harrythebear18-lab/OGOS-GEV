/* GeoIP lookup service — ported from OGOS.
 * Batch lookups via ip-api.com with on-disk caching. */
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { app } from 'electron'
import type { GeoLocation } from '@shared/types'

export class GeoIPService {
  private cache = new Map<string, GeoLocation>()
  private pending = new Set<string>()
  private pendingCount = 0
  private readonly cacheDir: string
  private onPendingChange?: (count: number) => void

  constructor() {
    try {
      this.cacheDir = path.join(app.getPath('userData'), 'geoip-cache.json')
    } catch {
      this.cacheDir = ''
    }
    this.loadCache()
  }

  setOnPendingChange(cb: (count: number) => void): void {
    this.onPendingChange = cb
  }

  getPendingCount(): number {
    return this.pendingCount
  }

  private loadCache(): void {
    try {
      if (this.cacheDir && fs.existsSync(this.cacheDir)) {
        const data = JSON.parse(fs.readFileSync(this.cacheDir, 'utf8'))
        for (const [ip, geo] of Object.entries(data)) {
          this.cache.set(ip, geo as GeoLocation)
        }
      }
    } catch {
      // ignore
    }
  }

  private saveCache(): void {
    try {
      if (this.cacheDir) {
        const obj: Record<string, GeoLocation> = {}
        for (const [ip, geo] of this.cache.entries()) obj[ip] = geo
        fs.writeFileSync(this.cacheDir, JSON.stringify(obj))
      }
    } catch {
      // ignore
    }
  }

  async lookup(ip: string): Promise<GeoLocation | null> {
    if (this.isPrivateIP(ip)) return null
    if (this.cache.has(ip)) return this.cache.get(ip)!
    const results = await this.lookupBatch([ip])
    return results.get(ip) || null
  }

  async lookupBatch(ips: string[]): Promise<Map<string, GeoLocation | null>> {
    const results = new Map<string, GeoLocation | null>()
    const uniqueIPs = [
      ...new Set(ips.filter((ip) => !this.isPrivateIP(ip) && !this.cache.has(ip) && !this.pending.has(ip))),
    ]

    for (const ip of ips) {
      if (this.isPrivateIP(ip)) results.set(ip, null)
      else if (this.cache.has(ip)) results.set(ip, this.cache.get(ip)!)
    }

    if (uniqueIPs.length === 0) return results

    for (const ip of uniqueIPs) this.pending.add(ip)
    this.pendingCount = this.pending.size
    this.onPendingChange?.(this.pendingCount)

    for (let i = 0; i < uniqueIPs.length; i += 100) {
      const chunk = uniqueIPs.slice(i, i + 100)
      try {
        const chunkResults = await this.batchLookupChunk(chunk)
        for (const [ip, geo] of chunkResults.entries()) {
          results.set(ip, geo)
          this.pending.delete(ip)
          if (geo) this.cache.set(ip, geo)
        }
      } catch {
        for (const ip of chunk) this.pending.delete(ip)
      }
    }

    this.pendingCount = this.pending.size
    this.onPendingChange?.(this.pendingCount)
    this.saveCache()
    return results
  }

  private batchLookupChunk(ips: string[]): Promise<Map<string, GeoLocation | null>> {
    const results = new Map<string, GeoLocation | null>()
    const postData = JSON.stringify(
      ips.map((ip) => ({
        query: ip,
        fields: 'status,message,country,countryCode,region,city,lat,lon,timezone,isp,org,as,query',
      })),
    )

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'ip-api.com',
          path: '/batch',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
          timeout: 10000,
        },
        (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => (data += chunk))
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data)
              const arr: any[] = Array.isArray(parsed) ? parsed : []
              for (const item of arr) {
                const ip = item.query || ''
                if (item.status === 'success') {
                  results.set(ip, {
                    ip,
                    country: item.country || 'Unknown',
                    countryCode: item.countryCode || '',
                    city: item.city || 'Unknown',
                    region: item.region || '',
                    lat: item.lat || 0,
                    lon: item.lon || 0,
                    isp: item.isp || 'Unknown',
                    org: item.org || '',
                    as: item.as || '',
                    timezone: item.timezone || '',
                  })
                } else {
                  results.set(ip, null)
                }
              }
              resolve(results)
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('timeout'))
      })
      req.write(postData)
      req.end()
    })
  }

  private isPrivateIP(ip: string | null | undefined): boolean {
    if (!ip || typeof ip !== 'string') return true
    if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true
    if (ip.startsWith('127.')) return true
    if (ip.startsWith('10.')) return true
    if (ip.startsWith('192.168.')) return true
    if (ip.startsWith('169.254.')) return true
    if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return true
    if (ip.startsWith('fe80:')) return true
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true
    if (ip.includes(':') && !ip.includes('.')) return true
    return false
  }

  clearCache(): void {
    this.cache.clear()
    this.saveCache()
  }
}
