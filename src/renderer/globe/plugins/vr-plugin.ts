/**
 * VR Plugin — Quest 3S via PC Link / OpenXR.
 *
 * Full pipeline: head pose, eye poses, controllers, hand tracking, gestures.
 * Uses the native OpenXR bridge via IPC for all XR data.
 *
 * v0.1: Session detection + stereo camera setup + pose-driven camera.
 * v0.2: Hand tracking visualization + gesture-based controls.
 * v0.3: Shared texture submission for low-latency VR.
 */

import * as Cesium from 'cesium'
import type { EarthEnginePlugin, PluginContext, PluginStats } from './plugin-manager'
import { StereoCameraRig } from '../vr/StereoCameraRig'

interface XRSessionState {
  active: boolean
  runtime: string
  hmdName: string
  refreshRate: number
  renderWidth: number
  renderHeight: number
  ipd: number
}

interface XRPoseData {
  px: number; py: number; pz: number
  qx: number; qy: number; qz: number; qw: number
}

interface XRHandData {
  active: boolean
  joints: XRPoseData[]
  radii: number[]
}

interface XRGestureData {
  left: string
  right: string
  leftConfidence: number
  rightConfidence: number
}

export class VRPlugin implements EarthEnginePlugin {
  id = 'vr'
  name = 'VR (Quest 3S via PC Link)'
  category = 'vr' as const

  private viewer: Cesium.Viewer | null = null
  private ipc: typeof window.api | null = null
  private status: PluginStats = { count: 0, status: 'disabled' }
  private stereoRig: StereoCameraRig | null = null
  private sessionState: XRSessionState | null = null
  private poseTimer: ReturnType<typeof setInterval> | null = null
  private renderListener: Cesium.Event.RemoveCallback | null = null

  private leftHandDataSource: Cesium.CustomDataSource | null = null
  private rightHandDataSource: Cesium.CustomDataSource | null = null
  private lastGestures: XRGestureData = { left: 'none', right: 'none', leftConfidence: 0, rightConfidence: 0 }

  async register(ctx: PluginContext): Promise<void> {
    this.viewer = ctx.viewer
    this.ipc = ctx.ipc
    this.status = { count: 0, status: 'loading' }

    this.leftHandDataSource = new Cesium.CustomDataSource('vr-left-hand')
    this.rightHandDataSource = new Cesium.CustomDataSource('vr-right-hand')
    ctx.viewer.dataSources.add(this.leftHandDataSource)
    ctx.viewer.dataSources.add(this.rightHandDataSource)

    try {
      const status = await this.ipc.invoke('xr:status', {}) as any
      if (status?.active) {
        this.status = { count: 1, status: 'nominal' }
        this.sessionState = status
      } else if (status?.runtimeName && status.runtimeName !== 'none') {
        this.status = { count: 0, status: 'nominal', error: 'OpenXR detected — click to start' }
      } else {
        this.status = { count: 0, status: 'error', error: 'No OpenXR runtime — build native addon' }
      }
    } catch (err) {
      this.status = { count: 0, status: 'error', error: String(err) }
    }
  }

  unregister(): void {
    this.stopSession()
    if (this.renderListener) {
      this.renderListener()
      this.renderListener = null
    }
    if (this.leftHandDataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.leftHandDataSource)
    }
    if (this.rightHandDataSource && this.viewer && !this.viewer.isDestroyed?.()) {
      this.viewer.dataSources.remove(this.rightHandDataSource)
    }
    this.leftHandDataSource = null
    this.rightHandDataSource = null
    this.stereoRig?.destroy()
    this.stereoRig = null
    this.viewer = null
    this.ipc = null
    this.status = { count: 0, status: 'disabled' }
  }

  update(_ctx: PluginContext): void {}

  getStats(): PluginStats {
    return this.status
  }

  isSessionActive(): boolean {
    return this.sessionState?.active ?? false
  }

  getSessionState(): XRSessionState | null {
    return this.sessionState
  }

  getLastGestures(): XRGestureData {
    return this.lastGestures
  }

  async startSession(): Promise<boolean> {
    if (!this.ipc || !this.viewer) return false
    if (this.sessionState?.active) return true

    this.status = { ...this.status, status: 'loading' }

    try {
      const result = await this.ipc.invoke('xr:start', {}) as XRSessionState | null
      if (!result?.active) {
        this.status = { count: 0, status: 'error', error: 'VR session failed to start' }
        return false
      }

      this.sessionState = result
      this.stereoRig = new StereoCameraRig(this.viewer)
      this.stereoRig.activate(result.ipd || undefined)

      this.startPosePolling()
      this.renderListener = this.viewer.scene.postRender.addEventListener(() => {
        this.stereoRig?.render()
      })

      this.applyVRPerformanceMode()
      this.status = { count: 1, status: 'nominal', error: undefined }
      console.log(`[vr-plugin] session started — ${result.hmdName} @ ${result.refreshRate}Hz`)
      return true
    } catch (err) {
      this.status = { count: 0, status: 'error', error: String(err) }
      return false
    }
  }

  async stopSession(): Promise<void> {
    if (this.poseTimer) { clearInterval(this.poseTimer); this.poseTimer = null }
    if (this.renderListener) { this.renderListener(); this.renderListener = null }
    this.stereoRig?.deactivate()

    if (this.ipc && this.sessionState?.active) {
      try { await this.ipc.invoke('xr:stop', {}) } catch {}
    }

    this.sessionState = null
    this.restoreNormalPerformance()
    this.leftHandDataSource?.entities.removeAll()
    this.rightHandDataSource?.entities.removeAll()
    this.status = { count: 0, status: 'nominal', error: 'VR session ended' }
  }

  private startPosePolling(): void {
    this.poseTimer = setInterval(async () => {
      if (!this.ipc || !this.sessionState?.active || !this.stereoRig) return
      try {
        const pose = await this.ipc.invoke('xr:pose', {}) as any
        if (pose?.head) this.stereoRig.applyHeadPose(pose.head)

        const data = await this.ipc.invoke('xr:controllers', {}) as any
        if (data?.gestures) {
          this.lastGestures = data.gestures
          this.handleGestures(data.gestures)
        }
        if (data?.leftHand) this.updateHandVisualization('left', data.leftHand)
        if (data?.rightHand) this.updateHandVisualization('right', data.rightHand)
      } catch {}
    }, 1000 / 90)
  }

  private handleGestures(gestures: XRGestureData): void {
    if (gestures.right === 'pinch' && gestures.rightConfidence > 0.5) {
      console.log('[vr-plugin] pinch — select')
    }
    if (gestures.left === 'fist' && gestures.leftConfidence > 0.5) {
      console.log('[vr-plugin] fist — grab')
    }
    if (gestures.right === 'point' && gestures.rightConfidence > 0.5) {
      console.log('[vr-plugin] point — ray cast')
    }
  }

  private updateHandVisualization(side: 'left' | 'right', hand: XRHandData): void {
    const ds = side === 'left' ? this.leftHandDataSource : this.rightHandDataSource
    if (!ds || !hand.active || hand.joints.length === 0 || !this.viewer) {
      ds?.entities.removeAll()
      return
    }

    ds.entities.removeAll()
    const cameraPos = this.viewer.camera.position

    for (let i = 0; i < hand.joints.length; i++) {
      const joint = hand.joints[i]
      const radius = hand.radii[i] || 0.005
      const offset = Cesium.Cartesian3.fromElements(joint.px * 100, joint.py * 100, joint.pz * 100, new Cesium.Cartesian3())
      const worldPos = Cesium.Cartesian3.add(cameraPos, offset, new Cesium.Cartesian3())

      ds.entities.add({
        id: `hand-${side}-${i}`,
        position: worldPos,
        point: {
          pixelSize: Math.max(3, Math.min(8, radius * 1000)),
          color: side === 'left' ? Cesium.Color.fromBytes(74, 158, 255, 255) : Cesium.Color.fromBytes(255, 138, 74, 255),
          outlineColor: Cesium.Color.WHITE.withAlpha(0.5),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      } as any)
    }
  }

  private applyVRPerformanceMode(): void {
    if (!this.viewer) return
    this.viewer.scene.globe.showGroundAtmosphere = false
    if (this.viewer.scene.skyAtmosphere) this.viewer.scene.skyAtmosphere.show = true
    this.viewer.scene.globe.tileCacheSize = 300
    this.viewer.resolutionScale = 0.8
  }

  private restoreNormalPerformance(): void {
    if (!this.viewer) return
    this.viewer.scene.globe.showGroundAtmosphere = true
    this.viewer.scene.globe.tileCacheSize = 500
    this.viewer.resolutionScale = 1.0
  }
}

export const vrPlugin = new VRPlugin()
