/**
 * Context Store — shared selection / tracking state across the workstation.
 * Adapted from GEV's contextStore pattern.
 *
 * Tracks:
 *  - Selected entity (click selection)
 *  - Tracked subject (follow camera target)
 *  - Per-entity metadata registry
 *
 * Event-driven: dispatches 'workstation:entity-selected' and
 * 'workstation:subject-tracked' events that panels, AI, and detection
 * overlays can subscribe to.
 */

import type { LiveFeature } from '@shared/types'

export interface EntityContext {
  id: string
  layerId: string
  label: string
  entity?: unknown
  feature?: LiveFeature
  lat?: number
  lon?: number
  updatedAt: number
}

class ContextStore {
  private entities = new Map<string, EntityContext>()
  private selectedId: string | null = null
  private trackedId: string | null = null
  private listeners = new Map<string, Set<(ctx: EntityContext | null) => void>>()

  /** Register an entity in the context store */
  register(id: string, layerId: string, label: string, feature?: LiveFeature): EntityContext {
    const record: EntityContext = {
      id,
      layerId,
      label,
      feature,
      lat: feature?.position.lat,
      lon: feature?.position.lon,
      updatedAt: Date.now(),
    }
    this.entities.set(id, record)
    return record
  }

  /** Select an entity by ID (click selection) */
  select(id: string): EntityContext | null {
    const record = this.entities.get(id)
    if (!record) return null
    this.selectedId = id
    this.emit('selected', record)
    return record
  }

  /** Track an entity (follow camera target) */
  track(id: string): EntityContext | null {
    const record = this.entities.get(id)
    if (!record) return null
    this.trackedId = id
    this.emit('tracked', record)
    return record
  }

  /** Stop tracking */
  stopTracking(): void {
    this.trackedId = null
    this.emit('tracked', null)
  }

  /** Clear selection */
  clearSelection(): void {
    this.selectedId = null
    this.emit('selected', null)
  }

  /** Get the currently selected entity */
  getSelected(): EntityContext | null {
    return this.selectedId ? this.entities.get(this.selectedId) ?? null : null
  }

  /** Get the currently tracked entity */
  getTracked(): EntityContext | null {
    return this.trackedId ? this.entities.get(this.trackedId) ?? null : null
  }

  /** Get all registered entities */
  getAll(): EntityContext[] {
    return Array.from(this.entities.values())
  }

  /** Get entities for a specific layer */
  getByLayer(layerId: string): EntityContext[] {
    return this.getAll().filter((e) => e.layerId === layerId)
  }

  /** Subscribe to context events */
  on(event: 'selected' | 'tracked', cb: (ctx: EntityContext | null) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  private emit(event: string, ctx: EntityContext | null): void {
    this.listeners.get(event)?.forEach((cb) => cb(ctx))
  }

  /** Clear all state */
  reset(): void {
    this.entities.clear()
    this.selectedId = null
    this.trackedId = null
    this.listeners.forEach((set) => set.clear())
  }
}

export const contextStore = new ContextStore()
