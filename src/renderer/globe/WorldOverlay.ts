/**
 * WorldOverlay — shared label/card layer for the Cesium globe.
 *
 * Any plugin can register labels or cards at geographic positions.
 * The overlay handles:
 *   - Collision management (labels don't overlap when zoomed out)
 *   - Priority-based visibility (important labels show first)
 *   - Distance culling (far labels hidden at low zoom)
 *   - Category filtering (show/hide by category)
 *   - Shared styling (consistent look across plugins)
 *
 * Labels are Cesium entities (cheap, GPU-rendered text).
 * Cards are HTML overlays (rich content, positioned via SceneTransforms).
 *
 * Usage:
 *   const overlay = new WorldOverlay(viewer)
 *   overlay.registerLabel({
 *     id: 'vessel:123',
 *     lat: 40.7, lon: -74.0,
 *     text: 'MV ATLANTIC',
 *     category: 'vessel',
 *     priority: 5,
 *   })
 *   overlay.registerCard({
 *     id: 'aircraft:abc123',
 *     lat: 51.5, lon: -0.1, height: 10000,
 *     title: 'BAW123',
 *     subtitle: 'British Airways • 10,000m • 450kt',
 *     category: 'aircraft',
 *     priority: 8,
 *   })
 */

import * as Cesium from 'cesium'

export interface WorldLabel {
  id: string
  lat: number
  lon: number
  height?: number
  text: string
  category: string
  priority: number // 0=lowest, 10=highest
  color?: string // hex or rgba, default cyan
  fontSize?: number // px, default 10
  pixelOffsetY?: number // px, default -14
}

export interface WorldCard {
  id: string
  lat: number
  lon: number
  height?: number
  title: string
  subtitle?: string
  category: string
  priority: number
  color?: string
}

export interface VisibleCard extends WorldCard {
  screenX: number
  screenY: number
}

const DEFAULT_LABEL_COLOR = '#4affd4'
const MAX_LABELS = 200 // cap for performance
const MAX_CARDS = 50
const COLLISION_MIN_PX = 60 // minimum pixel distance between label anchors

export class WorldOverlay {
  private viewer: Cesium.Viewer
  private dataSource: Cesium.CustomDataSource
  private labels = new Map<string, { label: WorldLabel; entity: Cesium.Entity }>()
  private cards = new Map<string, WorldCard>()
  private hiddenCategories = new Set<string>()
  private cameraListener: Cesium.Event.RemoveCallback | null = null
  private onCardsUpdate: ((cards: VisibleCard[]) => void) | null = null

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
    this.dataSource = new Cesium.CustomDataSource('world-overlay')
    viewer.dataSources.add(this.dataSource)

    // Listen to camera changes to update card positions + label visibility
    this.cameraListener = viewer.scene.postRender.addEventListener(() => {
      this.updateLabelVisibility()
      this.updateCards()
    })
  }

  /** Set callback for card position updates (React layer uses this). */
  setCardCallback(cb: ((cards: VisibleCard[]) => void) | null): void {
    this.onCardsUpdate = cb
  }

  /** Register or update a label. */
  registerLabel(label: WorldLabel): void {
    const existing = this.labels.get(label.id)
    if (existing) {
      // Update position and text
      const pos = Cesium.Cartesian3.fromDegrees(label.lon, label.lat, label.height ?? 0)
      ;(existing.entity.position as Cesium.ConstantPositionProperty)?.setValue(pos)
      if (existing.entity.label) {
        ;(existing.entity.label.text as any)?.setValue(label.text)
      }
      existing.label = label
      return
    }

    // Cap labels — remove lowest priority if at limit
    if (this.labels.size >= MAX_LABELS) {
      this.evictLowestPriorityLabel()
    }

    const color = label.color
      ? Cesium.Color.fromCssColorString(label.color)
      : Cesium.Color.fromCssColorString(DEFAULT_LABEL_COLOR)

    const entity = this.dataSource.entities.add({
      id: `world-label:${label.id}`,
      position: Cesium.Cartesian3.fromDegrees(label.lon, label.lat, label.height ?? 0),
      label: {
        text: label.text,
        font: `${label.fontSize ?? 10}px monospace`,
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, label.pixelOffsetY ?? -14),
        showBackground: false,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5_000_000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    this.labels.set(label.id, { label, entity })
  }

  /** Register or update a card. */
  registerCard(card: WorldCard): void {
    if (this.cards.size >= MAX_CARDS && !this.cards.has(card.id)) {
      this.evictLowestPriorityCard()
    }
    this.cards.set(card.id, card)
  }

  /** Remove a label by id. */
  removeLabel(id: string): void {
    const entry = this.labels.get(id)
    if (entry) {
      this.dataSource.entities.remove(entry.entity)
      this.labels.delete(id)
    }
  }

  /** Remove a card by id. */
  removeCard(id: string): void {
    this.cards.delete(id)
  }

  /** Show or hide a category of labels + cards. */
  setCategoryVisible(category: string, visible: boolean): void {
    if (visible) {
      this.hiddenCategories.delete(category)
    } else {
      this.hiddenCategories.add(category)
    }
    // Update entity visibility immediately
    for (const [id, { label, entity }] of this.labels) {
      if (label.category === category) {
        entity.show = visible
      }
    }
  }

  /** Clear all labels and cards from a specific category. */
  clearCategory(category: string): void {
    for (const [id, { entity }] of this.labels) {
      if (this.labels.get(id)?.label.category === category) {
        this.dataSource.entities.remove(entity)
        this.labels.delete(id)
      }
    }
    for (const [id, card] of this.cards) {
      if (card.category === category) {
        this.cards.delete(id)
      }
    }
  }

  /** Get stats for debugging. */
  getStats(): { labels: number; cards: number; hiddenCategories: string[] } {
    return {
      labels: this.labels.size,
      cards: this.cards.size,
      hiddenCategories: Array.from(this.hiddenCategories),
    }
  }

  /** Destroy — remove all entities and listeners. */
  destroy(): void {
    if (this.cameraListener) {
      this.cameraListener()
      this.cameraListener = null
    }
    if (!this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.dataSource)
    }
    this.labels.clear()
    this.cards.clear()
    this.onCardsUpdate = null
  }

  // ── Internal: collision management for labels ──

  private updateLabelVisibility(): void {
    if (this.labels.size === 0) return

    // Get camera height to determine if we need collision management
    const cameraHeight = this.viewer.camera.positionCartographic.height
    const needsCollision = cameraHeight < 2_000_000 // only when zoomed in < 2000km

    if (!needsCollision) {
      // When zoomed out, just show by category
      for (const [, { label, entity }] of this.labels) {
        entity.show = !this.hiddenCategories.has(label.category)
      }
      return
    }

    // When zoomed in, do collision management
    // Sort by priority (highest first), then show non-overlapping labels
    const sorted = Array.from(this.labels.values())
      .filter((e) => !this.hiddenCategories.has(e.label.category))
      .sort((a, b) => b.label.priority - a.label.priority)

    const shownPositions: { x: number; y: number }[] = []
    const scratchCartesian = new Cesium.Cartesian2()

    for (const { label, entity } of sorted) {
      const pos = Cesium.Cartesian3.fromDegrees(label.lon, label.lat, label.height ?? 0)
      const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, pos, scratchCartesian)

      if (!screenPos || !isFinite(screenPos.x) || !isFinite(screenPos.y)) {
        entity.show = false
        continue
      }

      // Check if off-screen
      const canvas = this.viewer.scene.canvas
      if (screenPos.x < 0 || screenPos.x > canvas.clientWidth || screenPos.y < 0 || screenPos.y > canvas.clientHeight) {
        entity.show = false
        continue
      }

      // Check collision with already-shown labels
      let collides = false
      for (const shown of shownPositions) {
        const dx = screenPos.x - shown.x
        const dy = screenPos.y - shown.y
        if (Math.sqrt(dx * dx + dy * dy) < COLLISION_MIN_PX) {
          collides = true
          break
        }
      }

      if (collides) {
        entity.show = false
      } else {
        entity.show = true
        shownPositions.push({ x: screenPos.x, y: screenPos.y })
      }
    }
  }

  // ── Internal: update card screen positions ──

  private updateCards(): void {
    if (!this.onCardsUpdate) return
    if (this.cards.size === 0) {
      this.onCardsUpdate([])
      return
    }

    const cameraHeight = this.viewer.camera.positionCartographic.height
    const maxCardDistance = 3_000_000 // cards visible within 3000km

    const visible: VisibleCard[] = []
    const scratchCartesian = new Cesium.Cartesian2()

    // Sort by priority
    const sorted = Array.from(this.cards.values())
      .filter((c) => !this.hiddenCategories.has(c.category))
      .sort((a, b) => b.priority - a.priority)

    for (const card of sorted) {
      if (cameraHeight > maxCardDistance) continue

      const pos = Cesium.Cartesian3.fromDegrees(card.lon, card.lat, card.height ?? 0)
      const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, pos, scratchCartesian)

      if (!screenPos || !isFinite(screenPos.x) || !isFinite(screenPos.y)) continue

      const canvas = this.viewer.scene.canvas
      if (screenPos.x < -100 || screenPos.x > canvas.clientWidth + 100 || screenPos.y < -100 || screenPos.y > canvas.clientHeight + 100) continue

      visible.push({
        ...card,
        screenX: screenPos.x,
        screenY: screenPos.y,
      })

      if (visible.length >= MAX_CARDS) break
    }

    this.onCardsUpdate(visible)
  }

  private evictLowestPriorityLabel(): void {
    let lowest: { id: string; priority: number } | null = null
    for (const [id, { label }] of this.labels) {
      if (!lowest || label.priority < lowest.priority) {
        lowest = { id, priority: label.priority }
      }
    }
    if (lowest) {
      this.removeLabel(lowest.id)
    }
  }

  private evictLowestPriorityCard(): void {
    let lowest: { id: string; priority: number } | null = null
    for (const [id, card] of this.cards) {
      if (!lowest || card.priority < lowest.priority) {
        lowest = { id, priority: card.priority }
      }
    }
    if (lowest) {
      this.cards.delete(lowest.id)
    }
  }
}
