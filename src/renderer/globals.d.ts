export {}

declare global {
  interface Window {
    api: {
      hello: () => Promise<string>
      send: (channel: string, ...args: unknown[]) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, callback: (...args: unknown[]) => void) => void
      off: (channel: string) => void

      scene: {
        get: () => Promise<unknown>
        set: (patch: unknown) => void
        onContext: (cb: (ctx: unknown) => void) => void
        setStack: (stack: string) => void
        sendViewport: (vp: unknown) => void
      }

      tiles: {
        get: (source: string, z: number, x: number, y: number) => Promise<ArrayBuffer | null>
        getStrategy: () => Promise<string>
        setStrategy: (s: string) => void
      }

      terrain: {
        demSample: (lng: number, lat: number) => Promise<{ elevation: number | null }>
        demProfile: (coords: unknown[]) => Promise<unknown>
        slopeAnalysis: (req: unknown) => Promise<{ bands: any[]; legend: any[] }>
        anomalyAnalysis: (req: unknown) => Promise<{ zones: any[] }>
        searchZones: (req: unknown) => Promise<{ zones: any[] }>
        restPoints: (req: unknown) => Promise<{ points: any[] }>
        routePlan: (req: unknown) => Promise<unknown>
        fallRisk: (req: unknown) => Promise<{ zones: any[] }>
        runoff: (req: unknown) => Promise<{ flowPaths: any[]; pools: any[]; floodZones: any[] }>
        canopy: (req: unknown) => Promise<{ zones: any[] }>
        behavior: (req: unknown) => Promise<{ paths: any[]; densityZones: any[] }>
        water: (bounds: unknown) => Promise<{ features: any[] }>
        roads: (bounds: unknown) => Promise<{ segments: any[]; bounds: any[] }>
        remainsCorridor: (req: unknown) => Promise<unknown>
      }

      imagery: {
        search: (req: unknown) => Promise<unknown>
        layers: () => Promise<any[]>
      }

      weather: {
        radar: () => Promise<unknown>
        forecast: (point: { lng: number; lat: number }) => Promise<unknown>
        rainfall: (bounds: unknown) => Promise<number>
      }

      live: {
        onUpdate: (cb: (update: unknown) => void) => void
        onAircraft: (cb: (update: unknown) => void) => void
        onEarthquake: (cb: (update: unknown) => void) => void
        onFire: (cb: (update: unknown) => void) => void
      }

      ai: {
        health: () => Promise<{ running: boolean; models: { name: string; size: number; digest: string; capabilities: string[] }[] }>
        chat: (prompt: string, model?: string, context?: string) => Promise<{ content: string; model: string; error?: string }>
        vision: (prompt: string, image: string, model?: string) => Promise<{ content: string; model: string; error?: string }>
        clipHealth: () => Promise<{ running: boolean; model?: string }>
        clipSearch: (query: string, bounds?: unknown) => Promise<{ results: any[]; error?: string }>
        webSearch: (query: string, limit?: number) => Promise<{ results: any[] }>
      }

      files: {
        exportGeoJSON: (data: unknown) => Promise<string | null>
        exportKML: (data: unknown) => Promise<string | null>
        importKml: () => Promise<{ features: any[] } | null>
        caseProfiles: (id?: string) => Promise<unknown>
      }

      trip: {
        derive: (params: unknown) => Promise<unknown>
        calibrate: (profile: unknown) => Promise<unknown>
      }

      climateHelpers: {
        depth: (lat: number, lon: number) => Promise<{ depthM: number } | null>
        classify: (lat: number, lon: number, stationType?: string) => Promise<unknown>
      }
    }
  }
}

declare module 'pngjs' {
  export class PNG {
    static sync: {
      read(buf: Buffer): { width: number; height: number; data: Buffer }
    }
  }
}
