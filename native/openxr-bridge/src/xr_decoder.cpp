// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Decoder Implementation
// Reads pose, controllers, and hand tracking from OpenXR.
// Writes all data into shared memory.
// ═══════════════════════════════════════════════════════════════

#include "xr_decoder.h"
#include "xr_session.h"
#include "xr_sharedmemory.h"

#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cstdio>
#include <cstring>
#include <cmath>

namespace xr_bridge {

// OpenXR hand joint indices
static constexpr int J_PALM = 0, J_WRIST = 1;
static constexpr int J_THUMB_TIP = 5, J_THUMB_META = 2;
static constexpr int J_INDEX_TIP = 10, J_INDEX_META = 6;
static constexpr int J_MIDDLE_TIP = 15, J_MIDDLE_META = 11;
static constexpr int J_RING_TIP = 20, J_RING_META = 16;
static constexpr int J_LITTLE_TIP = 25, J_LITTLE_META = 21;

XRDecoder::XRDecoder(XRSession& session) : m_session(session) {}
XRDecoder::~XRDecoder() { destroy(); }

bool XRDecoder::create() {
    bool ok = initActions();
    if (!ok) fprintf(stderr, "[xr-decoder] action init failed (non-fatal)\n");

    if (m_session.config().enableHandTracking) {
        initHandTracking();
    }

    fprintf(stderr, "[xr-decoder] created (hands: %s)\n",
            m_handTrackingSupported ? "yes" : "no");
    return true;
}

void XRDecoder::destroy() {
    for (int i = 0; i < 2; i++) {
        if (m_handTrackers[i]) m_xrDestroyHandTracker(m_handTrackers[i]);
        if (m_controllerSpace[i]) xrDestroySpace(m_controllerSpace[i]);
    }
    if (m_actionSet) xrDestroyActionSet(m_actionSet);
}

bool XRDecoder::initActions() {
    XrActionSetCreateInfo asci{};
    asci.type = XR_TYPE_ACTION_SET_CREATE_INFO;
    std::strncpy(asci.actionSetName, "controls", XR_MAX_ACTION_SET_NAME_SIZE);
    std::strncpy(asci.localizedActionSetName, "Controls", XR_MAX_LOCALIZED_ACTION_SET_NAME_SIZE);

    XrResult result = xrCreateActionSet(m_session.instance(), &asci, &m_actionSet);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-decoder] xrCreateActionSet failed: %d\n", result);
        return false;
    }

    // Create controller pose spaces (simplified — v0.2 will use proper action bindings)
    for (int i = 0; i < 2; i++) {
        XrReferenceSpaceCreateInfo rsci{};
        rsci.type = XR_TYPE_REFERENCE_SPACE_CREATE_INFO;
        rsci.session = m_session.session();
        rsci.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
        rsci.poseInReferenceSpace = XrPosef{{0,0,0,1}, {0,0,0}};

        result = xrCreateReferenceSpace(m_session.session(), &rsci, &m_controllerSpace[i]);
        if (result != XR_SUCCESS) {
            fprintf(stderr, "[xr-decoder] controller space %d failed: %d\n", i, result);
        }
    }

    return true;
}

bool XRDecoder::initHandTracking() {
    XrInstance inst = m_session.instance();

    xrGetInstanceProcAddr(inst, "xrCreateHandTrackerEXT",
        reinterpret_cast<PFN_xrVoidFunction*>(&m_xrCreateHandTracker));
    xrGetInstanceProcAddr(inst, "xrDestroyHandTrackerEXT",
        reinterpret_cast<PFN_xrVoidFunction*>(&m_xrDestroyHandTracker));
    xrGetInstanceProcAddr(inst, "xrLocateHandJointsEXT",
        reinterpret_cast<PFN_xrVoidFunction*>(&m_xrLocateHandJoints));

    if (!m_xrCreateHandTracker || !m_xrDestroyHandTracker || !m_xrLocateHandJoints) {
        fprintf(stderr, "[xr-decoder] hand tracking extension not available\n");
        m_handTrackingSupported = false;
        return false;
    }

    for (int i = 0; i < 2; i++) {
        XrHandTrackerCreateInfoEXT htci{};
        htci.type = XR_TYPE_HAND_TRACKER_CREATE_INFO_EXT;
        htci.hand = (i == 0) ? XR_HAND_LEFT_EXT : XR_HAND_RIGHT_EXT;
        htci.handJointSet = XR_HAND_JOINT_SET_DEFAULT_EXT;

        XrResult result = m_xrCreateHandTracker(m_session.session(), &htci, &m_handTrackers[i]);
        if (result != XR_SUCCESS) {
            fprintf(stderr, "[xr-decoder] hand tracker %d failed: %d\n", i, result);
        }
    }

    m_handTrackingSupported = (m_handTrackers[0] != XR_NULL_HANDLE || m_handTrackers[1] != XR_NULL_HANDLE);
    return m_handTrackingSupported;
}

void XRDecoder::poll() {
    // Get predicted display time from session's last beginFrame
    // For polling without frame sync, use 0 (runtime will use latest)
    XrTime predictedTime = 0;

    pollPose(predictedTime);
    pollControllers(predictedTime);
    if (m_handTrackingSupported) {
        pollHands(predictedTime);
    }

    // Detect and write gestures
    GestureResult gestures = detectGestures();
    m_session.sharedMemory()->writeGestures(gestures);
}

void XRDecoder::pollPose(XrTime predictedTime) {
    XrViewLocateInfo vli{};
    vli.type = XR_TYPE_VIEW_LOCATE_INFO;
    vli.viewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
    vli.displayTime = predictedTime;
    vli.space = m_session.space();

    XrViewState viewState{};
    viewState.type = XR_TYPE_VIEW_STATE;

    XrView views[2]{};
    views[0].type = XR_TYPE_VIEW;
    views[1].type = XR_TYPE_VIEW;

    uint32_t viewCount = 0;
    XrResult result = xrLocateViews(m_session.session(), &vli, &viewState, 2, &viewCount, views);
    if (result != XR_SUCCESS || viewCount < 2) return;

    Pose head, leftEye, rightEye;

    // Head = midpoint between eyes
    head.px = (views[0].pose.position.x + views[1].pose.position.x) / 2;
    head.py = (views[0].pose.position.y + views[1].pose.position.y) / 2;
    head.pz = (views[0].pose.position.z + views[1].pose.position.z) / 2;
    head.qx = views[0].pose.orientation.x;
    head.qy = views[0].pose.orientation.y;
    head.qz = views[0].pose.orientation.z;
    head.qw = views[0].pose.orientation.w;

    leftEye.px = views[0].pose.position.x;
    leftEye.py = views[0].pose.position.y;
    leftEye.pz = views[0].pose.position.z;
    leftEye.qx = views[0].pose.orientation.x;
    leftEye.qy = views[0].pose.orientation.y;
    leftEye.qz = views[0].pose.orientation.z;
    leftEye.qw = views[0].pose.orientation.w;

    rightEye.px = views[1].pose.position.x;
    rightEye.py = views[1].pose.position.y;
    rightEye.pz = views[1].pose.position.z;
    rightEye.qx = views[1].pose.orientation.x;
    rightEye.qy = views[1].pose.orientation.y;
    rightEye.qz = views[1].pose.orientation.z;
    rightEye.qw = views[1].pose.orientation.w;

    m_session.sharedMemory()->writePoseData(head, leftEye, rightEye);
}

void XRDecoder::pollControllers(XrTime predictedTime) {
    ControllerState left{}, right{};

    for (int i = 0; i < 2; i++) {
        if (m_controllerSpace[i] == XR_NULL_HANDLE) continue;

        XrSpaceLocation loc{};
        loc.type = XR_TYPE_SPACE_LOCATION;
        XrResult result = xrLocateSpace(m_controllerSpace[i], m_session.space(), predictedTime, &loc);
        if (result != XR_SUCCESS) continue;

        if (loc.locationFlags & XR_SPACE_LOCATION_POSITION_VALID_BIT) {
            ControllerState& cs = (i == 0) ? left : right;
            cs.active = true;
            cs.pose.px = loc.pose.position.x;
            cs.pose.py = loc.pose.position.y;
            cs.pose.pz = loc.pose.position.z;
            cs.pose.qx = loc.pose.orientation.x;
            cs.pose.qy = loc.pose.orientation.y;
            cs.pose.qz = loc.pose.orientation.z;
            cs.pose.qw = loc.pose.orientation.w;
        }
    }

    m_session.sharedMemory()->writeControllerData(left, right);
}

void XRDecoder::pollHands(XrTime predictedTime) {
    if (!m_xrLocateHandJoints) return;

    HandData hands[2];

    for (int i = 0; i < 2; i++) {
        if (m_handTrackers[i] == XR_NULL_HANDLE) continue;

        XrHandJointLocationsEXT jointLocs{};
        jointLocs.type = XR_TYPE_HAND_JOINT_LOCATIONS_EXT;
        jointLocs.jointCount = HAND_JOINT_COUNT;
        jointLocs.isActive = false;

        std::array<XrPosef, HAND_JOINT_COUNT> jointPoses;
        std::array<float, HAND_JOINT_COUNT> jointRadii;
        jointLocs.jointLocations = jointPoses.data();
        jointLocs.jointRadii = jointRadii.data();

        XrHandJointsLocateInfoEXT locateInfo{};
        locateInfo.type = XR_TYPE_HAND_JOINTS_LOCATE_INFO_EXT;
        locateInfo.baseSpace = m_session.space();
        locateInfo.time = predictedTime;

        XrResult result = m_xrLocateHandJoints(m_handTrackers[i], &locateInfo, &jointLocs);
        if (result == XR_SUCCESS && jointLocs.isActive) {
            hands[i].active = true;
            for (int j = 0; j < HAND_JOINT_COUNT; j++) {
                hands[i].joints[j].px = jointPoses[j].position.x;
                hands[i].joints[j].py = jointPoses[j].position.y;
                hands[i].joints[j].pz = jointPoses[j].position.z;
                hands[i].joints[j].qx = jointPoses[j].orientation.x;
                hands[i].joints[j].qy = jointPoses[j].orientation.y;
                hands[i].joints[j].qz = jointPoses[j].orientation.z;
                hands[i].joints[j].qw = jointPoses[j].orientation.w;
                hands[i].radii[j] = jointRadii[j];
            }

            // Compute pinch strength (thumb tip → index tip distance)
            float pinchDist = jointDist(hands[i].joints[J_THUMB_TIP], hands[i].joints[J_INDEX_TIP]);
            hands[i].pinch = clampf(1.0f - pinchDist / 0.03f, 0, 1); // 3cm = no pinch

            // Compute grip strength (all fingertips → palm distance)
            float avgDist = (
                jointDist(hands[i].joints[J_INDEX_TIP], hands[i].joints[J_PALM]) +
                jointDist(hands[i].joints[J_MIDDLE_TIP], hands[i].joints[J_PALM]) +
                jointDist(hands[i].joints[J_RING_TIP], hands[i].joints[J_PALM]) +
                jointDist(hands[i].joints[J_LITTLE_TIP], hands[i].joints[J_PALM])
            ) / 4.0f;
            hands[i].grip = clampf(1.0f - avgDist / 0.08f, 0, 1); // 8cm = open
        }
    }

    m_session.sharedMemory()->writeHandData(hands[0], hands[1]);
}

// ── Gesture detection helpers ──
static bool isFingerExtended(const HandData& h, int tip, int meta) {
    return jointDist(h.joints[tip], h.joints[J_PALM]) >
           jointDist(h.joints[tip], h.joints[meta]) * 0.8f;
}

static bool isFingerCurled(const HandData& h, int tip) {
    return jointDist(h.joints[tip], h.joints[J_PALM]) < 0.06f;
}

GestureResult XRDecoder::detectGestures() {
    GestureResult result;
    auto* shm = m_session.sharedMemory()->data();
    if (!shm) return result;

    for (int i = 0; i < 2; i++) {
        const HandData& hand = (i == 0) ? shm->leftHand : shm->rightHand;
        if (!hand.active) continue;

        bool thumb = isFingerExtended(hand, J_THUMB_TIP, J_THUMB_META);
        bool index = isFingerExtended(hand, J_INDEX_TIP, J_INDEX_META);
        bool middle = isFingerExtended(hand, J_MIDDLE_TIP, J_MIDDLE_META);
        bool ring = isFingerExtended(hand, J_RING_TIP, J_RING_META);
        bool little = isFingerExtended(hand, J_LITTLE_TIP, J_LITTLE_META);

        float thumbIndexDist = jointDist(hand.joints[J_THUMB_TIP], hand.joints[J_INDEX_TIP]);

        Gesture g = Gesture::None;
        float conf = 0.7f;

        if (thumbIndexDist < 0.02f && !middle && !ring) {
            g = Gesture::Pinch; conf = 0.9f;
        } else if (!index && !middle && !ring && !little) {
            g = Gesture::Fist; conf = 0.85f;
        } else if (thumb && index && middle && ring && little) {
            g = Gesture::Open; conf = 0.85f;
        } else if (index && !middle && !ring && !little) {
            g = Gesture::Point; conf = 0.8f;
        } else if (index && middle && !ring && !little) {
            g = Gesture::Peace; conf = 0.8f;
        } else if (thumb && !index && !middle && !ring && !little) {
            g = Gesture::ThumbsUp; conf = 0.75f;
        }

        if (i == 0) { result.left = g; result.leftConfidence = conf; }
        else        { result.right = g; result.rightConfidence = conf; }
    }

    return result;
}

} // namespace xr_bridge
