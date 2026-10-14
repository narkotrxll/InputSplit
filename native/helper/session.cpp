#include "session.h"

#include <sddl.h>

#include <chrono>
#include <cstring>
#include <iterator>
#include <thread>
#include <vector>

#include "../common/version.h"
#include "injector.h"
#include "safety.h"

namespace inputsplit::helper {
namespace {

constexpr DWORD kConnectTimeoutMs = 5000;
constexpr DWORD kHandshakeTimeoutMs = 5000;
constexpr DWORD kStopConfirmTimeoutMs = 1000;

struct NamedBit {
  uint32_t bit;
  const char* name;
};

const NamedBit kFeatureNames[] = {
    {proto::kFeatureActivationShield, "activationShield"},
    {proto::kFeatureFocusSpoof, "focusSpoof"},
    {proto::kFeatureXInputBackground, "xinputBackground"},
    {proto::kFeatureXInputSlotLock, "xinputSlotLock"},
    {proto::kFeatureBlockKeyboard, "blockKeyboard"},
    {proto::kFeatureBlockMouse, "blockMouse"},
    {proto::kFeatureCursorGuard, "cursorGuard"},
};

const NamedBit kApiNames[] = {
    {proto::kApiXInput, "xinput"},
    {proto::kApiDirectInput8, "directInput8"},
    {proto::kApiWindowsGamingInput, "windowsGamingInput"},
    {proto::kApiGameInput, "gameInput"},
    {proto::kApiSdl2, "sdl2"},
    {proto::kApiSdl3, "sdl3"},
    {proto::kApiUnity, "unity"},
    {proto::kApiSteamApi, "steamApi"},
};

Json BitsToNames(uint32_t bits, const NamedBit* table, size_t count) {
  Json names = Json::array();
  for (size_t i = 0; i < count; ++i) {
    if (bits & table[i].bit) names.push_back(table[i].name);
  }
  return names;
}

const char* LogLevelName(uint32_t level) {
  switch (level) {
    case 0: return "debug";
    case 1: return "info";
    case 2: return "warn";
    default: return "error";
  }
}

int64_t NowUnixMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

// Security descriptor allowing only the current user and SYSTEM to open the pipe.
class PipeSecurity {
 public:
  PipeSecurity() {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return;
    DWORD size = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &size);
    std::vector<BYTE> buffer(size);
    if (GetTokenInformation(token, TokenUser, buffer.data(), size, &size)) {
      LPWSTR sidString = nullptr;
      auto* user = reinterpret_cast<TOKEN_USER*>(buffer.data());
      if (ConvertSidToStringSidW(user->User.Sid, &sidString)) {
        std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(sidString) + L")";
        LocalFree(sidString);
        ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1,
                                                             &descriptor_, nullptr);
      }
    }
    CloseHandle(token);
  }
  ~PipeSecurity() {
    if (descriptor_ != nullptr) LocalFree(descriptor_);
  }
  SECURITY_ATTRIBUTES* attributes() {
    if (descriptor_ == nullptr) return nullptr;  // falls back to the default descriptor
    attributes_ = {sizeof(SECURITY_ATTRIBUTES), descriptor_, FALSE};
    return &attributes_;
  }

 private:
  PSECURITY_DESCRIPTOR descriptor_ = nullptr;
  SECURITY_ATTRIBUTES attributes_{};
};

}  // namespace

uint32_t FeaturesFromJson(const Json& features) {
  uint32_t bits = 0;
  for (const NamedBit& feature : kFeatureNames) {
    if (features.value(feature.name, false)) bits |= feature.bit;
  }
  return bits;
}

Json FeaturesToJson(uint32_t bits) {
  return BitsToNames(bits, kFeatureNames, std::size(kFeatureNames));
}

Json ApisToJson(uint32_t bits) {
  return BitsToNames(bits, kApiNames, std::size(kApiNames));
}

// ---------------------------------------------------------------------------------------

class Session : public std::enable_shared_from_this<Session> {
 public:
  Session(int id, DWORD pid) : id_(id), pid_(pid) {}

  ~Session() {
    if (thread_.joinable()) thread_.detach();  // the thread holds a shared_ptr; never here
  }

  int id() const { return id_; }
  DWORD pid() const { return pid_; }

  bool Open(HelperError& error);
  bool Handshake(const StartRequest& request, HelperError& error);
  void StartThread();

  void RequestStop(const std::string& reason) {
    std::lock_guard<std::mutex> lock(commandMutex_);
    stopReason_ = reason;
    SetEvent(commandEvent_.get());
  }

  void RequestReconfigure(uint32_t features, uint32_t slot) {
    std::lock_guard<std::mutex> lock(commandMutex_);
    pendingConfigure_ = {features, slot};
    hasPendingConfigure_ = true;
    SetEvent(commandEvent_.get());
  }

  bool WaitEnded(DWORD timeoutMs) { return WaitForSingleObject(endedEvent_.get(), timeoutMs) == WAIT_OBJECT_0; }

  Json StatusJson() {
    std::lock_guard<std::mutex> lock(statusMutex_);
    return StatusToJsonLocked();
  }

 private:
  struct Configure {
    uint32_t features;
    uint32_t slot;
  };

  bool Write(const void* data, DWORD size);
  bool BeginRead();
  // Waits for a complete message. Returns the type, 0 on timeout, -1 if the pipe broke.
  int ReadMessage(DWORD timeoutMs);
  void HandleIncoming(int type);
  bool SendConfigure(uint32_t features, uint32_t slot);
  void Run();
  void Finish(const std::string& reason, const std::string& message);
  Json StatusToJsonLocked() const;
  bool IsPassThrough() {
    std::lock_guard<std::mutex> lock(statusMutex_);
    return lastStatus_.requested == 0 && lastStatus_.active == 0;
  }

  const int id_;
  const DWORD pid_;
  HWND window_ = nullptr;
  UniqueHandle process_;
  UniqueHandle pipe_;
  UniqueHandle readEvent_{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
  UniqueHandle writeEvent_{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
  UniqueHandle commandEvent_{CreateEventW(nullptr, FALSE, FALSE, nullptr)};
  UniqueHandle endedEvent_{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
  OVERLAPPED readOverlapped_{};
  bool readPending_ = false;
  alignas(8) uint8_t buffer_[proto::kMaxMessageSize]{};
  DWORD bufferBytes_ = 0;

  std::mutex commandMutex_;
  std::string stopReason_;
  Configure pendingConfigure_{};
  bool hasPendingConfigure_ = false;

  std::mutex statusMutex_;
  proto::StatusMessage lastStatus_{};
  bool hasStatus_ = false;
  uint32_t architectureBits_ = 0;
  int64_t updatedAt_ = 0;

  std::thread thread_;
};

bool Session::Open(HelperError& error) {
  process_.reset(OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION |
                                 PROCESS_VM_WRITE | PROCESS_VM_READ | SYNCHRONIZE,
                             FALSE, pid_));
  if (!process_.valid()) {
    error = {"accessDenied", "OpenProcess failed with error " + std::to_string(GetLastError())};
    return false;
  }
  std::wstring name = std::wstring(proto::kPipePrefix) + std::to_wstring(pid_);
  PipeSecurity security;
  pipe_.reset(CreateNamedPipeW(name.c_str(),
                               PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                               PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT |
                                   PIPE_REJECT_REMOTE_CLIENTS,
                               1, proto::kMaxMessageSize * 4, proto::kMaxMessageSize * 4, 0,
                               security.attributes()));
  if (!pipe_.valid()) {
    error = {"pipeFailed", "CreateNamedPipe failed with error " + std::to_string(GetLastError())};
    return false;
  }
  return true;
}

bool Session::Write(const void* data, DWORD size) {
  OVERLAPPED overlapped{};
  overlapped.hEvent = writeEvent_.get();
  ResetEvent(writeEvent_.get());
  DWORD written = 0;
  if (!WriteFile(pipe_.get(), data, size, &written, &overlapped)) {
    if (GetLastError() != ERROR_IO_PENDING) return false;
    if (WaitForSingleObject(writeEvent_.get(), 2000) != WAIT_OBJECT_0) {
      CancelIoEx(pipe_.get(), &overlapped);
      GetOverlappedResult(pipe_.get(), &overlapped, &written, TRUE);
      return false;
    }
    if (!GetOverlappedResult(pipe_.get(), &overlapped, &written, FALSE)) return false;
  }
  return written == size;
}

bool Session::BeginRead() {
  ZeroMemory(&readOverlapped_, sizeof(readOverlapped_));
  readOverlapped_.hEvent = readEvent_.get();
  ResetEvent(readEvent_.get());
  if (!ReadFile(pipe_.get(), buffer_, sizeof(buffer_), nullptr, &readOverlapped_) &&
      GetLastError() != ERROR_IO_PENDING) {
    return false;
  }
  readPending_ = true;
  return true;
}

int Session::ReadMessage(DWORD timeoutMs) {
  if (!readPending_ && !BeginRead()) return -1;
  DWORD wait = WaitForSingleObject(readEvent_.get(), timeoutMs);
  if (wait == WAIT_TIMEOUT) return 0;
  if (wait != WAIT_OBJECT_0) return -1;
  readPending_ = false;
  if (!GetOverlappedResult(pipe_.get(), &readOverlapped_, &bufferBytes_, FALSE)) return -1;
  return proto::ValidateMessage(buffer_, bufferBytes_);
}

void Session::HandleIncoming(int type) {
  if (type == static_cast<int>(proto::MessageType::Status)) {
    Json status;
    {
      std::lock_guard<std::mutex> lock(statusMutex_);
      memcpy(&lastStatus_, buffer_, sizeof(lastStatus_));
      hasStatus_ = true;
      updatedAt_ = NowUnixMs();
      status = StatusToJsonLocked();
    }
    SendEvent("sessionStatus", status);
  } else if (type == static_cast<int>(proto::MessageType::Log)) {
    proto::LogMessage log;
    memcpy(&log, buffer_, sizeof(log));
    log.text[sizeof(log.text) - 1] = '\0';
    SendEvent("log", Json{{"level", LogLevelName(log.level)},
                          {"source", "hook"},
                          {"pid", pid_},
                          {"message", std::string(log.text)}});
  }
}

bool Session::SendConfigure(uint32_t features, uint32_t slot) {
  auto message = proto::MakeMessage<proto::ConfigureMessage>(proto::MessageType::Configure);
  message.features = features;
  message.xinputSlot = slot;
  message.gameWindow = reinterpret_cast<uint64_t>(window_);
  return Write(&message, sizeof(message));
}

bool Session::Handshake(const StartRequest& request, HelperError& error) {
  window_ = request.window;

  // Listen first, inject second: the DLL connects as soon as it starts.
  OVERLAPPED connectOverlapped{};
  UniqueHandle connectEvent(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  connectOverlapped.hEvent = connectEvent.get();
  bool connected = ConnectNamedPipe(pipe_.get(), &connectOverlapped) != FALSE;
  DWORD connectError = GetLastError();
  if (!connected && connectError == ERROR_PIPE_CONNECTED) connected = true;
  if (!connected && connectError != ERROR_IO_PENDING) {
    error = {"pipeFailed", "ConnectNamedPipe failed with error " + std::to_string(connectError)};
    return false;
  }

  if (!InjectAndAttach(process_.get(), SessionManager::Instance().hookDllPath(), error)) {
    CancelIoEx(pipe_.get(), &connectOverlapped);
    DWORD ignored = 0;
    GetOverlappedResult(pipe_.get(), &connectOverlapped, &ignored, TRUE);
    return false;
  }

  if (!connected) {
    HANDLE waits[] = {connectEvent.get(), process_.get()};
    DWORD wait = WaitForMultipleObjects(2, waits, FALSE, kConnectTimeoutMs);
    if (wait != WAIT_OBJECT_0) {
      CancelIoEx(pipe_.get(), &connectOverlapped);
      DWORD ignored = 0;
      GetOverlappedResult(pipe_.get(), &connectOverlapped, &ignored, TRUE);
      error = wait == WAIT_OBJECT_0 + 1
                  ? HelperError{"processExited", "The game exited during start-up."}
                  : HelperError{"hookTimeout", "InputSplit was loaded but did not respond."};
      return false;
    }
  }

  // HELLO
  int type = ReadMessage(kHandshakeTimeoutMs);
  if (type != static_cast<int>(proto::MessageType::Hello)) {
    error = {"hookTimeout", "No valid hello from the hook (got " + std::to_string(type) + ")."};
    return false;
  }
  proto::HelloMessage hello;
  memcpy(&hello, buffer_, sizeof(hello));
  if (hello.dllBuildId != INPUTSPLIT_BUILD_ID) {
    error = {"hookOutdated",
             "The game still has an older InputSplit version loaded. Restart the game."};
    return false;
  }
  architectureBits_ = hello.architectureBits;
  {
    std::lock_guard<std::mutex> lock(statusMutex_);
    lastStatus_.detectedApis = hello.detectedApis;
  }

  // CONFIGURE -> STATUS (log lines may arrive first)
  if (!SendConfigure(request.features, request.xinputSlot)) {
    error = {"pipeFailed", "Could not send the configuration to the hook."};
    return false;
  }
  const ULONGLONG deadline = GetTickCount64() + kHandshakeTimeoutMs;
  while (GetTickCount64() < deadline) {
    type = ReadMessage(static_cast<DWORD>(deadline - GetTickCount64()));
    if (type < 0) {
      error = {"hookDisconnected", "The hook disconnected during start-up."};
      return false;
    }
    if (type == 0) continue;
    HandleIncoming(type);
    if (type == static_cast<int>(proto::MessageType::Status)) return true;
  }
  error = {"hookTimeout", "The hook did not confirm the configuration."};
  return false;
}

void Session::StartThread() {
  auto self = shared_from_this();
  thread_ = std::thread([self] { self->Run(); });
}

void Session::Run() {
  std::string endReason = "hookDisconnected";
  std::string endMessage;
  bool running = true;
  while (running) {
    if (!readPending_ && !BeginRead()) break;
    HANDLE waits[] = {readEvent_.get(), process_.get(), commandEvent_.get()};
    DWORD wait = WaitForMultipleObjects(3, waits, FALSE, INFINITE);

    if (wait == WAIT_OBJECT_0) {
      readPending_ = false;
      if (!GetOverlappedResult(pipe_.get(), &readOverlapped_, &bufferBytes_, FALSE)) break;
      HandleIncoming(proto::ValidateMessage(buffer_, bufferBytes_));
    } else if (wait == WAIT_OBJECT_0 + 1) {
      endReason = "processExited";
      running = false;
    } else if (wait == WAIT_OBJECT_0 + 2) {
      std::string stopReason;
      Configure configure{};
      bool reconfigure = false;
      {
        std::lock_guard<std::mutex> lock(commandMutex_);
        stopReason = stopReason_;
        reconfigure = hasPendingConfigure_;
        configure = pendingConfigure_;
        hasPendingConfigure_ = false;
      }
      if (!stopReason.empty()) {
        // Ask the DLL to go to pass-through and wait briefly for its confirmation. Even if
        // it does not answer, closing the pipe below triggers its fail-safe.
        auto disable = proto::MakeMessage<proto::DisableMessage>(proto::MessageType::Disable);
        if (Write(&disable, sizeof(disable))) {
          const ULONGLONG deadline = GetTickCount64() + kStopConfirmTimeoutMs;
          while (GetTickCount64() < deadline) {
            int type = ReadMessage(static_cast<DWORD>(deadline - GetTickCount64()));
            if (type < 0) break;
            if (type == 0) continue;
            HandleIncoming(type);
            // A periodic STATUS may already be in flight; wait for the one confirming
            // that nothing is requested or active any more.
            if (type == static_cast<int>(proto::MessageType::Status) && IsPassThrough()) break;
          }
        }
        endReason = stopReason;
        running = false;
      } else if (reconfigure && !SendConfigure(configure.features, configure.slot)) {
        endMessage = "Could not send the new configuration.";
        running = false;
      }
    } else {
      endMessage = "Wait failed with error " + std::to_string(GetLastError());
      running = false;
    }
  }
  Finish(endReason, endMessage);
}

void Session::Finish(const std::string& reason, const std::string& message) {
  if (readPending_) {
    CancelIoEx(pipe_.get(), &readOverlapped_);
    DWORD ignored = 0;
    GetOverlappedResult(pipe_.get(), &readOverlapped_, &ignored, TRUE);
    readPending_ = false;
  }
  pipe_.reset();  // the DLL sees the broken pipe and disables everything
  Json data{{"sessionId", id_}, {"pid", pid_}, {"reason", reason}};
  if (!message.empty()) data["message"] = message;
  SendEvent("sessionEnded", data);
  SetEvent(endedEvent_.get());
  SessionManager::Instance().OnSessionEnded(id_);
}

Json Session::StatusToJsonLocked() const {
  const proto::StatusMessage& s = lastStatus_;
  return Json{
      {"sessionId", id_},
      {"pid", pid_},
      {"architectureBits", architectureBits_},
      {"requested", FeaturesToJson(s.requested)},
      {"active", FeaturesToJson(s.active)},
      {"failed", FeaturesToJson(s.failed)},
      {"detectedApis", ApisToJson(s.detectedApis)},
      {"gameWindow", s.gameWindow},
      {"subclassedWindows", s.subclassedWindows},
      {"xinputSlot", s.xinputSlot == proto::kNoSlot ? Json(nullptr) : Json(s.xinputSlot)},
      {"counters",
       {{"xinputReads", s.xinputReads},
        {"blockedKeyboard", s.blockedKeyboard},
        {"blockedMouse", s.blockedMouse},
        {"swallowedFocusEvents", s.swallowedFocusEvents},
        {"blockedCursorCalls", s.blockedCursorCalls},
        {"xinputEnableBlocked", s.xinputEnableBlocked}}},
      {"updatedAt", updatedAt_},
  };
}

// ---------------------------------------------------------------------------------------

SessionManager& SessionManager::Instance() {
  static SessionManager instance;
  return instance;
}

Json SessionManager::Start(const StartRequest& request, HelperError& error) {
  // The UI ran checkTarget already; this repeat is the authoritative one.
  TargetVerdict verdict = CheckTarget(request.pid, hookDllPath_, request.allowAntiCheat);
  if (!verdict.blockers.empty()) {
    error = {verdict.blockers.front().code, verdict.blockers.front().message};
    return nullptr;
  }

  std::shared_ptr<Session> session;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& [id, existing] : sessions_) {
      if (existing->pid() == request.pid) {
        error = {"alreadyIsolated", "This game is already isolated."};
        return nullptr;
      }
    }
    session = std::make_shared<Session>(nextId_++, request.pid);
    sessions_[session->id()] = session;
  }

  if (!session->Open(error) || !session->Handshake(request, error)) {
    std::lock_guard<std::mutex> lock(mutex_);
    sessions_.erase(session->id());
    return nullptr;
  }
  session->StartThread();
  return session->StatusJson();
}

bool SessionManager::Stop(int sessionId, const std::string& reason) {
  std::shared_ptr<Session> session;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = sessions_.find(sessionId);
    if (it == sessions_.end()) return false;
    session = it->second;
  }
  session->RequestStop(reason);
  session->WaitEnded(3000);
  return true;
}

bool SessionManager::Reconfigure(int sessionId, uint32_t features, uint32_t xinputSlot) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = sessions_.find(sessionId);
  if (it == sessions_.end()) return false;
  it->second->RequestReconfigure(features, xinputSlot);
  return true;
}

int SessionManager::StopAll(const std::string& reason, DWORD waitMs) {
  std::vector<std::shared_ptr<Session>> all;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& [id, session] : sessions_) all.push_back(session);
  }
  for (const auto& session : all) session->RequestStop(reason);
  const ULONGLONG deadline = GetTickCount64() + waitMs;
  for (const auto& session : all) {
    ULONGLONG now = GetTickCount64();
    session->WaitEnded(now < deadline ? static_cast<DWORD>(deadline - now) : 0);
  }
  return static_cast<int>(all.size());
}

void SessionManager::OnSessionEnded(int sessionId) {
  std::lock_guard<std::mutex> lock(mutex_);
  sessions_.erase(sessionId);
}

}  // namespace inputsplit::helper
