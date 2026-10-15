// pipe_client.cpp — the DLL's only thread: talks to the helper and enforces the fail-safe.
//
// Lifecycle:
//   1. Connect to \\.\pipe\InputSplit.Hook.<our pid> (the helper created it before
//      injecting us). Give up after a few seconds.
//   2. Send HELLO, then loop: wait up to one second for a command; on timeout, re-scan
//      windows and send STATUS (plus queued log lines).
//   3. If the pipe breaks for ANY reason (helper exited, crashed, was killed), disable
//      every feature immediately and end the thread. The game is back to normal.
//
// Overlapped (asynchronous) I/O is used because a plain blocking ReadFile would also block
// our own WriteFile calls on the same handle.
#include "pipe_client.h"

#include <cstdio>
#include <cstring>

#include "../common/hook_protocol.h"
#include "../common/version.h"
#include "controller.h"
#include "hook_state.h"
#include "log.h"
#include "modules.h"

namespace inputsplit::hook {
namespace {

std::atomic<bool> g_workerRunning{false};

class Pipe {
 public:
  ~Pipe() {
    if (handle_ != INVALID_HANDLE_VALUE) {
      if (readPending_) {
        // The OVERLAPPED structure must stay valid until the cancelled read completes.
        CancelIo(handle_);
        DWORD ignored = 0;
        GetOverlappedResult(handle_, &readOverlapped_, &ignored, TRUE);
      }
      CloseHandle(handle_);
    }
    if (readEvent_ != nullptr) CloseHandle(readEvent_);
    if (writeEvent_ != nullptr) CloseHandle(writeEvent_);
  }

  bool Connect(const wchar_t* name, DWORD timeoutMs) {
    readEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    writeEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (readEvent_ == nullptr || writeEvent_ == nullptr) return false;
    const ULONGLONG deadline = GetTickCount64() + timeoutMs;
    while (GetTickCount64() < deadline) {
      handle_ = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
                            FILE_FLAG_OVERLAPPED, nullptr);
      if (handle_ != INVALID_HANDLE_VALUE) {
        DWORD mode = PIPE_READMODE_MESSAGE;
        SetNamedPipeHandleState(handle_, &mode, nullptr, nullptr);
        return true;
      }
      if (GetLastError() == ERROR_PIPE_BUSY) {
        WaitNamedPipeW(name, 250);
      } else {
        Sleep(100);
      }
    }
    return false;
  }

  bool Write(const void* data, DWORD size) {
    OVERLAPPED overlapped{};
    overlapped.hEvent = writeEvent_;
    ResetEvent(writeEvent_);
    DWORD written = 0;
    if (!WriteFile(handle_, data, size, &written, &overlapped)) {
      if (GetLastError() != ERROR_IO_PENDING) return false;
      if (WaitForSingleObject(writeEvent_, 2000) != WAIT_OBJECT_0) return false;
      if (!GetOverlappedResult(handle_, &overlapped, &written, FALSE)) return false;
    }
    return written == size;
  }

  // Starts an asynchronous read into `buffer_`. Returns false if the pipe is broken.
  bool BeginRead() {
    ZeroMemory(&readOverlapped_, sizeof(readOverlapped_));
    readOverlapped_.hEvent = readEvent_;
    ResetEvent(readEvent_);
    if (!ReadFile(handle_, buffer_, sizeof(buffer_), nullptr, &readOverlapped_)) {
      DWORD error = GetLastError();
      if (error != ERROR_IO_PENDING) return false;
    }
    readPending_ = true;  // completed synchronously or not, the event is signalled
    return true;
  }

  // After the read event fired: returns the number of bytes, or 0 if the pipe broke.
  DWORD FinishRead() {
    DWORD bytes = 0;
    readPending_ = false;
    if (!GetOverlappedResult(handle_, &readOverlapped_, &bytes, FALSE)) return 0;
    return bytes;
  }

  HANDLE readEvent() const { return readEvent_; }
  const uint8_t* buffer() const { return buffer_; }

 private:
  HANDLE handle_ = INVALID_HANDLE_VALUE;
  HANDLE readEvent_ = nullptr;
  HANDLE writeEvent_ = nullptr;
  OVERLAPPED readOverlapped_{};
  bool readPending_ = false;
  alignas(8) uint8_t buffer_[proto::kMaxMessageSize]{};
};

bool SendStatusAndLogs(Pipe& pipe) {
  LogEntry entry;
  while (PopLog(entry)) {
    auto message = proto::MakeMessage<proto::LogMessage>(proto::MessageType::Log);
    message.level = static_cast<uint32_t>(entry.level);
    snprintf(message.text, sizeof(message.text), "%s", entry.text);
    if (!pipe.Write(&message, sizeof(message))) return false;
  }
  auto status = BuildStatus();
  return pipe.Write(&status, sizeof(status));
}

// Returns false if the session should end.
bool HandleMessage(Pipe& pipe, const uint8_t* data, DWORD bytes) {
  switch (static_cast<proto::MessageType>(proto::ValidateMessage(data, bytes))) {
    case proto::MessageType::Configure: {
      proto::ConfigureMessage message;
      memcpy(&message, data, sizeof(message));
      ApplyConfiguration(message.features, message.xinputSlot,
                         reinterpret_cast<HWND>(static_cast<uintptr_t>(message.gameWindow)));
      return SendStatusAndLogs(pipe);
    }
    case proto::MessageType::Disable:
      DisableAll();
      return SendStatusAndLogs(pipe);
    case proto::MessageType::FrameStats: {
      proto::FrameStatsMessage message;
      memcpy(&message, data, sizeof(message));
      SetFrameStats(message.enabled != 0);
      return SendStatusAndLogs(pipe);
    }
    default:
      Log(LogLevel::Warn, "Ignoring an invalid message (%lu bytes)", bytes);
      return true;
  }
}

DWORD WINAPI Worker(LPVOID) {
  wchar_t name[96];
  swprintf(name, 96, L"%ls%lu", proto::kPipePrefix, GetCurrentProcessId());

  {
    Pipe pipe;
    if (!pipe.Connect(name, 5000)) {
      Log(LogLevel::Error, "Could not connect to the InputSplit helper");
    } else {
      auto hello = proto::MakeMessage<proto::HelloMessage>(proto::MessageType::Hello);
      hello.pid = GetCurrentProcessId();
      hello.architectureBits = sizeof(void*) * 8;
      hello.detectedApis = ApisAtAttach();
      hello.dllBuildId = INPUTSPLIT_BUILD_ID;
      bool connected = pipe.Write(&hello, sizeof(hello)) && pipe.BeginRead();

      while (connected) {
        DWORD wait = WaitForSingleObject(pipe.readEvent(), 1000);
        if (wait == WAIT_OBJECT_0) {
          DWORD bytes = pipe.FinishRead();
          connected = bytes > 0 && HandleMessage(pipe, pipe.buffer(), bytes) && pipe.BeginRead();
        } else if (wait == WAIT_TIMEOUT) {
          Tick();
          connected = SendStatusAndLogs(pipe);
        } else {
          connected = false;
        }
      }
    }
  }  // pipe closed here

  // Fail-safe: whatever happened to the helper, the game goes back to normal.
  DisableAll();
  OutputDebugStringA("[InputSplitHook] Helper connection closed; all features disabled\n");
  g_workerRunning.store(false);
  return 0;
}

}  // namespace

bool StartWorker() {
  bool expected = false;
  if (!g_workerRunning.compare_exchange_strong(expected, true)) return true;  // already running
  static bool snapshotTaken = false;  // later attaches would see our own pre-loaded XInput
  if (!snapshotTaken) {
    SnapshotApisAtAttach();
    snapshotTaken = true;
  }
  HANDLE thread = CreateThread(nullptr, 0, &Worker, nullptr, 0, nullptr);
  if (thread == nullptr) {
    g_workerRunning.store(false);
    return false;
  }
  CloseHandle(thread);
  return true;
}

}  // namespace inputsplit::hook
