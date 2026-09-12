import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { OfflineStrategy } from '@shared/types'
import { getGibsLayerById, GIBS_LAYERS } from './sentinel-service'

interface TileSourceConfig {
  urlTemplate: (z: number, x: number, y: number) => string
  format: 'jpeg' | 'png'
  ttlDays: number
  maxZoom: number
}

const CACHE_ROOT = path.join(os.homedir(), '.osint-sentinel-workstation', 'cache', 'tiles')

const DEFAULT_STRATEGY: OfflineStrategy = 'prefer-cache'

function yesterdayISO(): string {
  // Use "default" to get the latest available imagery from GIBS.
  // Using a computed date can fail if the system clock is wrong or ahead.
  return 'default'
}

/** Build tile source config dynamically from GIBS layer catalog + static sources. */
function getTileSource(source: string): TileSourceConfig | null {
  // Static sources
  if (source === 'dem') {
    return {
      urlTemplate: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
      format: 'png',
      ttlDays: 30,
      maxZoom: 14,
    }
  }
  if (source === 'osm') {
    return {
      urlTemplate: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      format: 'png',
      ttlDays: 14,
      maxZoom: 19,
    }
  }
  if (source === 'esri') {
    return {
      urlTemplate: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
      format: 'jpeg',
      ttlDays: 30,
      maxZoom: 19,
    }
  }

  // GIBS layer by ID
  const layer = getGibsLayerById(source)
  if (layer) {
    const date = yesterdayISO()
    const base = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
    return {
      urlTemplate: (z, x, y) =>
        `${base}/${layer.gibsLayer}/default/${date}/${layer.tileMatrixSet}/${z}/${y}/${x}.${layer.format}`,
      format: layer.format,
      ttlDays: 7,
      maxZoom: layer.maxZoom,
    }
  }

  return null
}

class TileCacheService {
  private strategy: OfflineStrategy = DEFAULT_STRATEGY
  private root: string = CACHE_ROOT

  getStrategy(): OfflineStrategy {
    return this.strategy
  }

  setStrategy(strategy: OfflineStrategy): void {
    this.strategy = strategy
  }

  private tilePath(source: string, z: number, x: number, y: number, format: string): string {
    return path.join(this.root, source, String(z), String(x), `${y}.${format}`)
  }

  private metaPath(file: string): string {
    return `${file}.meta.json`
  }

  private isExpired(cachedAt: number, ttlDays: number): boolean {
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000
    return Date.now() - cachedAt > ttlMs
  }

  private async readCached(file: string, metaFile: string, ttlDays: number): Promise<Buffer | null> {
    if (!fs.existsSync(file) || !fs.existsSync(metaFile)) return null
    const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8')) as { cachedAt: number }
    if (this.isExpired(meta.cachedAt, ttlDays)) return null
    return fsp.readFile(file)
  }

  async get(source: string, z: number, x: number, y: number): Promise<Buffer | null> {
    const src = getTileSource(source)
    if (!src || z > src.maxZoom) return null

    const file = this.tilePath(source, z, x, y, src.format)
    const meta = this.metaPath(file)

    const useCache = this.strategy === 'prefer-cache' || this.strategy === 'cache-only'
    if (useCache) {
      const cached = await this.readCached(file, meta, src.ttlDays)
      if (cached) return cached
      if (this.strategy === 'cache-only') return null
    }

    const url = src.urlTemplate(z, x, y)
    try {
      // Use HAL streaming I/O for backpressure-aware download
      const { streamingIO } = await import('./hal/streaming-io')
      const buf = await streamingIO.fetchToBuffer(url, { timeoutMs: 20000 })
      if (!buf) throw new Error('HTTP error or 404')
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(file, buf)
      await fsp.writeFile(meta, JSON.stringify({ cachedAt: Date.now() }))
      return buf
    } catch {
      if (fs.existsSync(file)) return fsp.readFile(file)
      return null
    }
  }

  async evict(maxBytes = 1024 * 1024 * 1024, olderThanDays?: number): Promise<void> {
    const cutoff = olderThanDays ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : undefined
    const files: { path: string; size: number; mtime: number }[] = []

    async function walk(dir: string) {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (!full.endsWith('.meta.json')) {
          const { size, mtime } = await fsp.stat(full)
          files.push({ path: full, size, mtime: mtime.getTime() })
        }
      }
    }

    if (!fs.existsSync(this.root)) return
    await walk(this.root)

    if (cutoff) {
      for (const f of files) {
        if (f.mtime < cutoff) {
          await fsp.rm(f.path).catch(() => {})
          await fsp.rm(`${f.path}.meta.json`).catch(() => {})
        }
      }
    }

    let total = files.reduce((sum, f) => sum + f.size, 0)
    if (total > maxBytes) {
      files.sort((a, b) => a.mtime - b.mtime)
      for (const f of files) {
        if (total <= maxBytes) break
        await fsp.rm(f.path).catch(() => {})
        await fsp.rm(`${f.path}.meta.json`).catch(() => {})
        total -= f.size
      }
    }
  }
}

export const TileCache = new TileCacheService()
