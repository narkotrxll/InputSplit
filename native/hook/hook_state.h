// hook_state.h — global state shared by all hook modules inside the game process.
//
// Every detour reads `g_active` (one atomic load) to decide whether to act or to forward
// the call untouched. Turning isolation off is therefore just clearing bits: no code is
// patched or unpatched while game threads might be running through it.
#pragma once

#include <windows.h>

#include <atomic>
#include <cstdint>

#include "../common/hook_protocol.h"

namespace inputsplit::hook {

struct Counters {
  std::atomic<uint64_t> xinputReads{0};
  std::atomic<uint64_t> blockedKeyboard{0};
  std::atomic<uint64_t> blockedMouse{0};
  std::atomic<uint64_t> swallowedFocusEvents{0};
  std::atomic<uint64_t> blockedCursorCalls{0};
  std::atomic<uint64_t> xinputEnableBlocked{0};
};

extern HMODULE g_module;                  // this DLL
extern std::atomic<uint32_t> g_requested;  // features asked for by the helper
extern std::atomic<uint32_t> g_active;     // features confirmed working (what detours obey)
extern std::atomic<uint32_t> g_failed;     // features that could not be applied
extern std::atomic<HWND> g_gameWindow;     // the window we pretend is always focused
extern std::atomic<uint32_t> g_xinputSlot;  // physical XInput slot for the game's pad #1
extern Counters g_counters;

inline bool IsActive(uint32_t feature) {
  return (g_active.load(std::memory_order_relaxed) & feature) != 0;
}

inline void Count(std::atomic<uint64_t>& counter) {
  counter.fetch_add(1, std::memory_order_relaxed);
}

// The game window, or nullptr when it is gone.
inline HWND GameWindow() {
  HWND hwnd = g_gameWindow.load(std::memory_order_relaxed);
  return (hwnd != nullptr && IsWindow(hwnd)) ? hwnd : nullptr;
}

// True if `hwnd` belongs to this (the game's) process.
inline bool IsOwnWindow(HWND hwnd) {
  if (hwnd == nullptr) return false;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return pid == GetCurrentProcessId();
}

}  // namespace inputsplit::hook
