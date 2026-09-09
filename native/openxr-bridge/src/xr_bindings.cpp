// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — N-API Bindings
// Exposes the encoder/decoder/session to JavaScript.
//
// JavaScript API:
//   const xr = require('xr-bridge')
//   xr.isAvailable()              → boolean
//   xr.createSession(config)      → boolean
//   xr.beginSession()             → boolean
//   xr.endSession()               → void
//   xr.destroySession()           → void
//   xr.getInfo()                  → SessionInfo
//   xr.getHeadPose()              → Pose
//   xr.getLeftEyePose()           → Pose
//   xr.getRightEyePose()          → Pose
//   xr.getLeftController()        → ControllerState
//   xr.getRightController()       → ControllerState
//   xr.getLeftHand()              → HandData
//   xr.getRightHand()             → HandData
//   xr.getGestures()              → GestureResult
//   xr.beginFrame()               → boolean
//   xr.endFrame()                 → void
//   xr.sendCommand(cmd, param)    → void
//   xr.getFrameMetadata()         → { frameIndex, predictedTime, leftIdx, rightIdx }
// ═══════════════════════════════════════════════════════════════

#include <napi.h>
#include "xr_session.h"
#include "xr_encoder.h"
#include "xr_decoder.h"
#include "xr_sharedmemory.h"
#include "xr_types.h"

#include <memory>
#include <string>
#include <cstdio>

using namespace Napi;

namespace {

std::unique_ptr<xr_bridge::XRSession> g_session;

// ── Helpers ──

Object poseToObject(Env env, const xr_bridge::Pose& p) {
    Object obj = Object::New(env);
    obj.Set("px", Number::New(env, p.px));
    obj.Set("py", Number::New(env, p.py));
    obj.Set("pz", Number::New(env, p.pz));
    obj.Set("qx", Number::New(env, p.qx));
    obj.Set("qy", Number::New(env, p.qy));
    obj.Set("qz", Number::New(env, p.qz));
    obj.Set("qw", Number::New(env, p.qw));
    return obj;
}

Object controllerToObject(Env env, const xr_bridge::ControllerState& cs) {
    Object obj = Object::New(env);
    obj.Set("trigger", Number::New(env, cs.trigger));
    obj.Set("grip", Number::New(env, cs.grip));
    obj.Set("joystickX", Number::New(env, cs.joystickX));
    obj.Set("joystickY", Number::New(env, cs.joystickY));
    obj.Set("active", Boolean::New(env, cs.active));
    obj.Set("pose", poseToObject(env, cs.pose));
    return obj;
}

Object handToObject(Env env, const xr_bridge::HandData& hand) {
    Object obj = Object::New(env);
    obj.Set("active", Boolean::New(env, hand.active));
    obj.Set("pinch", Number::New(env, hand.pinch));
    obj.Set("grip", Number::New(env, hand.grip));

    Array joints = Array::New(env, xr_bridge::HAND_JOINT_COUNT);
    for (int i = 0; i < xr_bridge::HAND_JOINT_COUNT; i++) {
        joints.Set(i, poseToObject(env, hand.joints[i]));
    }
    obj.Set("joints", joints);

    Array radii = Array::New(env, xr_bridge::HAND_JOINT_COUNT);
    for (int i = 0; i < xr_bridge::HAND_JOINT_COUNT; i++) {
        radii.Set(i, Number::New(env, hand.radii[i]));
    }
    obj.Set("radii", radii);

    return obj;
}

const char* gestureToString(xr_bridge::Gesture g) {
    switch (g) {
        case xr_bridge::Gesture::Pinch:    return "pinch";
        case xr_bridge::Gesture::Fist:     return "fist";
        case xr_bridge::Gesture::Open:     return "open";
        case xr_bridge::Gesture::Point:    return "point";
        case xr_bridge::Gesture::ThumbsUp: return "thumbsup";
        case xr_bridge::Gesture::Peace:    return "peace";
        default:                           return "none";
    }
}

// ── N-API Functions ──

Value IsAvailable(const CallbackInfo& info) {
    Env env = info.Env();
#ifdef _WIN32
    return Boolean::New(env, true); // v0.2: actually check for OpenXR runtime
#else
    return Boolean::New(env, false);
#endif
}

Value CreateSession(const CallbackInfo& info) {
    Env env = info.Env();
    if (g_session) return Boolean::New(env, true);

    xr_bridge::SessionConfig config;
    if (info.Length() > 0 && info[0].IsObject()) {
        Object cfg = info[0].As<Object>();
        if (cfg.Has("renderWidth"))  config.renderWidth  = cfg.Get("renderWidth").As<Number>().Int32Value();
        if (cfg.Has("renderHeight")) config.renderHeight = cfg.Get("renderHeight").As<Number>().Int32Value();
        if (cfg.Has("ipd"))           config.ipd          = cfg.Get("ipd").As<Number>().FloatValue();
        if (cfg.Has("refreshRate"))   config.refreshRate  = cfg.Get("refreshRate").As<Number>().Int32Value();
        if (cfg.Has("enableHandTracking")) config.enableHandTracking = cfg.Get("enableHandTracking").As<Boolean>().Value();
    }

    g_session = std::make_unique<xr_bridge::XRSession>();
    bool ok = g_session->create(config);
    if (!ok) g_session.reset();
    return Boolean::New(env, ok);
}

Value BeginSession(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session) return Boolean::New(env, false);
    return Boolean::New(env, g_session->beginSession());
}

Value EndSession(const CallbackInfo& info) {
    if (g_session) g_session->endSession();
    return info.Env().Undefined();
}

Value DestroySession(const CallbackInfo& info) {
    if (g_session) {
        g_session->destroy();
        g_session.reset();
    }
    return info.Env().Undefined();
}

Value GetInfo(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session) {
        Object obj = Object::New(env);
        obj.Set("active", false);
        obj.Set("runtimeName", "none");
        obj.Set("hmdName", "");
        return obj;
    }
    auto si = g_session->getInfo();
    Object obj = Object::New(env);
    obj.Set("active", si.active);
    obj.Set("runtimeName", String::New(env, si.runtimeName));
    obj.Set("hmdName", String::New(env, si.hmdName));
    obj.Set("refreshRate", Number::New(env, si.refreshRate));
    obj.Set("renderWidth", Number::New(env, si.renderWidth));
    obj.Set("renderHeight", Number::New(env, si.renderHeight));
    obj.Set("ipd", Number::New(env, si.ipd));
    return obj;
}

Value GetHeadPose(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return poseToObject(env, xr_bridge::Pose::identity());
    return poseToObject(env, g_session->sharedMemory()->data()->headPose);
}

Value GetLeftEyePose(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return poseToObject(env, xr_bridge::Pose::identity());
    return poseToObject(env, g_session->sharedMemory()->data()->leftEyePose);
}

Value GetRightEyePose(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return poseToObject(env, xr_bridge::Pose::identity());
    return poseToObject(env, g_session->sharedMemory()->data()->rightEyePose);
}

Value GetLeftController(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return controllerToObject(env, xr_bridge::ControllerState{});
    return controllerToObject(env, g_session->sharedMemory()->data()->leftController);
}

Value GetRightController(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return controllerToObject(env, xr_bridge::ControllerState{});
    return controllerToObject(env, g_session->sharedMemory()->data()->rightController);
}

Value GetLeftHand(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return handToObject(env, xr_bridge::HandData{});
    return handToObject(env, g_session->sharedMemory()->data()->leftHand);
}

Value GetRightHand(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data())
        return handToObject(env, xr_bridge::HandData{});
    return handToObject(env, g_session->sharedMemory()->data()->rightHand);
}

Value GetGestures(const CallbackInfo& info) {
    Env env = info.Env();
    Object obj = Object::New(env);
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data()) {
        obj.Set("left", String::New(env, "none"));
        obj.Set("right", String::New(env, "none"));
        obj.Set("leftConfidence", Number::New(env, 0));
        obj.Set("rightConfidence", Number::New(env, 0));
        return obj;
    }
    auto& g = g_session->sharedMemory()->data()->gestures;
    obj.Set("left", String::New(env, gestureToString(g.left)));
    obj.Set("right", String::New(env, gestureToString(g.right)));
    obj.Set("leftConfidence", Number::New(env, g.leftConfidence));
    obj.Set("rightConfidence", Number::New(env, g.rightConfidence));
    return obj;
}

Value BeginFrame(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session) return Boolean::New(env, false);
    bool ok = g_session->beginFrame();
    if (ok && g_session->encoder()) g_session->encoder()->acquireImages();
    if (ok && g_session->encoder()) g_session->encoder()->waitImages();
    return Boolean::New(env, ok);
}

Value EndFrame(const CallbackInfo& info) {
    if (g_session) g_session->endFrame();
    return info.Env().Undefined();
}

Value SendCommand(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory()) return env.Undefined();
    uint32_t cmd = (info.Length() > 0 && info[0].IsNumber()) ? info[0].As<Number>().Uint32Value() : 0;
    uint32_t param = (info.Length() > 1 && info[1].IsNumber()) ? info[1].As<Number>().Uint32Value() : 0;
    g_session->sharedMemory()->writeCommand(cmd, param);
    return env.Undefined();
}

Value GetFrameMetadata(const CallbackInfo& info) {
    Env env = info.Env();
    Object obj = Object::New(env);
    if (!g_session || !g_session->sharedMemory() || !g_session->sharedMemory()->data()) {
        obj.Set("frameIndex", Number::New(env, 0));
        obj.Set("predictedTime", Number::New(env, 0));
        obj.Set("leftIdx", Number::New(env, -1));
        obj.Set("rightIdx", Number::New(env, -1));
        return obj;
    }
    auto* shm = g_session->sharedMemory()->data();
    obj.Set("frameIndex", Number::New(env, (double)shm->frameIndex));
    obj.Set("predictedTime", Number::New(env, (double)shm->predictedDisplayTime));
    obj.Set("leftIdx", Number::New(env, shm->leftSwapchainIndex));
    obj.Set("rightIdx", Number::New(env, shm->rightSwapchainIndex));
    obj.Set("renderWidth", Number::New(env, shm->renderWidth));
    obj.Set("renderHeight", Number::New(env, shm->renderHeight));
    return obj;
}

Value GetSessionState(const CallbackInfo& info) {
    Env env = info.Env();
    if (!g_session || !g_session->sharedMemory())
        return Number::New(env, xr_bridge::STATE_IDLE);
    return Number::New(env, g_session->sharedMemory()->getSessionState());
}

} // namespace

// ── Module Init ──

Object Init(Env env, Object exports) {
    exports.Set("isAvailable",        Function::New(env, IsAvailable));
    exports.Set("createSession",      Function::New(env, CreateSession));
    exports.Set("beginSession",       Function::New(env, BeginSession));
    exports.Set("endSession",         Function::New(env, EndSession));
    exports.Set("destroySession",     Function::New(env, DestroySession));
    exports.Set("getInfo",            Function::New(env, GetInfo));
    exports.Set("getHeadPose",         Function::New(env, GetHeadPose));
    exports.Set("getLeftEyePose",     Function::New(env, GetLeftEyePose));
    exports.Set("getRightEyePose",    Function::New(env, GetRightEyePose));
    exports.Set("getLeftController",   Function::New(env, GetLeftController));
    exports.Set("getRightController",  Function::New(env, GetRightController));
    exports.Set("getLeftHand",         Function::New(env, GetLeftHand));
    exports.Set("getRightHand",        Function::New(env, GetRightHand));
    exports.Set("getGestures",         Function::New(env, GetGestures));
    exports.Set("beginFrame",          Function::New(env, BeginFrame));
    exports.Set("endFrame",            Function::New(env, EndFrame));
    exports.Set("sendCommand",         Function::New(env, SendCommand));
    exports.Set("getFrameMetadata",    Function::New(env, GetFrameMetadata));
    exports.Set("getSessionState",     Function::New(env, GetSessionState));

    fprintf(stderr, "[xr-bridge] N-API module loaded\n");
    return exports;
}

NODE_API_MODULE(xr_bridge, Init)
