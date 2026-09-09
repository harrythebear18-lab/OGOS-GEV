/**
 * Render Governor — ported from God's Eye View's renderGovernor.js.
 *
 * The problem: Cesium's default render loop repaints every vsync forever,
 * burning ~60% GPU + ~54% of a core with zero layers and a parked camera.
 *
 * The fix: flip the scene into Cesium's `requestRenderMode` whenever nothing
 * animates per frame, and return to continuous loop the moment something does.
 *
 * Architecture — a binary mode driven by ref-counted holds:
 * - **Continuous mode** while ANY hold is registered (satellites, live data,
 *   camera animation). Every per-frame animator registers a hold.
 * - **Idle mode** when zero holds. Cesium auto-renders on camera input and
 *   tile loads; every other scene mutation calls `requestRender()`.
 *
 * Holds are identity-keyed (a Set of owner ids), NOT a counter.
 */

let _viewer: any = null
let _installed = false
const _holds = new Set<string>()

function applyMode() {
  if (!_installed || !_viewer?.scene) return
  const continuous = _holds.size > 0
  const scene = _viewer.scene
  if (scene.requestRenderMode === !continuous) return
  scene.requestRenderMode = !continuous
  if (!continuous) {
    // Entering idle: render one settling frame
    scene.requestRender?.()
  }
}

/** Install the governor on the viewer. Idempotent. */
export function installRenderGovernor(viewer: any) {
  if (!viewer?.scene) throw new TypeError('installRenderGovernor requires a Cesium viewer')
  _viewer = viewer
  _installed = true
  // Never let Cesium re-render on simulation-time deltas behind our back
  viewer.scene.maximumRenderTimeChange = Infinity
  applyMode()
  console.log('[governor] installed — idle mode active')
}

/** Register a continuous-render hold. Idempotent per owner. */
export function holdContinuousRender(ownerId: string) {
  if (!ownerId) return
  _holds.add(ownerId)
  applyMode()
}

/** Release a hold. Safe when never held. */
export function releaseContinuousRender(ownerId: string) {
  if (!ownerId) return
  _holds.delete(ownerId)
  applyMode()
}

/** One-shot render request for a discrete scene mutation. */
export function governorRequestRender(reason = 'unspecified') {
  if (!_installed || !_viewer?.scene) return
  _viewer.scene.requestRender?.()
}

/** Get diagnostics. */
export function getRenderGovernorDiagnostics() {
  return {
    installed: _installed,
    mode: _holds.size > 0 ? 'continuous' : 'idle',
    holds: [..._holds].sort(),
  }
}
