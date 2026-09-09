# OpenXR Native Bridge — `xr-bridge`

Production-grade C++ N-API bridge for Electron + OpenXR (Quest 3S via PC Link).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Electron Main Process                                          │
│                                                                │
│  vr-manager.ts                                                 │
│    └─ openxr-native-bridge.ts (TS wrapper)                     │
│         └─ xr_bridge.node (C++ N-API addon)                    │
│              ├─ xr_session.cpp     — instance/session/space     │
│              ├─ xr_encoder.cpp     — swapchain + frame submit   │
│              ├─ xr_decoder.cpp     — pose + controllers + hands │
│              └─ xr_sharedmemory.cpp — zero-copy transport       │
│                                                                │
│  OpenXR Runtime (Meta Quest Link / SteamVR)                    │
└──────────────────────────────────────────────────────────────┘
         │ Shared memory (pose, input, frame metadata)
         │ IPC (commands, status, lifecycle)
         ▼
┌──────────────────────────────────────────────────────────────┐
│ Renderer Process (Cesium)                                     │
│                                                                │
│  vr-plugin.ts                                                  │
│    ├─ StereoCameraRig.ts — left/right eye cameras              │
│    ├─ Hand visualization — 26 joints per hand                   │
│    └─ Gesture controls — pinch/fist/point/open/peace/thumbsup  │
└──────────────────────────────────────────────────────────────┘
```

## Encoder / Decoder Model

**Encoder** (Electron → OpenXR):
- Receives left/right eye textures from Cesium
- Acquires OpenXR swapchain images
- Copies Cesium textures into swapchain
- Submits composed stereo frame at HMD refresh rate

**Decoder** (OpenXR → Electron):
- Polls head pose, eye poses, controllers, hand joints
- Detects gestures (pinch, fist, open, point, thumbsup, peace)
- Writes all data into shared memory at 90Hz
- Electron reads from shared memory — zero IPC overhead

## Shared Memory Layout

```c
struct SharedMemoryLayout {
    // Decoder writes, Electron reads:
    Pose headPose, leftEyePose, rightEyePose;
    ControllerState leftController, rightController;
    HandData leftHand, rightHand;        // 26 joints each
    GestureResult gestures;

    // Encoder writes, decoder reads:
    uint64_t frameIndex;
    int64_t  predictedDisplayTime;
    int      leftSwapchainIndex, rightSwapchainIndex;

    // Electron writes, native reads:
    uint32_t command, commandParam;      // start/stop/recenter/haptic

    // Status:
    uint32_t sessionState, frameCount;
    int64_t  lastPoseTime, lastFrameTime;
};
```

## File Structure

```
native/openxr-bridge/
  src/
    xr_bindings.cpp        — N-API entry point (exports to JS)
    xr_session.cpp/.h      — OpenXR instance, session, reference space
    xr_encoder.cpp/.h      — Swapchain management, frame submission
    xr_decoder.cpp/.h      — Pose, controllers, hand tracking, gestures
    xr_sharedmemory.cpp/.h  — Zero-copy shared memory transport
    include/
      xr_types.h           — Common data structures
      xr_session.h
      xr_encoder.h
      xr_decoder.h
      xr_sharedmemory.h
  package.json
  binding.gyp
  README.md
```

## Build

### Prerequisites

1. **Visual Studio 2022 Build Tools** — "Desktop development with C++"
2. **Python 3.x** — `winget install Python.Python.3.12`
3. **OpenXR SDK** — headers at `native/openxr-bridge/openxr/include/openxr/`
4. **Meta Quest Link** — for OpenXR runtime

### Build

```bash
cd native/openxr-bridge
npm install
npm run build
```

Produces `build/Release/xr_bridge.node`.

### Verify

```bash
node -e "const xr = require('./build/Release/xr_bridge.node'); console.log(xr.isAvailable())"
```

## JavaScript API

```typescript
const xr = require('xr-bridge')

// Lifecycle
xr.isAvailable()              // → true if OpenXR runtime detected
xr.createSession(config)       // → create instance + session + swapchains
xr.beginSession()              // → start rendering
xr.endSession()                // → stop rendering
xr.destroySession()            // → cleanup

// Info
xr.getInfo()                   // → { active, hmdName, refreshRate, ... }
xr.getSessionState()           // → 0=idle, 1=ready, 2=running, 3=stopping

// Pose (from shared memory — zero IPC overhead)
xr.getHeadPose()               // → { px, py, pz, qx, qy, qz, qw }
xr.getLeftEyePose()            // → { ... }
xr.getRightEyePose()           // → { ... }

// Controllers
xr.getLeftController()         // → { trigger, grip, joystickX, joystickY, pose, active }
xr.getRightController()        // → { ... }

// Hand tracking (26 joints per hand)
xr.getLeftHand()               // → { joints: [...26], radii: [...26], pinch, grip, active }
xr.getRightHand()              // → { ... }

// Gestures
xr.getGestures()               // → { left: 'pinch', right: 'fist', leftConfidence, rightConfidence }

// Frame loop
xr.beginFrame()                // → acquire swapchain images
xr.endFrame()                  // → submit composed frame to HMD
xr.getFrameMetadata()          // → { frameIndex, predictedTime, leftIdx, rightIdx }

// Commands
xr.sendCommand(3, 0)           // → recenter (1=start, 2=stop, 3=recenter, 4=haptic)
```

## Gestures

| Gesture     | Detection                              | Action           |
|-------------|----------------------------------------|------------------|
| Pinch       | Thumb tip < 2cm from index tip          | Select entity    |
| Fist        | All fingers curled                      | Grab/drag globe  |
| Open        | All fingers extended                   | Release          |
| Point       | Index extended, others curled          | Ray cast         |
| ThumbsUp    | Thumb up, others curled                | Toggle UI        |
| Peace       | Index + middle extended                | —                |

## Config

```typescript
xr.createSession({
  renderWidth: 1832,      // per-eye (Quest 3S default)
  renderHeight: 1920,
  ipd: 0.063,             // 63mm
  refreshRate: 90,
  enableHandTracking: true,
})
```

## Troubleshooting

**"native addon not available"**
- Build the addon: `cd native/openxr-bridge && npm install && npm run build`
- Ensure OpenXR SDK headers at `openxr/include/openxr/`

**"xrCreateInstance failed"**
- Ensure Meta Quest Link is running
- Windows Settings → Mixed Reality → OpenXR runtime

**Build fails with D3D11 errors**
- Install Windows SDK 10.0.19041.0+
- Ensure VS C++ build tools installed
