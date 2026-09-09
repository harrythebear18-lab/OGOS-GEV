/**
 * OpenXR Native Bridge — TypeScript Wrapper
 *
 * Loads the native C++ N-API addon and provides a typed interface.
 * Falls back gracefully when the addon is not built or unavailable.
 *
 * Build the addon:
 *   cd native/openxr-bridge
 *   npm install
 *   npm run build
 *
 * The compiled .node file is loaded via require().
 */

import * as path from 'path'
import * as fs from 'fs'

export interface XRPoseData {
  px: number; py: number; pz: number
  qx: number; qy: number; qz: number; qw: number
}

export interface XRControllerData {
  trigger: number
  grip: number
  joystickX: number
  joystickY: number
  active: boolean
  pose: XRPoseData
}

export interface XRHandData {
  active: boolean
  joints: XRPoseData[]
  radii: number[]
}

export interface XRGestureData {
  left: 'none' | 'pinch' | 'fist' | 'open' | 'point' | 'thumbsup' | 'peace'
  right: 'none' | 'pinch' | 'fist' | 'open' | 'point' | 'thumbsup' | 'peace'
  leftConfidence: number
  rightConfidence: number
}

export interface XRSessionInfo {
  active: boolean
  runtimeName: string
  hmdName: string
  refreshRate: number
  renderWidth: number
  renderHeight: number
  ipd: number
}

export interface XRSessionConfig {
  renderWidth?: number
  renderHeight?: number
  ipd?: number
  refreshRate?: number
  enableHandTracking?: boolean
}

interface NativeAddon {
  isAvailable(): boolean
  createSession(config?: XRSessionConfig): boolean
  beginSession(): boolean
  endSession(): void
  destroySession(): void
  getInfo(): XRSessionInfo
  getHeadPose(): XRPoseData
  getLeftEyePose(): XRPoseData
  getRightEyePose(): XRPoseData
  getLeftController(): XRControllerData
  getRightController(): XRControllerData
  getLeftHand(): XRHandData
  getRightHand(): XRHandData
  getGestures(): XRGestureData
  beginFrame(): boolean
  endFrame(): void
  sendCommand(cmd: number, param?: number): void
  getFrameMetadata(): {
    frameIndex: number
    predictedTime: number
    leftIdx: number
    rightIdx: number
    renderWidth: number
    renderHeight: number
  }
  getSessionState(): number
}

class OpenXRNativeBridge {
  private addon: NativeAddon | null = null
  private available = false
  private sessionCreated = false
  private sessionActive = false

  constructor() {
    this.loadAddon()
  }

  private loadAddon(): void {
    try {
      // Try multiple paths — dev and production layouts differ
      const candidates = [
        // Dev: from out/main/services/vr/ → project root/native/...
        path.join(__dirname, '..', '..', '..', '..', 'native', 'openxr-bridge', 'build', 'Release', 'openxr_bridge.node'),
        // Production: from app.asar unpacked
        path.join(process.resourcesPath || '', 'native', 'openxr-bridge', 'build', 'Release', 'openxr_bridge.node'),
        // Relative to cwd (project root in dev)
        path.join(process.cwd(), 'native', 'openxr-bridge', 'build', 'Release', 'openxr_bridge.node'),
      ]

      let addonPath: string | null = null
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          addonPath = p
          break
        }
      }

      if (!addonPath) {
        console.log('[xr-native] native addon not built — run: cd native/openxr-bridge && npm install && npm run build')
        this.addon = null
        this.available = false
        return
      }

      this.addon = require(addonPath) as NativeAddon
      this.available = this.addon.isAvailable()
      console.log(`[xr-native] addon loaded from ${addonPath} — available: ${this.available}`)
    } catch (err) {
      console.log('[xr-native] native addon not available (build it with: cd native/openxr-bridge && npm install && npm run build)')
      console.log(`[xr-native] error: ${err}`)
      this.addon = null
      this.available = false
    }
  }

  isAvailable(): boolean {
    return this.available && this.addon !== null
  }

  createSession(config?: XRSessionConfig): boolean {
    if (!this.addon || !this.available) return false
    this.sessionCreated = this.addon.createSession(config)
    return this.sessionCreated
  }

  beginSession(): boolean {
    if (!this.addon || !this.sessionCreated) return false
    this.sessionActive = this.addon.beginSession()
    return this.sessionActive
  }

  endSession(): void {
    if (!this.addon || !this.sessionActive) return
    this.addon.endSession()
    this.sessionActive = false
  }

  destroySession(): void {
    if (!this.addon) return
    this.addon.destroySession()
    this.sessionCreated = false
    this.sessionActive = false
  }

  getInfo(): XRSessionInfo {
    if (!this.addon) {
      return {
        active: false,
        runtimeName: 'none',
        hmdName: '',
        refreshRate: 0,
        renderWidth: 0,
        renderHeight: 0,
        ipd: 0,
      }
    }
    return this.addon.getInfo()
  }

  getHeadPose(): XRPoseData {
    if (!this.addon) return { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    return this.addon.getHeadPose()
  }

  getLeftEyePose(): XRPoseData {
    if (!this.addon) return { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    return this.addon.getLeftEyePose()
  }

  getRightEyePose(): XRPoseData {
    if (!this.addon) return { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    return this.addon.getRightEyePose()
  }

  getLeftController(): XRControllerData {
    if (!this.addon) return { trigger: 0, grip: 0, joystickX: 0, joystickY: 0, active: false, pose: { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }
    return this.addon.getLeftController()
  }

  getRightController(): XRControllerData {
    if (!this.addon) return { trigger: 0, grip: 0, joystickX: 0, joystickY: 0, active: false, pose: { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 } }
    return this.addon.getRightController()
  }

  getLeftHand(): XRHandData {
    if (!this.addon) return { active: false, joints: [], radii: [] }
    return this.addon.getLeftHand()
  }

  getRightHand(): XRHandData {
    if (!this.addon) return { active: false, joints: [], radii: [] }
    return this.addon.getRightHand()
  }

  getGestures(): XRGestureData {
    if (!this.addon) return { left: 'none', right: 'none', leftConfidence: 0, rightConfidence: 0 }
    return this.addon.getGestures()
  }

  beginFrame(): boolean {
    if (!this.addon || !this.sessionActive) return false
    return this.addon.beginFrame()
  }

  endFrame(): void {
    if (!this.addon || !this.sessionActive) return
    this.addon.endFrame()
  }

  sendCommand(cmd: number, param = 0): void {
    if (!this.addon) return
    this.addon.sendCommand(cmd, param)
  }

  getFrameMetadata(): {
    frameIndex: number
    predictedTime: number
    leftIdx: number
    rightIdx: number
    renderWidth: number
    renderHeight: number
  } {
    if (!this.addon) return { frameIndex: 0, predictedTime: 0, leftIdx: -1, rightIdx: -1, renderWidth: 0, renderHeight: 0 }
    return this.addon.getFrameMetadata()
  }

  getSessionState(): number {
    if (!this.addon) return 0
    return this.addon.getSessionState()
  }

  isSessionActive(): boolean {
    return this.sessionActive
  }

  shutdown(): void {
    this.endSession()
    this.destroySession()
  }
}

export const openxrNativeBridge = new OpenXRNativeBridge()
