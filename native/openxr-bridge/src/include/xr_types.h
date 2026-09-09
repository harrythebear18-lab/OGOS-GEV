#pragma once

// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Shared Types
// Common data structures shared between encoder, decoder, and N-API.
// ═══════════════════════════════════════════════════════════════

#include <array>
#include <cstdint>
#include <cmath>
#include <cstring>
#include <string>

namespace xr_bridge {

// ── Pose: position + orientation ──
struct Pose {
    float px = 0, py = 0, pz = 0;
    float qx = 0, qy = 0, qz = 0, qw = 1;
    static Pose identity() { return {}; }
};

// ── Controller state ──
struct ControllerState {
    float trigger = 0;      // 0..1
    float grip = 0;         // 0..1
    float joystickX = 0;   // -1..1
    float joystickY = 0;   // -1..1
    Pose pose;
    bool active = false;
};

// ── Hand tracking (26 joints per OpenXR spec) ──
static constexpr int HAND_JOINT_COUNT = 26;
struct HandData {
    std::array<Pose, HAND_JOINT_COUNT> joints;
    std::array<float, HAND_JOINT_COUNT> radii;
    float pinch = 0;        // 0..1 pinch strength
    float grip = 0;         // 0..1 grip strength
    bool active = false;
};

// ── Gestures ──
enum class Gesture : int {
    None = 0, Pinch, Fist, Open, Point, ThumbsUp, Peace
};

struct GestureResult {
    Gesture left = Gesture::None;
    Gesture right = Gesture::None;
    float leftConfidence = 0;
    float rightConfidence = 0;
};

// ── Session config ──
struct SessionConfig {
    int renderWidth = 1832;   // per-eye (Quest 3S)
    int renderHeight = 1920;
    float ipd = 0.063f;       // 63mm
    int refreshRate = 90;
    bool enableHandTracking = true;
};

// ── Session info ──
struct SessionInfo {
    bool active = false;
    std::string runtimeName;
    std::string hmdName;
    int refreshRate = 0;
    int renderWidth = 0;
    int renderHeight = 0;
    float ipd = 0;
};

// ── Shared memory buffer layout ──
// This struct is mapped directly into shared memory for zero-copy access.
// Total size: ~2KB (well within a single page)
struct SharedMemoryLayout {
    // ── Pose buffer (written by decoder, read by Electron) ──
    Pose headPose;
    Pose leftEyePose;
    Pose rightEyePose;
    ControllerState leftController;
    ControllerState rightController;
    HandData leftHand;
    HandData rightHand;
    GestureResult gestures;

    // ── Frame metadata (written by encoder, read by decoder) ──
    uint64_t frameIndex = 0;
    int64_t predictedDisplayTime = 0;
    int leftSwapchainIndex = -1;
    int rightSwapchainIndex = -1;
    int renderWidth = 0;
    int renderHeight = 0;

    // ── Command buffer (written by Electron, read by native) ──
    uint32_t command = 0;  // 0=none, 1=start, 2=stop, 3=recenter, 4=haptic
    uint32_t commandParam = 0;

    // ── Status ──
    uint32_t sessionState = 0;  // 0=idle, 1=ready, 2=running, 3=stopping
    uint32_t frameCount = 0;

    // ── Timestamps for latency measurement ──
    int64_t lastPoseTime = 0;
    int64_t lastFrameTime = 0;
};

// Commands
constexpr uint32_t CMD_NONE    = 0;
constexpr uint32_t CMD_START   = 1;
constexpr uint32_t CMD_STOP    = 2;
constexpr uint32_t CMD_RECENTER = 3;
constexpr uint32_t CMD_HAPTIC  = 4;

// Session states
constexpr uint32_t STATE_IDLE     = 0;
constexpr uint32_t STATE_READY    = 1;
constexpr uint32_t STATE_RUNNING  = 2;
constexpr uint32_t STATE_STOPPING = 3;

// ── Utility functions ──
inline float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

inline float jointDist(const Pose& a, const Pose& b) {
    float dx = a.px - b.px, dy = a.py - b.py, dz = a.pz - b.pz;
    return std::sqrt(dx*dx + dy*dy + dz*dz);
}

} // namespace xr_bridge
