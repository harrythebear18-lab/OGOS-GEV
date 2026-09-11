/**
 * Feature Cache — disk-based cache for OSM Overpass feature responses.
 *
 * Writes fetched features (roads, water, infrastructure) to temp files
 * keyed by source + bbox hash. This keeps the renderer's memory footprint
 * small — features are stored on disk and only the viewport-visible subset
 * is held in memory by the renderer plugin.
 *
 * Cache location: os.tmpdir()/osint-sentinel-workstation/features/
 * TTL: 24 hours (OSM data doesn't change fast)
 * Max cache size: 200 MB (LRU eviction)
 */

import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CACHE_ROOT = path.join(os.tmpdir(), 'osint-sentinel-workstation', 'features')
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_CACHE_BYTES = 200 * 1024 * 1024 // 200 MB

/** Hash a bbox + source into a cache key. */
function cacheKey(source: string, bounds: [number, number, number, number]): string {
  // Quantize bbox to ~0.1° to increase cache hits across slightly different viewports
  const [w, s, e, n] = bounds
  const qw = Math.round(w * 10) / 10
  const qs = Math.round(s * 10) / 10
  const qe = Math.round(e * 10) / 10
  const qn = Math.round(n * 10) / 10
  return `${source}_${qw}_${qs}_${qe}_${qn}`
}

class FeatureCacheService {
  private root: string = CACHE_ROOT
  private initialized = false

  private async init(): Promise<void> {
    if (this.initialized) return
    try {
      await fsp.mkdir(this.root, { recursive: true })
      this.initialized = true
    } catch (err) {
      console.warn('[feature-cache] init failed:', err)
    }
  }

  private filePath(key: string): string {
    return path.join(this.root, `${key}.json`)
  }

  private metaPath(key: string): string {
    return path.join(this.root, `${key}.meta.json`)
  }

  /** Get cached features for a source + bbox, or null if not cached/expired. */
  async get<T>(source: string, bounds: [number, number, number, number]): Promise<T | null> {
    await this.init()
    const key = cacheKey(source, bounds)
    const file = this.filePath(key)
    const meta = this.metaPath(key)

    try {
      if (!fs.existsSync(file) || !fs.existsSync(meta)) return null
      const metaData = JSON.parse(await fsp.readFile(meta, 'utf8')) as { cachedAt: number }
      if (Date.now() - metaData.cachedAt > TTL_MS) {
        // Expired — clean up
        await this.delete(key)
        return null
      }
      // Update access time (for LRU)
      await fsp.writeFile(meta, JSON.stringify({ ...metaData, lastAccess: Date.now() }))
      const data = await fsp.readFile(file, 'utf8')
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }

  /** Cache features for a source + bbox. */
  async set<T>(source: string, bounds: [number, number, number, number], data: T): Promise<void> {
    await this.init()
    const key = cacheKey(source, bounds)
    const file = this.filePath(key)
    const meta = this.metaPath(key)

    try {
      await fsp.writeFile(file, JSON.stringify(data))
      await fsp.writeFile(meta, JSON.stringify({ cachedAt: Date.now(), lastAccess: Date.now() }))

      // Evict if cache is too large (async, don't block)
      this.evictIfNeeded().catch((err) =>
        console.warn('[feature-cache] eviction failed:', err),
      )
    } catch (err) {
      console.warn('[feature-cache] set failed:', err)
    }
  }

  /** Delete a cache entry. */
  private async delete(key: string): Promise<void> {
    try {
      await fsp.unlink(this.filePath(key)).catch(() => {})
      await fsp.unlink(this.metaPath(key)).catch(() => {})
    } catch {}
  }

  /** Evict oldest entries if total cache size exceeds MAX_CACHE_BYTES. */
  private async evictIfNeeded(): Promise<void> {
    try {
      const files = await fsp.readdir(this.root)
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'))

      const entries: { key: string; size: number; lastAccess: number }[] = []
      let totalSize = 0

      for (const metaFile of metaFiles) {
        const key = metaFile.replace('.meta.json', '')
        const dataFile = this.filePath(key)
        try {
          const meta = JSON.parse(await fsp.readFile(path.join(this.root, metaFile), 'utf8')) as {
            cachedAt: number
            lastAccess?: number
          }
          const stat = await fsp.stat(dataFile)
          totalSize += stat.size
          entries.push({ key, size: stat.size, lastAccess: meta.lastAccess ?? meta.cachedAt })
        } catch {}
      }

      if (totalSize <= MAX_CACHE_BYTES) return

      // Sort by lastAccess ascending (oldest first)
      entries.sort((a, b) => a.lastAccess - b.lastAccess)

      // Evict oldest until under 80% of max
      const target = MAX_CACHE_BYTES * 0.8
      for (const entry of entries) {
        if (totalSize <= target) break
        await this.delete(entry.key)
        totalSize -= entry.size
        console.log(`[feature-cache] evicted ${entry.key} (${(entry.size / 1024).toFixed(0)} KB)`)
      }
    } catch (err) {
      console.warn('[feature-cache] eviction scan failed:', err)
    }
  }

  /** Clear all cached features. */
  async clear(): Promise<void> {
    try {
      await fsp.rm(this.root, { recursive: true, force: true })
      this.initialized = false
    } catch {}
  }
}

export const featureCache = new FeatureCacheService()
