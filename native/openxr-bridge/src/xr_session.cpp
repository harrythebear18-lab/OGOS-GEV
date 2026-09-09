// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — XR Session Implementation
// ═══════════════════════════════════════════════════════════════

#include "xr_session.h"
#include "xr_encoder.h"
#include "xr_decoder.h"

#ifdef _WIN32
#include <d3d11.h>
#endif

#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cstdio>
#include <cstring>
#include <chrono>

namespace xr_bridge {

static const char* SHM_NAME = "xr_bridge_shared_mem";

XRSession::XRSession() = default;

XRSession::~XRSession() {
    destroy();
}

bool XRSession::create(const SessionConfig& config) {
    m_config = config;

    // ── 1. Create shared memory ──
    if (!m_sharedMem.create(SHM_NAME)) {
        fprintf(stderr, "[xr-session] failed to create shared memory\n");
        return false;
    }
    m_sharedMem.setSessionState(STATE_IDLE);

    // ── 2. Create OpenXR instance ──
    const char* extensions[] = {
        XR_KHR_COMPOSITION_LAYER_DEPTH_SWAPCHAIN_EXTENSION_NAME,
        XR_EXT_HAND_TRACKING_EXTENSION_NAME,
        XR_FB_DISPLAY_REFRESH_RATE_EXTENSION_NAME,
    };

    XrInstanceCreateInfo ici{};
    ici.type = XR_TYPE_INSTANCE_CREATE_INFO;
    ici.applicationInfo.apiVersion = XR_CURRENT_API_VERSION;
    std::strncpy(ici.applicationInfo.applicationName, "OSINT Sentinel", XR_MAX_APPLICATION_NAME_SIZE);
    std::strncpy(ici.applicationInfo.engineName, "Earth Engine", XR_MAX_ENGINE_NAME_SIZE);
    ici.enabledExtensionCount = 3;
    ici.enabledExtensionNames = extensions;

    XrResult result = xrCreateInstance(&ici, &m_instance);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-session] xrCreateInstance failed: %d\n", result);
        return false;
    }

    // Get runtime name
    XrInstanceProperties ip{};
    ip.type = XR_TYPE_INSTANCE_PROPERTIES;
    xrGetInstanceProperties(m_instance, &ip);
    m_info.runtimeName = ip.runtimeName;

    // ── 3. Get system ID ──
    XrSystemGetInfo sgi{};
    sgi.type = XR_TYPE_SYSTEM_GET_INFO;
    sgi.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;

    result = xrGetSystem(m_instance, &sgi, &m_systemId);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-session] xrGetSystem failed: %d\n", result);
        xrDestroyInstance(m_instance);
        m_instance = XR_NULL_HANDLE;
        return false;
    }

    // Get HMD name
    XrSystemProperties sp{};
    sp.type = XR_TYPE_SYSTEM_PROPERTIES;
    xrGetSystemProperties(m_instance, m_systemId, &sp);
    m_info.hmdName = sp.systemName;

    // ── 4. Create D3D11 device (Windows) ──
#ifdef _WIN32
    if (!createD3D11Device()) {
        fprintf(stderr, "[xr-session] failed to create D3D11 device\n");
        xrDestroyInstance(m_instance);
        m_instance = XR_NULL_HANDLE;
        return false;
    }
#endif

    // ── 5. Create session ──
#ifdef _WIN32
    XrGraphicsBindingD3D11KHR graphicsBinding{};
    graphicsBinding.type = XR_TYPE_GRAPHICS_BINDING_D3D11_KHR;
    graphicsBinding.device = m_d3dDevice.Get();

    XrSessionCreateInfo sci{};
    sci.type = XR_TYPE_SESSION_CREATE_INFO;
    sci.next = &graphicsBinding;
    sci.systemId = m_systemId;

    result = xrCreateSession(m_instance, &sci, &m_session);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-session] xrCreateSession failed: %d\n", result);
        xrDestroyInstance(m_instance);
        m_instance = XR_NULL_HANDLE;
        return false;
    }
#endif

    // ── 6. Create reference space ──
    XrReferenceSpaceCreateInfo rsci{};
    rsci.type = XR_TYPE_REFERENCE_SPACE_CREATE_INFO;
    rsci.session = m_session;
    rsci.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
    rsci.poseInReferenceSpace = XrPosef{{0, 0, 0, 1}, {0, 0, 0}};

    result = xrCreateReferenceSpace(m_session, &rsci, &m_space);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-session] xrCreateReferenceSpace failed: %d\n", result);
        xrDestroySession(m_session);
        m_session = XR_NULL_HANDLE;
        xrDestroyInstance(m_instance);
        m_instance = XR_NULL_HANDLE;
        return false;
    }

    // ── 7. Create encoder and decoder ──
    m_encoder = std::make_unique<XREncoder>(*this);
    m_decoder = std::make_unique<XRDecoder>(*this);

    if (!m_encoder->create()) {
        fprintf(stderr, "[xr-session] encoder creation failed\n");
        return false;
    }
    if (!m_decoder->create()) {
        fprintf(stderr, "[xr-session] decoder creation failed\n");
        return false;
    }

    m_info.active = false;
    m_info.refreshRate = config.refreshRate;
    m_info.renderWidth = config.renderWidth;
    m_info.renderHeight = config.renderHeight;
    m_info.ipd = config.ipd;

    m_sharedMem.setSessionState(STATE_READY);
    fprintf(stderr, "[xr-session] created — runtime: %s, HMD: %s\n",
            m_info.runtimeName.c_str(), m_info.hmdName.c_str());
    return true;
}

void XRSession::destroy() {
    endSession();

    m_decoder.reset();
    m_encoder.reset();

    if (m_space) { xrDestroySpace(m_space); m_space = XR_NULL_HANDLE; }
    if (m_session) { xrDestroySession(m_session); m_session = XR_NULL_HANDLE; }
    if (m_instance) { xrDestroyInstance(m_instance); m_instance = XR_NULL_HANDLE; }

#ifdef _WIN32
    m_d3dContext.Reset();
    m_d3dDevice.Reset();
#endif

    m_sharedMem.close();
    m_active.store(false);
}

bool XRSession::beginSession() {
    if (!m_session) return false;

    XrSessionBeginInfo sbi{};
    sbi.type = XR_TYPE_SESSION_BEGIN_INFO;
    sbi.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;

    XrResult result = xrBeginSession(m_session, &sbi);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-session] xrBeginSession failed: %d\n", result);
        return false;
    }

    m_running.store(true);
    m_active.store(true);
    m_sharedMem.setSessionState(STATE_RUNNING);

    // Start background poll thread
    m_pollRunning.store(true);
    m_pollThread = std::thread(&XRSession::pollLoop, this);

    fprintf(stderr, "[xr-session] session started\n");
    return true;
}

void XRSession::endSession() {
    m_pollRunning.store(false);
    if (m_pollThread.joinable()) {
        m_pollThread.join();
    }

    if (m_running.load() && m_session) {
        xrEndSession(m_session);
        m_running.store(false);
    }

    m_active.store(false);
    m_sharedMem.setSessionState(STATE_IDLE);
    fprintf(stderr, "[xr-session] session ended\n");
}

bool XRSession::beginFrame() {
    if (!m_running.load()) return false;

    XrFrameState frameState{};
    frameState.type = XR_TYPE_FRAME_STATE;

    XrResult result = xrWaitFrame(m_session, nullptr, &frameState);
    if (result != XR_SUCCESS) return false;

    result = xrBeginFrame(m_session, nullptr);
    if (result != XR_SUCCESS) return false;

    // Store predicted display time for encoder
    if (m_encoder) {
        m_encoder->setPredictedDisplayTime(frameState.predictedDisplayTime);
    }

    return true;
}

void XRSession::endFrame() {
    if (!m_running.load()) return;

    // Encoder submits the frame layers
    if (m_encoder) {
        m_encoder->submitFrame();
    } else {
        XrFrameEndInfo fei{};
        fei.type = XR_TYPE_FRAME_END_INFO;
        fei.displayTime = 0;
        fei.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
        fei.layerCount = 0;
        fei.layers = nullptr;
        xrEndFrame(m_session, &fei);
    }

    m_sharedMem.data()->frameCount++;
}

SessionInfo XRSession::getInfo() const {
    return m_info;
}

void XRSession::pollLoop() {
    while (m_pollRunning.load()) {
        // Poll OpenXR events
        if (m_instance) {
            XrEventDataBuffer edb{};
            edb.type = XR_TYPE_EVENT_DATA_BUFFER;
            while (xrPollEvent(m_instance, &edb) == XR_SUCCESS) {
                if (edb.type == XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) {
                    auto* ssc = (XrEventDataSessionStateChanged*)&edb;
                    switch (ssc->state) {
                        case XR_SESSION_STATE_STOPPING:
                            m_running.store(false);
                            m_sharedMem.setSessionState(STATE_STOPPING);
                            break;
                        case XR_SESSION_STATE_EXITING:
                        case XR_SESSION_STATE_LOSS_PENDING:
                            m_pollRunning.store(false);
                            m_active.store(false);
                            m_sharedMem.setSessionState(STATE_IDLE);
                            break;
                        default:
                            break;
                    }
                }
                edb.type = XR_TYPE_EVENT_DATA_BUFFER;
            }
        }

        // Check for commands from Electron
        uint32_t cmdParam = 0;
        uint32_t cmd = m_sharedMem.readCommand(&cmdParam);
        if (cmd != CMD_NONE) {
            switch (cmd) {
                case CMD_RECENTER:
                    if (m_space) {
                        // Recenter reference space
                        fprintf(stderr, "[xr-session] recenter command\n");
                    }
                    break;
                case CMD_HAPTIC:
                    // Trigger haptic feedback
                    fprintf(stderr, "[xr-session] haptic command (param: %u)\n", cmdParam);
                    break;
                default:
                    break;
            }
            m_sharedMem.writeCommand(CMD_NONE); // Clear command
        }

        // Decoder polls pose + input at 90Hz
        if (m_decoder) {
            m_decoder->poll();
        }

        // Sleep ~11ms (90Hz)
        std::this_thread::sleep_for(std::chrono::milliseconds(11));
    }
}

#ifdef _WIN32
bool XRSession::createD3D11Device() {
    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };

    D3D_FEATURE_LEVEL obtained;
    HRESULT hr = D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
        featureLevels, 2, D3D11_SDK_VERSION,
        m_d3dDevice.GetAddressOf(), &obtained,
        m_d3dContext.GetAddressOf()
    );

    if (FAILED(hr)) {
        fprintf(stderr, "[xr-session] D3D11CreateDevice failed: 0x%08X\n", hr);
        return false;
    }

    fprintf(stderr, "[xr-session] D3D11 device created (level: 0x%X)\n", obtained);
    return true;
}
#endif

} // namespace xr_bridge
