#include "minhook_util.h"

namespace inputsplit::hook {

bool EnsureMinHook() {
  static bool initialised = false;  // only touched from the pipe worker thread
  if (initialised) return true;
  MH_STATUS status = MH_Initialize();
  if (status != MH_OK && status != MH_ERROR_ALREADY_INITIALIZED) {
    Log(LogLevel::Error, "MH_Initialize failed: %s", MH_StatusToString(status));
    return false;
  }
  initialised = true;
  return true;
}

bool ApplyQueuedHooks() {
  MH_STATUS status = MH_ApplyQueued();
  if (status != MH_OK) {
    Log(LogLevel::Error, "MH_ApplyQueued failed: %s", MH_StatusToString(status));
    return false;
  }
  return true;
}

}  // namespace inputsplit::hook
