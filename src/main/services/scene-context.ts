import { EventEmitter } from 'node:events'

export interface SceneContext {
  activeLayers: string[]
  selectedFeature: unknown | null
  lkp: { lng: number; lat: number } | null
  bbox: { west: number; south: number; east: number; north: number } | null
  timeRange: { start: number; end: number } | null
  camera: {
    center: { lng: number; lat: number }
    height: number
    heading: number
    pitch: number
    roll: number
  } | null
}

const context: SceneContext = {
  activeLayers: ['sentinel-rgb'],
  selectedFeature: null,
  lkp: null,
  bbox: null,
  timeRange: null,
  camera: null,
}

const emitter = new EventEmitter()

export function getSceneContext(): SceneContext {
  return { ...context }
}

export function updateSceneContext(patch: Partial<SceneContext>): SceneContext {
  Object.assign(context, patch)
  const next = getSceneContext()
  emitter.emit('change', next)
  return next
}

export function onSceneContextChange(callback: (ctx: SceneContext) => void): void {
  emitter.on('change', callback)
}

export function offSceneContextChange(callback: (ctx: SceneContext) => void): void {
  emitter.off('change', callback)
}
