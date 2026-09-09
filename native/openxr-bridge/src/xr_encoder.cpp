// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Encoder Implementation
// Manages swapchains and submits composed stereo frames to the HMD.
// ═══════════════════════════════════════════════════════════════

#include "xr_encoder.h"
#include "xr_session.h"
#include "xr_sharedmemory.h"

#ifdef _WIN32
#include <d3d11.h>
#include <wrl/client.h>
#endif

#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cstdio>
#include <cstring>

namespace xr_bridge {

XREncoder::XREncoder(XRSession& session) : m_session(session) {}
XREncoder::~XREncoder() { destroy(); }

bool XREncoder::create() {
    const SessionConfig& cfg = m_session.config();

    if (!createSwapchain(m_leftSwapchain, m_leftImages, cfg.renderWidth, cfg.renderHeight)) {
        fprintf(stderr, "[xr-encoder] left swapchain failed\n");
        return false;
    }
    if (!createSwapchain(m_rightSwapchain, m_rightImages, cfg.renderWidth, cfg.renderHeight)) {
        fprintf(stderr, "[xr-encoder] right swapchain failed\n");
        return false;
    }

    // Initialize projection layer structure
    m_projectionLayer.type = XR_TYPE_COMPOSITION_LAYER_PROJECTION;
    m_projectionLayer.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
    m_projectionLayer.space = m_session.space();
    m_projectionLayer.viewCount = 2;
    m_projectionLayer.views = m_projectionViews;

    for (int i = 0; i < 2; i++) {
        m_projectionViews[i].type = XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW;
        m_projectionViews[i].subImage.swapchain = (i == 0) ? m_leftSwapchain : m_rightSwapchain;
        m_projectionViews[i].subImage.imageRect.offset.x = 0;
        m_projectionViews[i].subImage.imageRect.offset.y = 0;
        m_projectionViews[i].subImage.imageRect.extent.width = cfg.renderWidth;
        m_projectionViews[i].subImage.imageRect.extent.height = cfg.renderHeight;
        // Pose + fov will be filled per-frame from decoder
    }

    fprintf(stderr, "[xr-encoder] created L/R swapchains (%dx%d)\n",
            cfg.renderWidth, cfg.renderHeight);
    return true;
}

void XREncoder::destroy() {
    m_leftImages.clear();
    m_rightImages.clear();

    if (m_leftSwapchain) { xrDestroySwapchain(m_leftSwapchain); m_leftSwapchain = XR_NULL_HANDLE; }
    if (m_rightSwapchain) { xrDestroySwapchain(m_rightSwapchain); m_rightSwapchain = XR_NULL_HANDLE; }
}

bool XREncoder::createSwapchain(XrSwapchain& swapchain,
                                std::vector<Microsoft::WRL::ComPtr<ID3D11Texture2D>>& images,
                                int width, int height) {
    XrSwapchainCreateInfo sci{};
    sci.type = XR_TYPE_SWAPCHAIN_CREATE_INFO;
    sci.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
    sci.format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sci.sampleCount = 1;
    sci.width = width;
    sci.height = height;
    sci.faceCount = 1;
    sci.arraySize = 1;
    sci.mipCount = 1;

    XrResult result = xrCreateSwapchain(m_session.session(), &sci, &swapchain);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-encoder] xrCreateSwapchain failed: %d\n", result);
        return false;
    }

    // Enumerate swapchain images
    uint32_t imageCount = 0;
    xrEnumerateSwapchainImages(swapchain, 0, &imageCount, nullptr);

    std::vector<XrSwapchainImageD3D11KHR> xrImages(imageCount);
    for (auto& img : xrImages) {
        img.type = XR_TYPE_SWAPCHAIN_IMAGE_D3D11_KHR;
    }

    result = xrEnumerateSwapchainImages(swapchain, imageCount, &imageCount,
        reinterpret_cast<XrSwapchainImageBaseHeader*>(xrImages.data()));
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-encoder] enumerate images failed: %d\n", result);
        return false;
    }

    // Cache D3D11 textures
    images.resize(imageCount);
    for (uint32_t i = 0; i < imageCount; i++) {
        images[i] = xrImages[i].texture;
    }

    fprintf(stderr, "[xr-encoder] swapchain created with %u images\n", imageCount);
    return true;
}

bool XREncoder::acquireImages() {
    XrSwapchainImageAcquireInfo ai{};
    ai.type = XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO;

    XrResult result = xrAcquireSwapchainImage(m_leftSwapchain, &ai, (uint32_t*)&m_leftIndex);
    if (result != XR_SUCCESS) return false;

    result = xrAcquireSwapchainImage(m_rightSwapchain, &ai, (uint32_t*)&m_rightIndex);
    if (result != XR_SUCCESS) return false;

    // Write indices to shared memory for Electron
    m_session.sharedMemory()->writeFrameMetadata(
        m_session.sharedMemory()->data()->frameCount + 1,
        m_predictedDisplayTime,
        m_leftIndex, m_rightIndex
    );

    return true;
}

bool XREncoder::waitImages() {
    XrSwapchainImageWaitInfo wi{};
    wi.type = XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO;
    wi.timeout = XR_INFINITE_DURATION;

    if (xrWaitSwapchainImage(m_leftSwapchain, &wi) != XR_SUCCESS) return false;
    if (xrWaitSwapchainImage(m_rightSwapchain, &wi) != XR_SUCCESS) return false;
    return true;
}

bool XREncoder::releaseImages() {
    XrSwapchainImageReleaseInfo ri{};
    ri.type = XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO;

    if (xrReleaseSwapchainImage(m_leftSwapchain, &ri) != XR_SUCCESS) return false;
    if (xrReleaseSwapchainImage(m_rightSwapchain, &ri) != XR_SUCCESS) return false;

    m_leftIndex = -1;
    m_rightIndex = -1;
    return true;
}

void XREncoder::submitFrame() {
    if (m_leftIndex < 0 || m_rightIndex < 0) {
        // No images acquired — submit empty frame
        XrFrameEndInfo fei{};
        fei.type = XR_TYPE_FRAME_END_INFO;
        fei.displayTime = m_predictedDisplayTime;
        fei.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
        fei.layerCount = 0;
        fei.layers = nullptr;
        xrEndFrame(m_session.session(), &fei);
        return;
    }

    // Fill projection views with latest pose data from shared memory
    auto* shm = m_session.sharedMemory()->data();
    if (shm) {
        // Left eye
        m_projectionViews[0].pose.position.x = shm->leftEyePose.px;
        m_projectionViews[0].pose.position.y = shm->leftEyePose.py;
        m_projectionViews[0].pose.position.z = shm->leftEyePose.pz;
        m_projectionViews[0].pose.orientation.x = shm->leftEyePose.qx;
        m_projectionViews[0].pose.orientation.y = shm->leftEyePose.qy;
        m_projectionViews[0].pose.orientation.z = shm->leftEyePose.qz;
        m_projectionViews[0].pose.orientation.w = shm->leftEyePose.qw;

        // Right eye
        m_projectionViews[1].pose.position.x = shm->rightEyePose.px;
        m_projectionViews[1].pose.position.y = shm->rightEyePose.py;
        m_projectionViews[1].pose.position.z = shm->rightEyePose.pz;
        m_projectionViews[1].pose.orientation.x = shm->rightEyePose.qx;
        m_projectionViews[1].pose.orientation.y = shm->rightEyePose.qy;
        m_projectionViews[1].pose.orientation.z = shm->rightEyePose.qz;
        m_projectionViews[1].pose.orientation.w = shm->rightEyePose.qw;

        // FOV (would be filled from xrLocateViews in decoder — v0.2)
        // For now, use default Quest 3S FOV
        m_projectionViews[0].fov.left = -1.05f;
        m_projectionViews[0].fov.right = 1.05f;
        m_projectionViews[0].fov.up = 1.05f;
        m_projectionViews[0].fov.down = -1.05f;
        m_projectionViews[1].fov.left = -1.05f;
        m_projectionViews[1].fov.right = 1.05f;
        m_projectionViews[1].fov.up = 1.05f;
        m_projectionViews[1].fov.down = -1.05f;
    }

    // Submit projection layer
    const XrCompositionLayerBaseHeader* layers[] = {
        (XrCompositionLayerBaseHeader*)&m_projectionLayer
    };

    XrFrameEndInfo fei{};
    fei.type = XR_TYPE_FRAME_END_INFO;
    fei.displayTime = m_predictedDisplayTime;
    fei.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
    fei.layerCount = 1;
    fei.layers = layers;

    XrResult result = xrEndFrame(m_session.session(), &fei);
    if (result != XR_SUCCESS) {
        fprintf(stderr, "[xr-encoder] xrEndFrame failed: %d\n", result);
    }

    // Release images after submission
    releaseImages();
}

#ifdef _WIN32
ID3D11Texture2D* XREncoder::getLeftTexture(int index) {
    if (index < 0 || index >= (int)m_leftImages.size()) return nullptr;
    return m_leftImages[index].Get();
}

ID3D11Texture2D* XREncoder::getRightTexture(int index) {
    if (index < 0 || index >= (int)m_rightImages.size()) return nullptr;
    return m_rightImages[index].Get();
}
#endif

} // namespace xr_bridge
