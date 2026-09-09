// ═══════════════════════════════════════════════════════════════
// OpenXR Bridge — Shared Memory Implementation
// ═══════════════════════════════════════════════════════════════

#include "xr_sharedmemory.h"
#include <cstdio>
#include <cstring>

namespace xr_bridge {

XRSharedMemory::~XRSharedMemory() {
    close();
}

bool XRSharedMemory::create(const std::string& name, size_t size) {
    m_name = name;
    m_size = size;

#ifdef _WIN32
    // Create or open a file mapping
    m_handle = CreateFileMappingA(
        INVALID_HANDLE_VALUE,
        nullptr,
        PAGE_READWRITE,
        0,
        (DWORD)size,
        name.c_str()
    );

    if (!m_handle) {
        fprintf(stderr, "[xr-shm] CreateFileMapping failed: %lu\n", GetLastError());
        return false;
    }

    m_data = (SharedMemoryLayout*)MapViewOfFile(
        m_handle,
        FILE_MAP_ALL_ACCESS,
        0, 0, size
    );

    if (!m_data) {
        fprintf(stderr, "[xr-shm] MapViewOfFile failed: %lu\n", GetLastError());
        CloseHandle(m_handle);
        m_handle = nullptr;
        return false;
    }

    // Zero the memory
    memset(m_data, 0, size);
#else
    // POSIX shared memory
    m_fd = shm_open(name.c_str(), O_CREAT | O_RDWR, 0666);
    if (m_fd < 0) {
        perror("[xr-shm] shm_open");
        return false;
    }

    if (ftruncate(m_fd, size) != 0) {
        perror("[xr-shm] ftruncate");
        close(m_fd);
        m_fd = -1;
        return false;
    }

    m_data = (SharedMemoryLayout*)mmap(nullptr, size,
        PROT_READ | PROT_WRITE, MAP_SHARED, m_fd, 0);

    if (m_data == MAP_FAILED) {
        perror("[xr-shm] mmap");
        m_data = nullptr;
        close(m_fd);
        m_fd = -1;
        return false;
    }

    memset(m_data, 0, size);
#endif

    fprintf(stderr, "[xr-shm] created '%s' (%zu bytes)\n", name.c_str(), size);
    return true;
}

bool XRSharedMemory::open(const std::string& name, size_t size) {
    m_name = name;
    m_size = size;

#ifdef _WIN32
    m_handle = OpenFileMappingA(FILE_MAP_ALL_ACCESS, FALSE, name.c_str());
    if (!m_handle) {
        fprintf(stderr, "[xr-shm] OpenFileMapping failed: %lu\n", GetLastError());
        return false;
    }

    m_data = (SharedMemoryLayout*)MapViewOfFile(
        m_handle, FILE_MAP_ALL_ACCESS, 0, 0, size
    );

    if (!m_data) {
        fprintf(stderr, "[xr-shm] MapViewOfFile failed: %lu\n", GetLastError());
        CloseHandle(m_handle);
        m_handle = nullptr;
        return false;
    }
#else
    m_fd = shm_open(name.c_str(), O_RDWR, 0666);
    if (m_fd < 0) {
        perror("[xr-shm] shm_open");
        return false;
    }

    m_data = (SharedMemoryLayout*)mmap(nullptr, size,
        PROT_READ | PROT_WRITE, MAP_SHARED, m_fd, 0);

    if (m_data == MAP_FAILED) {
        perror("[xr-shm] mmap");
        m_data = nullptr;
        close(m_fd);
        m_fd = -1;
        return false;
    }
#endif

    fprintf(stderr, "[xr-shm] opened '%s' (%zu bytes)\n", name.c_str(), size);
    return true;
}

void XRSharedMemory::close() {
#ifdef _WIN32
    if (m_data) {
        UnmapViewOfFile(m_data);
        m_data = nullptr;
    }
    if (m_handle) {
        CloseHandle(m_handle);
        m_handle = nullptr;
    }
#else
    if (m_data) {
        munmap(m_data, m_size);
        m_data = nullptr;
    }
    if (m_fd >= 0) {
        ::close(m_fd);
        m_fd = -1;
    }
    if (!m_name.empty()) {
        shm_unlink(m_name.c_str());
    }
#endif
    m_size = 0;
}

void XRSharedMemory::writePoseData(const Pose& head, const Pose& leftEye, const Pose& rightEye) {
    if (!m_data) return;
    m_data->headPose = head;
    m_data->leftEyePose = leftEye;
    m_data->rightEyePose = rightEye;
    m_data->lastPoseTime = (int64_t)time(nullptr);
}

void XRSharedMemory::writeControllerData(const ControllerState& left, const ControllerState& right) {
    if (!m_data) return;
    m_data->leftController = left;
    m_data->rightController = right;
}

void XRSharedMemory::writeHandData(const HandData& left, const HandData& right) {
    if (!m_data) return;
    m_data->leftHand = left;
    m_data->rightHand = right;
}

void XRSharedMemory::writeGestures(const GestureResult& gestures) {
    if (!m_data) return;
    m_data->gestures = gestures;
}

void XRSharedMemory::writeFrameMetadata(uint64_t frameIndex, int64_t predictedTime,
                                        int leftIdx, int rightIdx) {
    if (!m_data) return;
    m_data->frameIndex = frameIndex;
    m_data->predictedDisplayTime = predictedTime;
    m_data->leftSwapchainIndex = leftIdx;
    m_data->rightSwapchainIndex = rightIdx;
    m_data->lastFrameTime = (int64_t)time(nullptr);
}

void XRSharedMemory::writeCommand(uint32_t command, uint32_t param) {
    if (!m_data) return;
    m_data->command = command;
    m_data->commandParam = param;
}

uint32_t XRSharedMemory::readCommand(uint32_t* param) {
    if (!m_data) return CMD_NONE;
    if (param) *param = m_data->commandParam;
    return m_data->command;
}

void XRSharedMemory::setSessionState(uint32_t state) {
    if (!m_data) return;
    m_data->sessionState = state;
}

uint32_t XRSharedMemory::getSessionState() const {
    if (!m_data) return STATE_IDLE;
    return m_data->sessionState;
}

} // namespace xr_bridge
