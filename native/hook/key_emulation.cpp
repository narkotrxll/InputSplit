// key_emulation.cpp — the controller presses keys inside the game, for games that only
// understand a keyboard (InputSplit's own).
//
// A thread reads the game's controller about 125 times per second and, for every bound
// button, trigger or left-stick direction that changes, posts WM_KEYDOWN / WM_KEYUP to the
// game window. The messages carry kSyntheticKeyBit, so the keyboard block lets them through
// while the shared keyboard stays hidden (input_block.cpp, activation_shield.cpp). Key-state
// queries (GetAsyncKeyState & co.) report these keys as pressed. Nothing is sent to other
// programs: Windows' own input queue (SendInput) is never used.
//
// Not covered: games that read the keyboard through Raw Input or DirectInput.
#include "modules.h"

#include <atomic>

#include "hook_state.h"
#include "log.h"

namespace inputsplit::hook {
namespace {

std::atomic<uint8_t> g_keyMap[proto::kKeyBindings];
std::atomic<bool> g_enabled{false};
std::atomic<bool> g_down[256];  // keys this module holds down in the game
bool g_threadStarted = false;   // pipe thread only

constexpr int kTriggerOn = 64, kTriggerOff = 40;      // 0..255
constexpr int kStickOn = 16000, kStickOff = 11000;    // thumb units

bool IsExtendedKey(UINT vk) {
  switch (vk) {
    case VK_LEFT: case VK_RIGHT: case VK_UP: case VK_DOWN:
    case VK_INSERT: case VK_DELETE: case VK_HOME: case VK_END: case VK_PRIOR: case VK_NEXT:
    case VK_RCONTROL: case VK_RMENU: case VK_DIVIDE: case VK_NUMLOCK:
      return true;
    default:
      return false;
  }
}

void PostKey(UINT vk, bool down) {
  g_down[vk].store(down, std::memory_order_relaxed);
  HWND game = GameWindow();
  if (game == nullptr) return;
  LPARAM lParam = 1 | (static_cast<LPARAM>(MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) & 0xFF) << 16) |
                  static_cast<LPARAM>(proto::kSyntheticKeyBit);
  if (IsExtendedKey(vk)) lParam |= 1 << 24;
  if (!down) lParam |= (static_cast<LPARAM>(1) << 30) | (static_cast<LPARAM>(1) << 31);
  PostMessageW(game, down ? WM_KEYDOWN : WM_KEYUP, vk, lParam);
}

void ReleaseAll() {
  for (UINT vk = 1; vk < 256; ++vk) {
    if (g_down[vk].load(std::memory_order_relaxed)) PostKey(vk, false);
  }
}

// Which bindings are held, with a gap between "press" and "release" so a stick resting
// near the threshold does not flicker the key.
void ReadBindings(const XINPUT_GAMEPAD& pad, bool held[proto::kKeyBindings]) {
  for (int bit = 0; bit < 16; ++bit) held[bit] = (pad.wButtons & (1u << bit)) != 0;
  auto over = [&](int index, int value, int on, int off) {
    held[index] = value > (held[index] ? off : on);
  };
  over(proto::kKeyLeftTrigger, pad.bLeftTrigger, kTriggerOn, kTriggerOff);
  over(proto::kKeyRightTrigger, pad.bRightTrigger, kTriggerOn, kTriggerOff);
  over(proto::kKeyStickUp, pad.sThumbLY, kStickOn, kStickOff);
  over(proto::kKeyStickDown, -static_cast<int>(pad.sThumbLY), kStickOn, kStickOff);
  over(proto::kKeyStickLeft, -static_cast<int>(pad.sThumbLX), kStickOn, kStickOff);
  over(proto::kKeyStickRight, pad.sThumbLX, kStickOn, kStickOff);
}

DWORD WINAPI Worker(LPVOID) {
  bool held[proto::kKeyBindings] = {};
  for (;;) {
    if (!g_enabled.load(std::memory_order_acquire) || g_active.load() == 0) {
      for (bool& h : held) h = false;
      ReleaseAll();
      Sleep(100);
      continue;
    }
    XINPUT_STATE state{};
    if (ReadPlayerOnePad(&state)) {
      ReadBindings(state.Gamepad, held);
    } else {
      for (bool& h : held) h = false;
    }
    bool want[256] = {};
    for (int i = 0; i < proto::kKeyBindings; ++i) {
      const uint8_t vk = g_keyMap[i].load(std::memory_order_relaxed);
      if (vk != 0 && held[i]) want[vk] = true;
    }
    for (UINT vk = 1; vk < 256; ++vk) {
      if (want[vk] != g_down[vk].load(std::memory_order_relaxed)) PostKey(vk, want[vk]);
    }
    Sleep(8);
  }
}

}  // namespace

void SetKeyMap(const uint8_t (&keyMap)[24]) {
  bool any = false;
  for (int i = 0; i < proto::kKeyBindings; ++i) {
    g_keyMap[i].store(keyMap[i], std::memory_order_relaxed);
    any = any || keyMap[i] != 0;
  }
  g_enabled.store(any, std::memory_order_release);
  // Key-state queries must report these keys even when the keyboard block is off.
  if (any && !InstallInputBlockHooks()) Log(LogLevel::Warn, "Key-state hooks not available");
  if (any && !g_threadStarted) {
    HANDLE thread = CreateThread(nullptr, 0, &Worker, nullptr, 0, nullptr);
    if (thread == nullptr) {
      Log(LogLevel::Error, "Could not start the controller-to-keys thread");
      return;
    }
    CloseHandle(thread);
    g_threadStarted = true;
  }
  if (any) Log(LogLevel::Info, "Controller presses keys in the game");
}

void ClearKeyMap() { g_enabled.store(false, std::memory_order_release); }

bool SyntheticKeyDown(int vk) {
  if (vk <= 0 || vk > 255) return false;
  if (g_down[vk].load(std::memory_order_relaxed)) return true;
  // Games often ask for the left/right variant of a modifier the binding names generically.
  switch (vk) {
    case VK_LSHIFT: case VK_RSHIFT: return g_down[VK_SHIFT].load(std::memory_order_relaxed);
    case VK_LCONTROL: case VK_RCONTROL: return g_down[VK_CONTROL].load(std::memory_order_relaxed);
    case VK_LMENU: case VK_RMENU: return g_down[VK_MENU].load(std::memory_order_relaxed);
    default: return false;
  }
}

}  // namespace inputsplit::hook
