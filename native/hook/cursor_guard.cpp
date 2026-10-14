// cursor_guard.cpp — stop the game from moving or trapping the shared mouse cursor.
//
// A game that believes it is focused re-centres the cursor every frame (SetCursorPos) or
// confines it to its window (ClipCursor). On a shared desktop that would hijack the other
// user's mouse, so both calls become no-ops while the guard is active.
//
// Origin: NoFocusLoss (SetCursorPos detour) and ProtoInput ClipCursorHook.cpp /
// SetCursorPosHook.cpp. See THIRD_PARTY_NOTICES.md.
#include "modules.h"

#include "hook_state.h"
#include "minhook_util.h"

namespace inputsplit::hook {
namespace {

using SetCursorPosFn = BOOL(WINAPI*)(int, int);
using ClipCursorFn = BOOL(WINAPI*)(const RECT*);

SetCursorPosFn g_realSetCursorPos = nullptr;
ClipCursorFn g_realClipCursor = nullptr;

BOOL WINAPI DetourSetCursorPos(int x, int y) {
  if (IsActive(proto::kFeatureCursorGuard)) {
    Count(g_counters.blockedCursorCalls);
    return TRUE;  // pretend it worked
  }
  return g_realSetCursorPos(x, y);
}

BOOL WINAPI DetourClipCursor(const RECT* rect) {
  if (IsActive(proto::kFeatureCursorGuard)) {
    if (rect != nullptr) Count(g_counters.blockedCursorCalls);
    return TRUE;
  }
  return g_realClipCursor(rect);
}

}  // namespace

bool InstallCursorGuardHooks() {
  static bool installed = false;
  if (installed) return true;
  bool ok = CreateApiHook(L"user32.dll", "SetCursorPos", &DetourSetCursorPos, &g_realSetCursorPos) &&
            CreateApiHook(L"user32.dll", "ClipCursor", &DetourClipCursor, &g_realClipCursor) &&
            ApplyQueuedHooks();
  installed = ok;
  return ok;
}

void ReleaseGameCursorClip() {
  // If the game confined the cursor *before* isolation started, it would never get the
  // deactivation message that makes it release the clip (we swallow it). Release it once,
  // but only when the current clip lies inside the game window, so we never undo a clip
  // set by somebody else.
  HWND game = GameWindow();
  if (game == nullptr || g_realClipCursor == nullptr) return;
  RECT clip{};
  RECT window{};
  if (!GetClipCursor(&clip) || !GetWindowRect(game, &window)) return;
  RECT virtualScreen{GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
                     GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN),
                     GetSystemMetrics(SM_YVIRTUALSCREEN) + GetSystemMetrics(SM_CYVIRTUALSCREEN)};
  bool isClipped = !EqualRect(&clip, &virtualScreen);
  bool insideGame = clip.left >= window.left && clip.top >= window.top &&
                    clip.right <= window.right && clip.bottom <= window.bottom;
  if (isClipped && insideGame) {
    g_realClipCursor(nullptr);
    Log(LogLevel::Info, "Released a cursor clip left behind by the game");
  }
}

}  // namespace inputsplit::hook
