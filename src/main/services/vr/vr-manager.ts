/**
 * VR Manager — OpenXR session lifecycle for Quest 3S via PC Link.
 *
 * Uses the native OpenXR bridge (C++ N-API addon) for:
 *   - Session management
 *   - Head/eye pose polling
 *   - Controller state
 *   - Hand tracking (26 joints per hand)
 *   - Gesture detection
 *   - D3D11 shared texture submission
 *
 * Falls back to stub mode when native addon is not built.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { openxrNativeBridge, XRSessionInfo, XRPoseData, XRControllerData, XRHandData, XRGestureData } from './openxr-native-bridge'

export type { XRSessionInfo, XRPoseData, XRControllerData, XRHandData, XRGestureData }

class VRManager {
  private posePollTimer: NodeJS.Timeout | null = null
  private frameLoopActive = false

  init(): void {
    ipcMain.handle(IPC.XR_START, async () => this.startSession())
    ipcMain.handle(IPC.XR_STOP, async () => this.stopSession())
    ipcMain.handle(IPC.XR_STATUS, async () => this.getStatus())
    ipcMain.handle(IPC.XR_POSE, async () => this.getPose())
    ipcMain.handle(IPC.XR_CONTROLLERS, async () => this.getControllers())

    console.log(`[vr-manager] initialized — native bridge available: ${openxrNativeBridge.isAvailable()}`)
  }

  private async startSession(): Promise<XRSessionInfo> {
    if (openxrNativeBridge.isSessionActive()) {
      return openxrNativeBridge.getInfo()
    }

    if (!openxrNativeBridge.isAvailable()) {
      console.warn('[vr-manager] native bridge not available — VR unavailable')
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

    console.log('[vr-manager] creating XR session...')

    // Create session with Quest 3S defaults
    const created = openxrNativeBridge.createSession({
      renderWidth: 1832,
      renderHeight: 1920,
      ipd: 0.063,
      refreshRate: 90,
      enableHandTracking: true,
    })

    if (!created) {
      console.error('[vr-manager] failed to create session')
      return openxrNativeBridge.getInfo()
    }

    // Begin session
    const begun = openxrNativeBridge.beginSession()
    if (!begun) {
      console.error('[vr-manager] failed to begin session')
      return openxrNativeBridge.getInfo()
    }

    const info = openxrNativeBridge.getInfo()
    console.log(`[vr-manager] XR session started — ${info.hmdName} @ ${info.refreshRate}Hz`)

    // Start pose polling at 90Hz
    this.startPosePolling()

    // Start frame loop
    this.startFrameLoop()

    return info
  }

  private async stopSession(): Promise<void> {
    console.log('[vr-manager] stopping XR session...')

    this.stopPosePolling()
    this.stopFrameLoop()

    openxrNativeBridge.endSession()
    openxrNativeBridge.destroySession()

    console.log('[vr-manager] XR session stopped')
  }

  private async getStatus(): Promise<XRSessionInfo> {
    return openxrNativeBridge.getInfo()
  }

  private async getPose(): Promise<{
    head: XRPoseData
    leftEye: XRPoseData
    rightEye: XRPoseData
    timestamp: number
  } | null> {
    if (!openxrNativeBridge.isSessionActive()) return null

    return {
      head: openxrNativeBridge.getHeadPose(),
      leftEye: openxrNativeBridge.getLeftEyePose(),
      rightEye: openxrNativeBridge.getRightEyePose(),
      timestamp: Date.now(),
    }
  }

  private async getControllers(): Promise<{
    left: XRControllerData
    right: XRControllerData
    gestures: XRGestureData
    leftHand: XRHandData
    rightHand: XRHandData
  } | null> {
    if (!openxrNativeBridge.isSessionActive()) return null

    return {
      left: openxrNativeBridge.getLeftController(),
      right: openxrNativeBridge.getRightController(),
      gestures: openxrNativeBridge.getGestures(),
      leftHand: openxrNativeBridge.getLeftHand(),
      rightHand: openxrNativeBridge.getRightHand(),
    }
  }

  private startPosePolling(): void {
    this.stopPosePolling()

    // Broadcast pose + controller + hand data to renderer at 90Hz
    this.posePollTimer = setInterval(() => {
      if (!openxrNativeBridge.isSessionActive()) return

      const pose = {
        head: openxrNativeBridge.getHeadPose(),
        leftEye: openxrNativeBridge.getLeftEyePose(),
        rightEye: openxrNativeBridge.getRightEyePose(),
        timestamp: Date.now(),
      }

      const controllers = {
        left: openxrNativeBridge.getLeftController(),
        right: openxrNativeBridge.getRightController(),
        gestures: openxrNativeBridge.getGestures(),
        leftHand: openxrNativeBridge.getLeftHand(),
        rightHand: openxrNativeBridge.getRightHand(),
      }

      this.broadcast(IPC.XR_POSE, pose)
      this.broadcast(IPC.XR_CONTROLLERS, controllers)
    }, 1000 / 90) // 90Hz
  }

  private stopPosePolling(): void {
    if (this.posePollTimer) {
      clearInterval(this.posePollTimer)
      this.posePollTimer = null
    }
  }

  private startFrameLoop(): void {
    this.frameLoopActive = true

    // Run the OpenXR frame loop on a separate timer
    // In production, this would be synchronized with Cesium's render loop
    const frameLoop = () => {
      if (!this.frameLoopActive || !openxrNativeBridge.isSessionActive()) return

      openxrNativeBridge.beginFrame()
      // Cesium renders here (in the renderer process, via shared texture)
      openxrNativeBridge.endFrame()

      setTimeout(frameLoop, 1000 / 90) // 90Hz
    }

    frameLoop()
  }

  private stopFrameLoop(): void {
    this.frameLoopActive = false
  }

  private broadcast(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  shutdown(): void {
    this.stopSession()
  }
}

export const vrManager = new VRManager()
