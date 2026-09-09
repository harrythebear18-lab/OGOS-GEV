#pragma once

// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Shared Memory Manager
// Manages a shared memory region for zero-copy pose/input/frame data.
// ═══════════════════════════════════════════════════════════════

#include "xr_types.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>
#endif

#include <string>

namespace xr_bridge {

class XRSharedMemory {
public:
    XRSharedMemory() = default;
    ~XRSharedMemory();

    // Create or open a shared memory region
    bool create(const std::string& name, size_t size = sizeof(SharedMemoryLayout));
    bool open(const std::string& name, size_t size = sizeof(SharedMemoryLayout));
    void close();

    // Access the shared data
    SharedMemoryLayout* data() { return m_data; }
    const SharedMemoryLayout* data() const { return m_data; }

    bool isValid() const { return m_data != nullptr; }
    size_t size() const { return m_size; }

    // Write pose data (decoder writes, Electron reads)
    void writePoseData(const Pose& head, const Pose& leftEye, const Pose& rightEye);
    void writeControllerData(const ControllerState& left, const ControllerState& right);
    void writeHandData(const HandData& left, const HandData& right);
    void writeGestures(const GestureResult& gestures);

    // Write frame metadata (encoder writes, decoder reads)
    void writeFrameMetadata(uint64_t frameIndex, int64_t predictedTime,
                            int leftIdx, int rightIdx);

    // Write command (Electron writes, native reads)
    void writeCommand(uint32_t command, uint32_t param = 0);

    // Read command (native reads, Electron writes)
    uint32_t readCommand(uint32_t* param = nullptr);

    // Update session state
    void setSessionState(uint32_t state);
    uint32_t getSessionState() const;

private:
    SharedMemoryLayout* m_data = nullptr;
    size_t m_size = 0;
    std::string m_name;

#ifdef _WIN32
    HANDLE m_handle = nullptr;
#else
    int m_fd = -1;
#endif
};

} // namespace xr_bridge
