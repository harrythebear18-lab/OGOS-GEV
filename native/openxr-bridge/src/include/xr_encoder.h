#pragma once

// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Encoder
// Manages OpenXR swapchains for left/right eye.
// Acquires swapchain images, receives textures from Electron,
// and submits composed frames to the HMD.
// ═══════════════════════════════════════════════════════════════

#include "xr_types.h"
#include "xr_session.h"
#include <openxr/openxr.h>

#ifdef _WIN32
#include <d3d11.h>
#include <wrl/client.h>
#endif

#include <vector>
#include <memory>

namespace xr_bridge {

class XREncoder {
public:
    explicit XREncoder(XRSession& session);
    ~XREncoder();

    bool create();
    void destroy();

    // Frame submission
    void setPredictedDisplayTime(XrTime time) { m_predictedDisplayTime = time; }
    bool acquireImages();
    bool waitImages();
    bool releaseImages();
    void submitFrame();

    // Swapchain image access (for Electron to copy textures into)
#ifdef _WIN32
    ID3D11Texture2D* getLeftTexture(int index);
    ID3D11Texture2D* getRightTexture(int index);
#endif

    int getLeftSwapchainIndex() const { return m_leftIndex; }
    int getRightSwapchainIndex() const { return m_rightIndex; }

private:
    XRSession& m_session;

    XrSwapchain m_leftSwapchain = XR_NULL_HANDLE;
    XrSwapchain m_rightSwapchain = XR_NULL_HANDLE;

    XrTime m_predictedDisplayTime = 0;
    int m_leftIndex = -1;
    int m_rightIndex = -1;

    // Swapchain images
#ifdef _WIN32
    std::vector<Microsoft::WRL::ComPtr<ID3D11Texture2D>> m_leftImages;
    std::vector<Microsoft::WRL::ComPtr<ID3D11Texture2D>> m_rightImages;
#endif

    // Composition layers
    XrCompositionLayerProjection m_projectionLayer{};
    XrCompositionLayerProjectionView m_projectionViews[2]{};

    bool createSwapchain(XrSwapchain& swapchain,
                         std::vector<Microsoft::WRL::ComPtr<ID3D11Texture2D>>& images,
                         int width, int height);
};

} // namespace xr_bridge
