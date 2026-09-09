/**
 * Stereo Camera Rig — Dual Cesium cameras for VR rendering.
 *
 * Creates left and right eye cameras offset by IPD (interpupillary distance).
 * Both cameras follow the main viewer camera's position and orientation,
 * with horizontal offsets for stereoscopic separation.
 *
 * v0.1: Renders both eyes to the main canvas (mirrored/split).
 * v0.2: Renders to separate offscreen framebuffers for OpenXR submission.
 * v0.3: Native shared textures for low-latency VR.
 */

import * as Cesium from 'cesium'

const DEFAULT_IPD = 0.063 // 63mm average interpupillary distance

export interface StereoFrame {
  left: Cesium.Cartesian3 // left eye position
  right: Cesium.Cartesian3 // right eye position
  leftMatrix: Cesium.Matrix4
  rightMatrix: Cesium.Matrix4
  timestamp: number
}

export class StereoCameraRig {
  private viewer: Cesium.Viewer
  private leftCamera: Cesium.Camera
  private rightCamera: Cesium.Camera
  private ipd: number = DEFAULT_IPD
  private active: boolean = false

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer
    // Create offscreen cameras that mirror the main camera
    this.leftCamera = new Cesium.Camera(this.viewer.scene)
    this.rightCamera = new Cesium.Camera(this.viewer.scene)

    // Copy initial state from main camera
    this.syncFromMain()
  }

  /**
   * Activate stereo rendering.
   */
  activate(ipd?: number): void {
    if (ipd) this.ipd = ipd
    this.active = true
    this.syncFromMain()
    console.log(`[stereo-rig] activated — IPD: ${(this.ipd * 1000).toFixed(1)}mm`)
  }

  /**
   * Deactivate stereo rendering.
   */
  deactivate(): void {
    this.active = false
    console.log('[stereo-rig] deactivated')
  }

  isActive(): boolean {
    return this.active
  }

  setIPD(ipd: number): void {
    this.ipd = ipd
  }

  getIPD(): number {
    return this.ipd
  }

  getLeftCamera(): Cesium.Camera {
    return this.leftCamera
  }

  getRightCamera(): Cesium.Camera {
    return this.rightCamera
  }

  /**
   * Sync stereo cameras from the main viewer camera.
   * Called every frame before rendering.
   */
  syncFromMain(): void {
    const main = this.viewer.camera

    // Copy frustum and viewport from main camera
    this.leftCamera.frustum = main.frustum.clone()
    this.rightCamera.frustum = main.frustum.clone()

    // Copy position, heading, pitch, roll
    this.leftCamera.position = main.position.clone()
    this.leftCamera.setView({
      destination: main.position.clone(),
      orientation: { heading: main.heading, pitch: main.pitch, roll: main.roll },
    })

    this.rightCamera.position = main.position.clone()
    this.rightCamera.setView({
      destination: main.position.clone(),
      orientation: { heading: main.heading, pitch: main.pitch, roll: main.roll },
    })

    if (!this.active) return

    // Apply IPD offset in camera-local right direction
    // The right vector in camera space is (1, 0, 0) before rotation.
    // In world space, we compute it from the camera's direction and up.
    const direction = main.direction
    const up = main.up
    const right = Cesium.Cartesian3.cross(direction, up, new Cesium.Cartesian3())
    Cesium.Cartesian3.normalize(right, right)

    // Offset each eye by half IPD in the right direction
    const halfIpd = this.ipd / 2

    const leftOffset = Cesium.Cartesian3.multiplyByScalar(right, -halfIpd, new Cesium.Cartesian3())
    const rightOffset = Cesium.Cartesian3.multiplyByScalar(right, halfIpd, new Cesium.Cartesian3())

    this.leftCamera.position = Cesium.Cartesian3.add(main.position, leftOffset, new Cesium.Cartesian3())
    this.rightCamera.position = Cesium.Cartesian3.add(main.position, rightOffset, new Cesium.Cartesian3())
  }

  /**
   * Apply head pose from OpenXR.
   * Translates and rotates the main camera based on HMD tracking.
   */
  applyHeadPose(pose: {
    position: [number, number, number]
    orientation: [number, number, number, number]
  }): void {
    if (!this.active) return

    // v0.1: Head pose is applied as a delta to the main camera.
    // The main camera represents the "center" of the user's head.
    // OpenXR pose is in meters relative to the XR origin.

    // For now, we only apply rotation (orientation) to avoid disorientation.
    // Position tracking will be added in v0.2 with proper coordinate conversion.
    const [qx, qy, qz, qw] = pose.orientation

    // Convert quaternion to heading/pitch/roll delta
    // This is a simplified conversion — full implementation in v0.2
    const heading = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))
    const pitch = Math.asin(2 * (qw * qy - qz * qx))
    const roll = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy))

    // Apply as delta to main camera
    this.viewer.camera.setView({
      destination: this.viewer.camera.position.clone(),
      orientation: {
        heading: this.viewer.camera.heading + heading,
        pitch: this.viewer.camera.pitch + pitch,
        roll: this.viewer.camera.roll + roll,
      },
    })
  }

  /**
   * Render both eyes.
   * v0.1: Renders to the main canvas (split-screen or mirrored).
   * v0.2: Renders to separate framebuffers.
   */
  render(): void {
    if (!this.active) return

    this.syncFromMain()

    // v0.1: The main viewer renders normally (mono).
    // The stereo cameras are available for future split-screen or offscreen rendering.
    // v0.2 will implement actual dual-render:
    //   - Render leftCamera to left half of canvas or left framebuffer
    //   - Render rightCamera to right half of canvas or right framebuffer
    //   - Submit both to OpenXR via native bridge
  }

  /**
   * Clean up.
   */
  destroy(): void {
    this.deactivate()
  }
}
