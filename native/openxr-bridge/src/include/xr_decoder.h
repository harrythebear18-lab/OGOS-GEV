#pragma once

// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Decoder
// Reads head pose, eye poses, controllers, and hand tracking from OpenXR.
// Writes all data into shared memory for Electron to read.
// ═══════════════════════════════════════════════════════════════

#include "xr_types.h"
#include "xr_session.h"
#include <openxr/openxr.h>

namespace xr_bridge {

class XRDecoder {
public:
    explicit XRDecoder(XRSession& session);
    ~XRDecoder();

    bool create();
    void destroy();

    // Poll for latest pose + input data — called at 90Hz
    void poll();

private:
    XRSession& m_session;

    // Controller action handles
    XrActionSet m_actionSet = XR_NULL_HANDLE;
    XrAction m_controllerPoseAction[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
    XrSpace m_controllerSpace[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};

    // Hand tracking
    XrHandTrackerEXT m_handTrackers[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
    bool m_handTrackingSupported = false;

    // Extension function pointers
    PFN_xrCreateHandTrackerEXT m_xrCreateHandTracker = nullptr;
    PFN_xrDestroyHandTrackerEXT m_xrDestroyHandTracker = nullptr;
    PFN_xrLocateHandJointsEXT m_xrLocateHandJoints = nullptr;

    bool initActions();
    bool initHandTracking();
    void pollPose(XrTime predictedTime);
    void pollControllers(XrTime predictedTime);
    void pollHands(XrTime predictedTime);
    GestureResult detectGestures();
};

} // namespace xr_bridge
