#pragma once

// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — XR Session
// Manages OpenXR instance, session, reference spaces, and frame loop.
// Coordinates encoder (frame submission) and decoder (pose/input).
// ═══════════════════════════════════════════════════════════════

#include "xr_types.h"
#include "xr_sharedmemory.h"

#ifdef _WIN32
#include <d3d11.h>
#include <wrl/client.h>
#endif

#include <openxr/openxr.h>
#include <atomic>
#include <thread>
#include <memory>

namespace xr_bridge {

class XREncoder;
class XRDecoder;

class XRSession {
public:
    XRSession();
    ~XRSession();

    // Lifecycle
    bool create(const SessionConfig& config);
    void destroy();
    bool beginSession();
    void endSession();

    // Frame loop
    bool beginFrame();
    void endFrame();

    // State
    bool isActive() const { return m_active.load(); }
    SessionInfo getInfo() const;

    // Subsystem access
    XREncoder* encoder() { return m_encoder.get(); }
    XRDecoder* decoder() { return m_decoder.get(); }
    XRSharedMemory* sharedMemory() { return &m_sharedMem; }

#ifdef _WIN32
    ID3D11Device* d3dDevice() { return m_d3dDevice.Get(); }
    ID3D11DeviceContext* d3dContext() { return m_d3dContext.Get(); }
#endif

    // OpenXR handle accessors (for encoder/decoder)
    XrInstance instance() { return m_instance; }
    XrSession session() { return m_session; }
    XrSpace space() { return m_space; }
    XrSystemId systemId() { return m_systemId; }
    const SessionConfig& config() const { return m_config; }

private:
    std::atomic<bool> m_active{false};
    std::atomic<bool> m_running{false};

    XrInstance m_instance = XR_NULL_HANDLE;
    XrSystemId m_systemId = XR_NULL_SYSTEM_ID;
    XrSession m_session = XR_NULL_HANDLE;
    XrSpace m_space = XR_NULL_HANDLE;

    SessionConfig m_config;
    SessionInfo m_info;

    XRSharedMemory m_sharedMem;
    std::unique_ptr<XREncoder> m_encoder;
    std::unique_ptr<XRDecoder> m_decoder;

    // Background poll thread
    std::thread m_pollThread;
    std::atomic<bool> m_pollRunning{false};

#ifdef _WIN32
    Microsoft::WRL::ComPtr<ID3D11Device> m_d3dDevice;
    Microsoft::WRL::ComPtr<ID3D11DeviceContext> m_d3dContext;
    bool createD3D11Device();
#endif

    void pollLoop();
    bool createSwapchains();
};

} // namespace xr_bridge
