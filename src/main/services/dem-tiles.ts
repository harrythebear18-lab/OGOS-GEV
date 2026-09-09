/**
 * SRTM DEM tile resolver + fetcher with on-disk cache.
 * Ported from OSINT-Global-OS. Uses AWS Terrarium tiles (free, no key).
 *
 * Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768
 * URL: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 */

import { join, dirname } from 'path'
import { homedir } from 'os'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs'

const CACHE_DIR = join(homedir(), '.osint-sentinel-workstation', 'cache', 'dem')

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`

export const DEFAULT_ZOOM = 12

export interface DemTileData {
  grid: (number | null)[][]
  width: number
  height: number
  x: number
  y: number
  z: number
  bounds: [{ lng: number; lat: number }, { lng: number; lat: number }]
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
}

function tilePath(z: number, x: number, y: number): string {
  return join(CACHE_DIR, `${z}`, `${x}`, `${y}.png`)
}

async function fetchTilePng(z: number, x: number, y: number): Promise<Buffer | null> {
  ensureCacheDir()
  const local = tilePath(z, x, y)

  if (existsSync(local)) return readFileSync(local)

  const url = TILE_URL(z, x, y)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`DEM tile fetch failed: ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())

    mkdirSync(dirname(local), { recursive: true })
    const ws = createWriteStream(local)
    ws.write(buf)
    ws.end()
    await new Promise<void>((resolve) => ws.on('finish', () => resolve()))

    return buf
  } catch (e) {
    console.error(`[dem] Failed to fetch tile ${z}/${x}/${y}:`, e)
    return null
  }
}

async function decodeTerrariumPng(pngBuf: Buffer): Promise<number[][]> {
  const { PNG } = await import('pngjs')
  const png = PNG.sync.read(pngBuf)
  const { width, height, data } = png

  const grid: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const elev = r * 256 + g + b / 256 - 32768
      row.push(elev)
    }
    grid.push(row)
  }
  return grid
}

function tileToBounds(z: number, x: number, y: number): [{ lng: number; lat: number }, { lng: number; lat: number }] {
  const n = Math.pow(2, z)
  const lngWest = (x / n) * 360 - 180
  const lngEast = ((x + 1) / n) * 360 - 180
  const latNorth = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  const latSouth = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI
  return [
    { lng: lngWest, lat: latSouth },
    { lng: lngEast, lat: latNorth },
  ]
}

export async function loadDemTile(z: number, x: number, y: number): Promise<DemTileData | null> {
  const pngBuf = await fetchTilePng(z, x, y)
  if (!pngBuf) return null

  const grid = await decodeTerrariumPng(pngBuf)
  const bounds = tileToBounds(z, x, y)

  return {
    grid,
    width: grid[0]?.length ?? 0,
    height: grid.length,
    x,
    y,
    z,
    bounds,
  }
}

export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = Math.pow(2, z)
  const x = Math.floor(((lng + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x, y }
}

export function lngLatToTilePixel(
  lng: number,
  lat: number,
  tileZ: number,
  tileX: number,
  tileY: number,
  tileSize: number,
): { px: number; py: number } {
  const n = Math.pow(2, tileZ)
  const px = ((lng + 180) / 360) * n * tileSize - tileX * tileSize
  const latRad = (lat * Math.PI) / 180
  const py =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * tileSize -
    tileY * tileSize
  return { px: Math.floor(px), py: Math.floor(py) }
}

export { CACHE_DIR }
