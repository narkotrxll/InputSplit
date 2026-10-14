// focus_spoof.cpp — make "am I the focused window?" checks inside the game say yes.
//
// Engines often ask Windows directly instead of tracking WM_ACTIVATE*, e.g. "is the
// foreground window one of mine?". While isolation is active we answer with the game
// window whenever the real answer would point outside the game.
//
// Origin: NoFocusLoss (GetForegroundWindow detour) and ProtoInput FocusHook.cpp
// (GetForegroundWindow / GetActiveWindow / GetFocus detours). See THIRD_PARTY_NOTICES.md.
// Difference: we keep the real answer when it already points to one of the game's own
// windows, so in-game dialogs keep working.
#include "modules.h"

#include "hook_state.h"
#include "minhook_util.h"

namespace inputsplit::hook {
namespace {

using GetWindowFn = HWND(WINAPI*)();

GetWindowFn g_realGetForegroundWindow = nullptr;
GetWindowFn g_realGetActiveWindow = nullptr;
GetWindowFn g_realGetFocus = nullptr;

HWND SpoofIfForeign(HWND real) {
  if (!IsActive(proto::kFeatureFocusSpoof)) return real;
  if (IsOwnWindow(real)) return real;
  HWND game = GameWindow();
  return game != nullptr ? game : real;
}

HWND WINAPI DetourGetForegroundWindow() {
  return SpoofIfForeign(g_realGetForegroundWindow());
}

// GetActiveWindow/GetFocus are per-thread and return NULL when the thread's window is not
// active, which is exactly the case we need to hide.
HWND WINAPI DetourGetActiveWindow() {
  return SpoofIfForeign(g_realGetActiveWindow());
}

HWND WINAPI DetourGetFocus() {
  return SpoofIfForeign(g_realGetFocus());
}

}  // namespace

bool InstallFocusSpoofHooks() {
  static bool installed = false;
  if (installed) return true;
  bool ok = CreateApiHook(L"user32.dll", "GetForegroundWindow", &DetourGetForegroundWindow,
                          &g_realGetForegroundWindow) &&
            CreateApiHook(L"user32.dll", "GetActiveWindow", &DetourGetActiveWindow,
                          &g_realGetActiveWindow) &&
            CreateApiHook(L"user32.dll", "GetFocus", &DetourGetFocus, &g_realGetFocus) &&
            ApplyQueuedHooks();
  installed = ok;
  return ok;
}

}  // namespace inputsplit::hook
