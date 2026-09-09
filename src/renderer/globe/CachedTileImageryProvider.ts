import * as Cesium from 'cesium'

/**
 * Cached tile imagery provider — fetches tiles through the Electron main
 * process via IPC so all network/cache logic stays in main.
 */
interface CachedTileProviderOptions {
  source: string
  maximumLevel?: number
  minimumLevel?: number
  credit?: Cesium.Credit
  format?: 'jpeg' | 'png'
}

export default class CachedTileImageryProvider {
  readonly _source: string
  readonly _format: 'jpeg' | 'png'
  readonly tilingScheme: Cesium.TilingScheme
  readonly maximumLevel: number
  readonly minimumLevel: number
  readonly credit: Cesium.Credit | undefined
  readonly ready: boolean = true
  readonly rectangle: Cesium.Rectangle
  readonly tileWidth: number = 256
  readonly tileHeight: number = 256
  private _errorEvent: Cesium.Event

  constructor(options: CachedTileProviderOptions) {
    this._source = options.source
    this._format = options.format ?? 'jpeg'
    this.tilingScheme = new Cesium.WebMercatorTilingScheme()
    this.maximumLevel = options.maximumLevel ?? 12
    this.minimumLevel = options.minimumLevel ?? 0
    this.credit = options.credit
    this.rectangle = this.tilingScheme.rectangle
    this._errorEvent = new Cesium.Event()
  }

  async requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Cesium.Request,
  ): Promise<ImageBitmap | HTMLImageElement | undefined> {
    try {
      const data = await window.api.tiles.get(this._source, level, x, y)
      if (!data || data.byteLength === 0) return undefined

      // IPC may return Buffer (as Uint8Array) or ArrayBuffer — normalize
      const arrayBuffer = data instanceof ArrayBuffer
        ? data
        : new Uint8Array(data as unknown as number[]).buffer

      const blob = new Blob([arrayBuffer], { type: `image/${this._format}` })
      return createImageBitmap(blob)
    } catch (e) {
      console.warn(`[CachedTile] ${this._source} ${level}/${x}/${y} failed:`, e)
      return undefined
    }
  }

  getTileCredits(_x: number, _y: number, _level: number): Cesium.Credit[] {
    return this.credit ? [this.credit] : []
  }

  getTileAvailability(_x: number, _y: number, _level: number): boolean {
    return true
  }

  get errorEvent(): Cesium.Event {
    return this._errorEvent
  }

  get proxy(): Cesium.Proxy | undefined {
    return undefined
  }

  get hasAlphaChannel(): boolean {
    return true
  }
}
