// xinput_bridge.cpp — keep the game reading its controller while it is in the background,
// and bind the game's "player 1" to the controller chosen in InputSplit.
//
// What it does:
//  * Pre-loads every XInput DLL variant and hooks each one. Games may load XInput later;
//    they then receive the module we already hooked. (Technique from ProtoInput
//    XinputHook.cpp, where a comment notes Terraria loads XInput late.)
//  * Hooks the hidden XInputGetStateEx (ordinal 100) used by some games to read the
//    Guide button (also from ProtoInput).
//  * Slot lock: the game's user index 0 is redirected to the chosen physical slot and
//    indexes 1..3 report "not connected", so the game sees exactly one controller.
//    (User-index remapping from ProtoInput.)
//  * Background: XInputEnable(FALSE) — which games call when they lose focus to make
//    XInput return neutral data — is ignored while isolation is active. (InputSplit's own;
//    ProtoInput does not hook XInputEnable.)
//  * Counts XInputGetState calls, so the UI can prove the game is really reading the pad.
//
// All variants talk to the same driver, so every detour forwards to the trampolines of a
// single "canonical" module (xinput1_4 on Windows 10/11).
#include "modules.h"

#include <xinput.h>

#include "hook_state.h"
#include "minhook_util.h"

namespace inputsplit::hook {
namespace {

using GetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_STATE*);
using SetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_VIBRATION*);
using GetCapabilitiesFn = DWORD(WINAPI*)(DWORD, DWORD, XINPUT_CAPABILITIES*);
using EnableFn = void(WINAPI*)(BOOL);
using GetBatteryFn = DWORD(WINAPI*)(DWORD, BYTE, XINPUT_BATTERY_INFORMATION*);
using GetKeystrokeFn = DWORD(WINAPI*)(DWORD, DWORD, XINPUT_KEYSTROKE*);

constexpr DWORD kUserIndexAny = 0x000000FF;  // XUSER_INDEX_ANY
const LPCSTR kGetStateExOrdinal = MAKEINTRESOURCEA(100);  // export by ordinal

// Trampolines of the canonical module. Detours of every variant forward here.
struct Canonical {
  GetStateFn getState = nullptr;
  GetStateFn getStateEx = nullptr;
  SetStateFn setState = nullptr;
  GetCapabilitiesFn getCapabilities = nullptr;
  EnableFn enable = nullptr;
  GetBatteryFn getBattery = nullptr;
  GetKeystrokeFn getKeystroke = nullptr;
} g_real;

std::atomic<bool> g_gameWantsEnabled{true};  // last value the game passed to XInputEnable

// ---- Pad bridge: PlayStation / Nintendo controllers the helper shows as XInput slots ----
std::atomic<proto::PadBridgeMemory*> g_bridge{nullptr};
std::atomic<ULONGLONG> g_bridgeNextTry{0};

proto::PadBridgeMemory* Bridge() {
  proto::PadBridgeMemory* bridge = g_bridge.load(std::memory_order_acquire);
  if (bridge != nullptr) return bridge;
  const ULONGLONG now = GetTickCount64();
  if (now < g_bridgeNextTry.load(std::memory_order_relaxed)) return nullptr;
  // Not there yet: the helper may turn the bridge on later.
  g_bridgeNextTry.store(now + 2000, std::memory_order_relaxed);
  HANDLE section =
      OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, proto::kPadBridgeName);
  if (section == nullptr) return nullptr;
  void* view = MapViewOfFile(section, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0,
                             sizeof(proto::PadBridgeMemory));
  CloseHandle(section);  // the view keeps the section alive
  if (view == nullptr) return nullptr;
  auto* memory = static_cast<proto::PadBridgeMemory*>(view);
  if (memory->magic != proto::kPadBridgeMagic || memory->version != proto::kProtocolVersion) {
    UnmapViewOfFile(view);
    return nullptr;
  }
  proto::PadBridgeMemory* expected = nullptr;
  if (!g_bridge.compare_exchange_strong(expected, memory)) {
    UnmapViewOfFile(view);
    return expected;
  }
  Log(LogLevel::Info, "Pad bridge connected");
  return memory;
}

// Only while InputSplit isolates this game; a stopped session leaves the game as it was.
proto::BridgedPad* BridgedSlot(DWORD physical) {
  if (physical > 3 || g_active.load(std::memory_order_relaxed) == 0) return nullptr;
  proto::PadBridgeMemory* bridge = Bridge();
  if (bridge == nullptr || bridge->slots[physical].connected == 0) return nullptr;
  return &bridge->slots[physical];
}

bool ReadBridged(DWORD physical, XINPUT_STATE* state) {
  proto::BridgedPad* pad = BridgedSlot(physical);
  if (pad == nullptr || state == nullptr) return false;
  for (int attempt = 0; attempt < 4; ++attempt) {
    const uint32_t before = *reinterpret_cast<volatile uint32_t*>(&pad->sequence);
    if (before & 1) continue;  // the helper is writing
    MemoryBarrier();
    XINPUT_STATE copy{};
    copy.dwPacketNumber = pad->packet;
    copy.Gamepad.wButtons = pad->buttons;
    copy.Gamepad.bLeftTrigger = pad->leftTrigger;
    copy.Gamepad.bRightTrigger = pad->rightTrigger;
    copy.Gamepad.sThumbLX = pad->thumbLX;
    copy.Gamepad.sThumbLY = pad->thumbLY;
    copy.Gamepad.sThumbRX = pad->thumbRX;
    copy.Gamepad.sThumbRY = pad->thumbRY;
    MemoryBarrier();
    if (*reinterpret_cast<volatile uint32_t*>(&pad->sequence) == before) {
      *state = copy;
      return true;
    }
  }
  return false;
}

// Maps the game's user index to a physical slot. Returns false if the game should see
// "no controller" for this index.
bool MapUserIndex(DWORD userIndex, DWORD& physical) {
  if (!IsActive(proto::kFeatureXInputSlotLock)) {
    if (!PlayerOrderSlot(userIndex, physical)) physical = userIndex;
    return true;
  }
  DWORD slot = g_xinputSlot.load(std::memory_order_relaxed);
  if (slot > 3) return false;
  if (userIndex == 0 || userIndex == kUserIndexAny) {
    physical = slot;
    return true;
  }
  return false;
}

DWORD WINAPI DetourGetState(DWORD userIndex, XINPUT_STATE* state) {
  Count(g_counters.xinputReads);
  DWORD physical = 0;
  if (!MapUserIndex(userIndex, physical)) return ERROR_DEVICE_NOT_CONNECTED;
  DWORD result = g_real.getState(physical, state);
  if (result != ERROR_SUCCESS && ReadBridged(physical, state)) {
    result = ERROR_SUCCESS;
    if (state != nullptr) state->Gamepad.wButtons &= ~0x0400;  // Guide: GetStateEx only
  }
  if (result == ERROR_SUCCESS) {
    ApplyTuning(state);
    OnControllerRead(physical, state);
  }
  return result;
}

DWORD WINAPI DetourGetStateEx(DWORD userIndex, XINPUT_STATE* state) {
  Count(g_counters.xinputReads);
  DWORD physical = 0;
  if (!MapUserIndex(userIndex, physical)) return ERROR_DEVICE_NOT_CONNECTED;
  GetStateFn fn = g_real.getStateEx != nullptr ? g_real.getStateEx : g_real.getState;
  DWORD result = fn(physical, state);
  if (result != ERROR_SUCCESS && ReadBridged(physical, state)) result = ERROR_SUCCESS;
  if (result == ERROR_SUCCESS) {
    ApplyTuning(state);
    OnControllerRead(physical, state);
  }
  return result;
}

DWORD WINAPI DetourSetState(DWORD userIndex, XINPUT_VIBRATION* vibration) {
  DWORD physical = 0;
  if (!MapUserIndex(userIndex, physical)) return ERROR_DEVICE_NOT_CONNECTED;
  DWORD result = g_real.setState(physical, vibration);
  if (result != ERROR_SUCCESS && vibration != nullptr) {
    if (proto::BridgedPad* pad = BridgedSlot(physical)) {
      pad->rumbleLeft = vibration->wLeftMotorSpeed;
      pad->rumbleRight = vibration->wRightMotorSpeed;
      MemoryBarrier();
      InterlockedIncrement(reinterpret_cast<volatile LONG*>(&pad->rumbleSequence));
      result = ERROR_SUCCESS;
    }
  }
  return result;
}

DWORD WINAPI DetourGetCapabilities(DWORD userIndex, DWORD flags, XINPUT_CAPABILITIES* caps) {
  DWORD physical = 0;
  if (!MapUserIndex(userIndex, physical)) return ERROR_DEVICE_NOT_CONNECTED;
  DWORD result = g_real.getCapabilities(physical, flags, caps);
  if (result != ERROR_SUCCESS && caps != nullptr && BridgedSlot(physical) != nullptr) {
    // A wired Xbox gamepad with every button, both sticks and both motors.
    *caps = XINPUT_CAPABILITIES{};
    caps->Type = XINPUT_DEVTYPE_GAMEPAD;
    caps->SubType = XINPUT_DEVSUBTYPE_GAMEPAD;
    caps->Gamepad.wButtons = 0xF3FF;
    caps->Gamepad.bLeftTrigger = 0xFF;
    caps->Gamepad.bRightTrigger = 0xFF;
    caps->Gamepad.sThumbLX = static_cast<SHORT>(0xFFC0);
    caps->Gamepad.sThumbLY = static_cast<SHORT>(0xFFC0);
    caps->Gamepad.sThumbRX = static_cast<SHORT>(0xFFC0);
    caps->Gamepad.sThumbRY = static_cast<SHORT>(0xFFC0);
    caps->Vibration.wLeftMotorSpeed = 0xFFFF;
    caps->Vibration.wRightMotorSpeed = 0xFFFF;
    result = ERROR_SUCCESS;
  }
  return result;
}

DWORD WINAPI DetourGetBattery(DWORD userIndex, BYTE devType, XINPUT_BATTERY_INFORMATION* info) {
  DWORD physical = 0;
  if (!MapUserIndex(userIndex, physical)) return ERROR_DEVICE_NOT_CONNECTED;
  DWORD result = g_real.getBattery != nullptr ? g_real.getBattery(physical, devType, info)
                                              : ERROR_DEVICE_NOT_CONNECTED;
  if (result != ERROR_SUCCESS && info != nullptr && BridgedSlot(physical) != nullptr) {
    info->BatteryType = BATTERY_TYPE_WIRED;  // the helper does not read PlayStation batteries
    info->BatteryLevel = BATTERY_LEVEL_FULL;
    result = ERROR_SUCCESS;
  }
  return result;
}

DWORD WINAPI DetourGetKeystroke(DWORD userIndex, DWORD reserved, XINPUT_KEYSTROKE* keystroke) {
  DWORD physical = 0;
  if (!MapUserIndex(userIndex, physical)) return ERROR_DEVICE_NOT_CONNECTED;
  if (g_real.getKeystroke == nullptr) return ERROR_EMPTY;
  DWORD result = g_real.getKeystroke(physical, reserved, keystroke);
  // Report the index the game asked for, not the physical slot.
  if (result == ERROR_SUCCESS && keystroke != nullptr && userIndex != kUserIndexAny &&
      physical != userIndex) {
    keystroke->UserIndex = static_cast<BYTE>(userIndex);
  }
  return result;
}

void WINAPI DetourEnable(BOOL enable) {
  g_gameWantsEnabled.store(enable != FALSE, std::memory_order_relaxed);
  if (!enable && IsActive(proto::kFeatureXInputBackground)) {
    Count(g_counters.xinputEnableBlocked);
    return;  // keep XInput delivering real data while the game is in the background
  }
  if (g_real.enable != nullptr) g_real.enable(enable);
}

// Hooks one XInput module. Trampolines are stored only for the canonical module.
bool HookModule(const wchar_t* name, bool canonical) {
  HMODULE module = GetModuleHandleW(name);
  if (module == nullptr) return false;

  Canonical discarded;  // trampolines of non-canonical variants are not needed
  Canonical& out = canonical ? g_real : discarded;

  bool ok = CreateHookAt(GetProcAddress(module, "XInputGetState"), &DetourGetState,
                         &out.getState, "XInputGetState");
  ok = CreateHookAt(GetProcAddress(module, "XInputSetState"), &DetourSetState, &out.setState,
                    "XInputSetState") && ok;
  ok = CreateHookAt(GetProcAddress(module, "XInputGetCapabilities"), &DetourGetCapabilities,
                    &out.getCapabilities, "XInputGetCapabilities") && ok;

  // Optional exports: not every variant has them, so missing ones are not failures.
  if (FARPROC p = GetProcAddress(module, "XInputEnable")) {
    CreateHookAt(p, &DetourEnable, &out.enable, "XInputEnable");
  }
  if (FARPROC p = GetProcAddress(module, "XInputGetBatteryInformation")) {
    CreateHookAt(p, &DetourGetBattery, &out.getBattery, "XInputGetBatteryInformation");
  }
  if (FARPROC p = GetProcAddress(module, "XInputGetKeystroke")) {
    CreateHookAt(p, &DetourGetKeystroke, &out.getKeystroke, "XInputGetKeystroke");
  }
  if (FARPROC p = GetProcAddress(module, kGetStateExOrdinal)) {
    CreateHookAt(p, &DetourGetStateEx, &out.getStateEx, "XInputGetStateEx(#100)");
  }
  Log(LogLevel::Info, "Hooked %ls%s", name, canonical ? " (canonical)" : "");
  return ok;
}

}  // namespace

bool InstallXInputHooks() {
  static bool installed = false;
  if (installed) return true;

  // Preferred first: the first variant that loads becomes canonical.
  const wchar_t* variants[] = {L"xinput1_4.dll", L"xinput1_3.dll", L"xinput9_1_0.dll",
                               L"xinput1_2.dll", L"xinput1_1.dll"};
  bool haveCanonical = false;
  for (const wchar_t* name : variants) {
    // LoadLibrary keeps the module loaded for the life of the process, so the game's own
    // later LoadLibrary receives this already-hooked copy.
    if (LoadLibraryW(name) == nullptr) continue;
    bool ok = HookModule(name, !haveCanonical);
    if (!haveCanonical) {
      if (!ok || g_real.getState == nullptr || g_real.setState == nullptr ||
          g_real.getCapabilities == nullptr) {
        Log(LogLevel::Error, "Could not hook the canonical XInput module %ls", name);
        return false;
      }
      haveCanonical = true;
    }
  }
  if (!haveCanonical) {
    Log(LogLevel::Error, "No XInput DLL could be loaded");
    return false;
  }
  installed = ApplyQueuedHooks();
  return installed;
}

bool ReadPlayerOnePad(XINPUT_STATE* state) {
  if (g_real.getState == nullptr && !InstallXInputHooks()) return false;
  DWORD physical = 0;
  if (!MapUserIndex(0, physical)) return false;
  if (g_real.getState(physical, state) != ERROR_SUCCESS && !ReadBridged(physical, state)) {
    return false;
  }
  ApplyTuning(state);
  return true;
}

void OnXInputBackgroundEnabled() {
  // The game may already have disabled XInput before isolation started.
  if (g_real.enable != nullptr) g_real.enable(TRUE);
}

void OnXInputBackgroundDisabled() {
  // Give the game back the state it asked for.
  if (g_real.enable != nullptr && !g_gameWantsEnabled.load(std::memory_order_relaxed)) {
    g_real.enable(FALSE);
  }
}

}  // namespace inputsplit::hook
