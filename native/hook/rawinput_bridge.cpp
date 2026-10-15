// rawinput_bridge.cpp — keep HID controllers read through Raw Input working while the game
// is in the background.
//
// A game that reads a controller with Raw Input registers for it with RegisterRawInputDevices
// (usage page 0x01 "Generic Desktop", usage 0x04 joystick, 0x05 gamepad or 0x08 multi-axis).
// Windows only sends WM_INPUT for it while the game is the foreground window, unless the
// registration has RIDEV_INPUTSINK. While "controller in background" is active we:
//
//   * add RIDEV_INPUTSINK to the game's controller registrations (never to keyboard or mouse
//     ones, so the other user's typing still never reaches the game);
//   * re-register controllers the game had registered before isolation started, and restore
//     the game's own flags when isolation stops;
//   * hand WM_INPUT to the game as RIM_INPUT, not RIM_INPUTSINK, because some engines ignore
//     "background" raw input (done in activation_shield.cpp);
//   * count controller records the game reads (input_block.cpp), so the UI can prove that
//     the game really reads the controller.
//
// RegisterRawInputDevices changes the registration of the whole process. If Windows refuses a
// change made from our worker thread, it is repeated on the game's window thread through a
// private message that the shield's window procedure understands.
#include "modules.h"

#include "hook_state.h"
#include "log.h"
#include "minhook_util.h"

namespace inputsplit::hook {
namespace {

using RegisterRawInputDevicesFn = BOOL(WINAPI*)(PCRAWINPUTDEVICE, UINT, UINT);
RegisterRawInputDevicesFn g_realRegister = nullptr;

constexpr USHORT kGenericDesktop = 0x01;

// What the game itself asked for, per controller usage.
struct Registration {
  USHORT usage = 0;  // 0 = free entry
  DWORD flags = 0;
  HWND target = nullptr;
};

constexpr int kMaxRegistrations = 8;
SRWLOCK g_lock = SRWLOCK_INIT;
Registration g_registrations[kMaxRegistrations];
UINT g_syncMessage = 0;

void Remember(const RAWINPUTDEVICE& device) {
  AcquireSRWLockExclusive(&g_lock);
  Registration* slot = nullptr;
  for (Registration& entry : g_registrations) {
    if (entry.usage == device.usUsage) slot = &entry;
  }
  if (device.dwFlags & RIDEV_REMOVE) {
    if (slot != nullptr) *slot = Registration{};
  } else {
    if (slot == nullptr) {
      for (Registration& entry : g_registrations) {
        if (entry.usage == 0) {
          slot = &entry;
          break;
        }
      }
    }
    if (slot != nullptr) *slot = Registration{device.usUsage, device.dwFlags, device.hwndTarget};
  }
  ReleaseSRWLockExclusive(&g_lock);
}

bool IsControllerRegistration(const RAWINPUTDEVICE& device) {
  return (device.dwFlags & RIDEV_PAGEONLY) == 0 && IsGamepadUsage(device.usUsagePage, device.usUsage);
}

// The registration we want Windows to have for a controller the game registered.
RAWINPUTDEVICE Desired(const Registration& game) {
  RAWINPUTDEVICE device{kGenericDesktop, game.usage, game.flags, game.target};
  if (!IsActive(proto::kFeatureXInputBackground)) return device;
  HWND target = game.target != nullptr ? game.target : GameWindow();
  if (target == nullptr) return device;  // RIDEV_INPUTSINK needs a target window
  device.hwndTarget = target;
  device.dwFlags = (game.flags & ~RIDEV_EXINPUTSINK) | RIDEV_INPUTSINK;
  return device;
}

BOOL WINAPI DetourRegisterRawInputDevices(PCRAWINPUTDEVICE devices, UINT count, UINT size) {
  if (devices == nullptr || size != sizeof(RAWINPUTDEVICE) || count == 0 || count > 32) {
    return g_realRegister(devices, count, size);
  }
  RAWINPUTDEVICE adjusted[32];
  for (UINT i = 0; i < count; ++i) {
    adjusted[i] = devices[i];
    if (!IsControllerRegistration(devices[i])) continue;
    Remember(devices[i]);
    if ((devices[i].dwFlags & RIDEV_REMOVE) == 0) {
      adjusted[i] = Desired(Registration{devices[i].usUsage, devices[i].dwFlags, devices[i].hwndTarget});
    }
  }
  BOOL result = g_realRegister(adjusted, count, size);
  if (!result) result = g_realRegister(devices, count, size);  // never break the game's call
  return result;
}

// Records controller registrations that existed before our hook was installed.
void SeedFromWindows() {
  UINT count = 0;
  if (GetRegisteredRawInputDevices(nullptr, &count, sizeof(RAWINPUTDEVICE)) != 0 || count == 0) {
    return;
  }
  RAWINPUTDEVICE devices[32];
  if (count > 32) count = 32;
  UINT got = GetRegisteredRawInputDevices(devices, &count, sizeof(RAWINPUTDEVICE));
  if (got == static_cast<UINT>(-1)) return;
  for (UINT i = 0; i < got; ++i) {
    if (IsControllerRegistration(devices[i])) Remember(devices[i]);
  }
}

// Applies Desired() for every remembered controller. Returns false if Windows refused.
bool ApplyRegistrations() {
  Registration copies[kMaxRegistrations];
  AcquireSRWLockShared(&g_lock);
  for (int i = 0; i < kMaxRegistrations; ++i) copies[i] = g_registrations[i];
  ReleaseSRWLockShared(&g_lock);

  bool ok = true;
  for (const Registration& game : copies) {
    if (game.usage == 0) continue;
    RAWINPUTDEVICE device = Desired(game);
    if (!g_realRegister(&device, 1, sizeof(device))) ok = false;
  }
  return ok;
}

}  // namespace

bool IsGamepadUsage(USHORT usagePage, USHORT usage) {
  return usagePage == kGenericDesktop && (usage == 0x04 || usage == 0x05 || usage == 0x08);
}

bool InstallRawInputHooks() {
  static bool installed = false;
  if (installed) return true;
  g_syncMessage = RegisterWindowMessageW(L"InputSplit.RawInputSync");
  SeedFromWindows();
  installed = CreateApiHook(L"user32.dll", "RegisterRawInputDevices", &DetourRegisterRawInputDevices,
                            &g_realRegister) &&
              ApplyQueuedHooks();
  return installed;
}

void SyncRawInputRegistrations() {
  if (g_realRegister == nullptr) return;
  bool any = false;
  AcquireSRWLockShared(&g_lock);
  for (const Registration& entry : g_registrations) any = any || entry.usage != 0;
  ReleaseSRWLockShared(&g_lock);
  if (!any) return;

  if (ApplyRegistrations()) {
    Log(LogLevel::Info, IsActive(proto::kFeatureXInputBackground)
                            ? "Raw Input controllers kept active in background"
                            : "Raw Input controllers restored");
    return;
  }
  // Retry on the game's window thread (see the header comment).
  HWND game = GameWindow();
  DWORD_PTR result = 0;
  if (game == nullptr || g_syncMessage == 0 ||
      !SendMessageTimeoutW(game, g_syncMessage, 0, 0, SMTO_ABORTIFHUNG, 1000, &result) ||
      result != 1) {
    Log(LogLevel::Warn, "Could not update the game's Raw Input controller registration");
  }
}

bool HandleRawInputSyncMessage(UINT msg, LRESULT& result) {
  if (g_syncMessage == 0 || msg != g_syncMessage) return false;
  result = ApplyRegistrations() ? 1 : 0;
  return true;
}

}  // namespace inputsplit::hook
