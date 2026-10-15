// session.h — one isolated game = one Session.
//
// A session owns the named-pipe server the hook DLL connects to and a thread that:
//   * forwards the DLL's STATUS/LOG messages to the UI as events,
//   * notices when the game exits or the DLL disconnects,
//   * executes stop / reconfigure commands.
// Everything is keyed by session id so several games could be isolated at once later.
#pragma once

#include <windows.h>

#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#include "../common/hook_protocol.h"
#include "rpc.h"
#include "util.h"

namespace inputsplit::helper {

uint32_t FeaturesFromJson(const Json& features);
Json FeaturesToJson(uint32_t bits);
Json ApisToJson(uint32_t bits);

struct StartRequest {
  DWORD pid = 0;
  HWND window = nullptr;
  uint32_t features = 0;
  uint32_t xinputSlot = proto::kNoSlot;
  bool allowAntiCheat = false;  // see CheckTarget
};

class Session;

class SessionManager {
 public:
  static SessionManager& Instance();

  void SetHookDllPath(const std::wstring& path) { hookDllPath_ = path; }
  const std::wstring& hookDllPath() const { return hookDllPath_; }

  // Blocks until the hook confirmed its first status (or fails). Returns the status JSON.
  Json Start(const StartRequest& request, HelperError& error);
  bool Stop(int sessionId, const std::string& reason);
  bool Reconfigure(int sessionId, uint32_t features, uint32_t xinputSlot);
  // Plays the game's sound on the speakers of `displayId` until the session ends.
  // {"routed", "device", "reason"}; null if there is no such session.
  Json RouteAudio(int sessionId, const std::wstring& displayId);
  // Stops every session; waits up to `waitMs` for them to finish.
  int StopAll(const std::string& reason, DWORD waitMs);

  void OnSessionEnded(int sessionId);  // called by the session thread

 private:
  SessionManager() = default;
  std::mutex mutex_;
  std::map<int, std::shared_ptr<Session>> sessions_;
  int nextId_ = 1;
  std::wstring hookDllPath_;
};

}  // namespace inputsplit::helper
