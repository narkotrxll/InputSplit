// directinput_bridge.cpp — keep DirectInput controllers working while the game is in the
// background.
//
// DirectInput gives a device to a window either in the foreground only (DISCL_FOREGROUND, what
// most games ask for) or also in the background (DISCL_BACKGROUND). A foreground device is
// unacquired by Windows as soon as another window is activated, and reads then fail with
// DIERR_INPUTLOST / DIERR_NOTACQUIRED. While "controller in background" is active we:
//
//   * turn DISCL_FOREGROUND into DISCL_BACKGROUND in SetCooperativeLevel, for controllers only
//     (keyboard and mouse stay in the foreground, so the other user's typing never reaches
//     the game);
//   * switch devices that were set up before isolation started the next time the game calls
//     Acquire;
//   * re-acquire once when a read fails because the device was lost, so games that never
//     call Acquire again keep working;
//   * count controller reads (GetDeviceState / GetDeviceData), so the UI can prove that the
//     game really reads the controller.
//
// When isolation stops, the next Acquire puts the device back to the level the game asked for.
//
// DirectInput is COM: methods are reached through a table of function pointers (vtable)
// shared by all objects of one class. We patch the entries we need in those tables instead
// of hooking code, and keep the original pointer per table. The tables are found by creating
// a throw-away DirectInput object and a mouse device at start-up (all device classes share
// one implementation in dinput8.dll); devices created later are checked again in CreateDevice.
// Only DirectInput 8 (dinput8.dll) is covered; DirectInput 7 and older are rare in games
// that are still played with a controller.
#include "modules.h"

#ifndef DIRECTINPUT_VERSION
#define DIRECTINPUT_VERSION 0x0800
#endif
#include <dinput.h>

#include "hook_state.h"
#include "log.h"

namespace inputsplit::hook {
namespace {

// vtable indexes (dinput.h declaration order, IUnknown included).
constexpr int kCreateDevice = 3;         // IDirectInput8
constexpr int kGetCapabilities = 3;      // IDirectInputDevice8
constexpr int kAcquire = 7;
constexpr int kUnacquire = 8;
constexpr int kGetDeviceState = 9;
constexpr int kGetDeviceData = 10;
constexpr int kSetCooperativeLevel = 13;
constexpr int kSlots = 14;

// Defined here so that we do not need dxguid.lib.
const GUID kIidDirectInput8A = {0xBF798030, 0x483A, 0x4DA2, {0xAA, 0x99, 0x5D, 0x64, 0xED, 0x36, 0x97, 0x00}};
const GUID kIidDirectInput8W = {0xBF798031, 0x483A, 0x4DA2, {0xAA, 0x99, 0x5D, 0x64, 0xED, 0x36, 0x97, 0x00}};
const GUID kGuidSysMouse = {0x6F1D2B60, 0xD5A0, 0x11CF, {0xBF, 0xC7, 0x44, 0x45, 0x53, 0x54, 0x00, 0x00}};

using CreateDeviceFn = HRESULT(STDMETHODCALLTYPE*)(void*, REFGUID, void**, IUnknown*);
using GetCapabilitiesFn = HRESULT(STDMETHODCALLTYPE*)(void*, DIDEVCAPS*);
using SimpleFn = HRESULT(STDMETHODCALLTYPE*)(void*);
using GetDeviceStateFn = HRESULT(STDMETHODCALLTYPE*)(void*, DWORD, void*);
using GetDeviceDataFn = HRESULT(STDMETHODCALLTYPE*)(void*, DWORD, DIDEVICEOBJECTDATA*, DWORD*, DWORD);
using SetCooperativeLevelFn = HRESULT(STDMETHODCALLTYPE*)(void*, HWND, DWORD);
using ReleaseFn = ULONG(STDMETHODCALLTYPE*)(void*);
using DirectInput8CreateFn = HRESULT(WINAPI*)(HINSTANCE, DWORD, REFIID, void**, IUnknown*);

void** VtableOf(void* object) {
  return *static_cast<void***>(object);
}

// --- Patched vtables ----------------------------------------------------------------------

struct PatchedTable {
  void** vtable = nullptr;
  void* originals[kSlots] = {};
};

constexpr int kMaxTables = 16;
SRWLOCK g_tablesLock = SRWLOCK_INIT;
PatchedTable g_tables[kMaxTables];

// Original function of `slot` for the vtable of `object` (nullptr if we never patched it).
template <typename Fn>
Fn Original(void* object, int slot) {
  void** vtable = VtableOf(object);
  void* original = nullptr;
  AcquireSRWLockShared(&g_tablesLock);
  for (const PatchedTable& table : g_tables) {
    if (table.vtable == vtable) {
      original = table.originals[slot];
      break;
    }
  }
  ReleaseSRWLockShared(&g_tablesLock);
  // A table we did not patch still holds the real function.
  return reinterpret_cast<Fn>(original != nullptr ? original : vtable[slot]);
}

// Replaces vtable[slot] with `detour`, remembering the original. Idempotent.
bool PatchSlot(void** vtable, int slot, void* detour) {
  if (vtable[slot] == detour) return true;
  AcquireSRWLockExclusive(&g_tablesLock);
  PatchedTable* entry = nullptr;
  for (PatchedTable& table : g_tables) {
    if (table.vtable == vtable) entry = &table;
  }
  if (entry == nullptr) {
    for (PatchedTable& table : g_tables) {
      if (table.vtable == nullptr) {
        table.vtable = vtable;
        entry = &table;
        break;
      }
    }
  }
  bool ok = false;
  if (entry != nullptr && vtable[slot] != detour) {
    DWORD oldProtection = 0;
    if (VirtualProtect(&vtable[slot], sizeof(void*), PAGE_READWRITE, &oldProtection)) {
      entry->originals[slot] = vtable[slot];
      // One aligned pointer-sized store: threads calling through the table see either the
      // old or the new function, never a torn value.
      InterlockedExchangePointer(&vtable[slot], detour);
      VirtualProtect(&vtable[slot], sizeof(void*), oldProtection, &oldProtection);
      FlushInstructionCache(GetCurrentProcess(), &vtable[slot], sizeof(void*));
      ok = true;
    }
  } else if (entry != nullptr) {
    ok = true;
  }
  ReleaseSRWLockExclusive(&g_tablesLock);
  if (!ok) Log(LogLevel::Warn, "Could not patch a DirectInput table (slot %d)", slot);
  return ok;
}

// --- Devices --------------------------------------------------------------------------------

constexpr DWORD kUnknownLevel = 0;  // device set up before we were watching

struct Device {
  void* object = nullptr;
  void** vtable = nullptr;  // detects a new device that reuses a freed object's address
  bool controller = false;
  HWND window = nullptr;     // window the game passed to SetCooperativeLevel
  DWORD gameLevel = kUnknownLevel;  // DISCL_* flags the game asked for
  bool background = false;   // we switched the device to DISCL_BACKGROUND
};

constexpr int kMaxDevices = 32;
SRWLOCK g_devicesLock = SRWLOCK_INIT;
Device g_devices[kMaxDevices];
int g_nextVictim = 0;

bool IsControllerType(BYTE type) {
  switch (type) {
    case DI8DEVTYPE_JOYSTICK:
    case DI8DEVTYPE_GAMEPAD:
    case DI8DEVTYPE_DRIVING:
    case DI8DEVTYPE_FLIGHT:
    case DI8DEVTYPE_1STPERSON:
    case DI8DEVTYPE_SUPPLEMENTAL:
      return true;
    default:
      return false;
  }
}

bool QueryIsController(void* object) {
  DIDEVCAPS caps{};
  caps.dwSize = sizeof(caps);
  auto getCapabilities = reinterpret_cast<GetCapabilitiesFn>(VtableOf(object)[kGetCapabilities]);
  if (FAILED(getCapabilities(object, &caps))) return false;
  return IsControllerType(GET_DIDEVICE_TYPE(caps.dwDevType));
}

// Copy of the record for `object`, created on first sight.
Device Track(void* object) {
  void** vtable = VtableOf(object);
  AcquireSRWLockShared(&g_devicesLock);
  for (const Device& device : g_devices) {
    if (device.object == object && device.vtable == vtable) {
      Device copy = device;
      ReleaseSRWLockShared(&g_devicesLock);
      return copy;
    }
  }
  ReleaseSRWLockShared(&g_devicesLock);

  Device fresh;
  fresh.object = object;
  fresh.vtable = vtable;
  fresh.controller = QueryIsController(object);
  AcquireSRWLockExclusive(&g_devicesLock);
  Device* slot = nullptr;
  for (Device& device : g_devices) {
    if (device.object == object || device.object == nullptr) {
      slot = &device;
      break;
    }
  }
  if (slot == nullptr) {
    slot = &g_devices[g_nextVictim];
    g_nextVictim = (g_nextVictim + 1) % kMaxDevices;
  }
  *slot = fresh;
  ReleaseSRWLockExclusive(&g_devicesLock);
  return fresh;
}

void Store(const Device& updated) {
  AcquireSRWLockExclusive(&g_devicesLock);
  for (Device& device : g_devices) {
    if (device.object == updated.object) device = updated;
  }
  ReleaseSRWLockExclusive(&g_devicesLock);
}

bool BackgroundWanted() {
  return IsActive(proto::kFeatureXInputBackground);
}

// The level we apply for a controller while isolation is active.
DWORD BackgroundLevel(DWORD gameLevel) {
  DWORD exclusivity = (gameLevel & DISCL_EXCLUSIVE) ? DISCL_EXCLUSIVE : DISCL_NONEXCLUSIVE;
  return DISCL_BACKGROUND | exclusivity | (gameLevel & DISCL_NOWINKEY);
}

// --- Detours --------------------------------------------------------------------------------

HRESULT STDMETHODCALLTYPE DetourSetCooperativeLevel(void* self, HWND window, DWORD level) {
  auto real = Original<SetCooperativeLevelFn>(self, kSetCooperativeLevel);
  Device device = Track(self);
  device.window = window;
  device.gameLevel = level;
  device.background = false;
  HRESULT result;
  if (device.controller && BackgroundWanted() && (level & DISCL_FOREGROUND)) {
    result = real(self, window, BackgroundLevel(level));
    if (SUCCEEDED(result)) {
      device.background = true;
      Log(LogLevel::Info, "DirectInput controller kept active in background");
    } else {
      result = real(self, window, level);  // fall back to what the game asked for
    }
  } else {
    result = real(self, window, level);
  }
  Store(device);
  return result;
}

// Brings the device's cooperative level in line with the current isolation state.
void Reconcile(void* self, Device& device) {
  if (!device.controller) return;
  const bool foregroundGame =
      device.gameLevel == kUnknownLevel || (device.gameLevel & DISCL_FOREGROUND) != 0;
  const bool want = BackgroundWanted() && foregroundGame;
  if (want == device.background) return;
  if (!want && device.gameLevel == kUnknownLevel) return;  // nothing known to restore

  HWND window = device.window != nullptr ? device.window : GameWindow();
  if (window == nullptr) return;
  auto unacquire = reinterpret_cast<SimpleFn>(VtableOf(self)[kUnacquire]);
  auto setLevel = Original<SetCooperativeLevelFn>(self, kSetCooperativeLevel);
  unacquire(self);  // the level can only change while the device is not acquired
  if (SUCCEEDED(setLevel(self, window, want ? BackgroundLevel(device.gameLevel) : device.gameLevel))) {
    device.background = want;
    device.window = window;
    Store(device);
    Log(LogLevel::Info, want ? "DirectInput controller switched to background mode"
                             : "DirectInput controller restored to foreground mode");
  }
}

HRESULT STDMETHODCALLTYPE DetourAcquire(void* self) {
  Device device = Track(self);
  Reconcile(self, device);
  return Original<SimpleFn>(self, kAcquire)(self);
}

bool IsLost(HRESULT result) {
  return result == DIERR_INPUTLOST || result == DIERR_NOTACQUIRED;
}

HRESULT STDMETHODCALLTYPE DetourGetDeviceState(void* self, DWORD size, void* data) {
  auto real = Original<GetDeviceStateFn>(self, kGetDeviceState);
  HRESULT result = real(self, size, data);
  Device device = Track(self);
  if (!device.controller) return result;
  if (IsLost(result) && BackgroundWanted() && SUCCEEDED(DetourAcquire(self))) {
    result = real(self, size, data);
  }
  if (SUCCEEDED(result)) Count(g_counters.directInputReads);
  return result;
}

HRESULT STDMETHODCALLTYPE DetourGetDeviceData(void* self, DWORD objectSize,
                                              DIDEVICEOBJECTDATA* data, DWORD* count, DWORD flags) {
  auto real = Original<GetDeviceDataFn>(self, kGetDeviceData);
  const DWORD requested = count != nullptr ? *count : 0;
  HRESULT result = real(self, objectSize, data, count, flags);
  Device device = Track(self);
  if (!device.controller) return result;
  if (IsLost(result) && BackgroundWanted() && count != nullptr &&
      SUCCEEDED(DetourAcquire(self))) {
    *count = requested;
    result = real(self, objectSize, data, count, flags);
  }
  if (SUCCEEDED(result)) Count(g_counters.directInputReads);
  return result;
}

bool PatchDeviceTable(void** vtable) {
  bool ok = PatchSlot(vtable, kSetCooperativeLevel, reinterpret_cast<void*>(&DetourSetCooperativeLevel));
  ok = PatchSlot(vtable, kAcquire, reinterpret_cast<void*>(&DetourAcquire)) && ok;
  ok = PatchSlot(vtable, kGetDeviceState, reinterpret_cast<void*>(&DetourGetDeviceState)) && ok;
  ok = PatchSlot(vtable, kGetDeviceData, reinterpret_cast<void*>(&DetourGetDeviceData)) && ok;
  return ok;
}

HRESULT STDMETHODCALLTYPE DetourCreateDevice(void* self, REFGUID guid, void** device,
                                             IUnknown* outer) {
  HRESULT result = Original<CreateDeviceFn>(self, kCreateDevice)(self, guid, device, outer);
  // Normally the table is already patched; this catches a device class we have not seen.
  if (SUCCEEDED(result) && device != nullptr && *device != nullptr) {
    PatchDeviceTable(VtableOf(*device));
  }
  return result;
}

void Release(void* object) {
  reinterpret_cast<ReleaseFn>(VtableOf(object)[2])(object);
}

// Creates a DirectInput object of one character set (A or W) and patches its tables.
bool PrepareInterface(DirectInput8CreateFn create, const GUID& iid, const char* label) {
  void* directInput = nullptr;
  HRESULT result = create(reinterpret_cast<HINSTANCE>(g_module), DIRECTINPUT_VERSION, iid,
                          &directInput, nullptr);
  if (FAILED(result) || directInput == nullptr) {
    Log(LogLevel::Warn, "DirectInput8Create(%s) failed: 0x%08lX", label,
        static_cast<unsigned long>(result));
    return false;
  }
  // Use the original CreateDevice: our detour may already be in this table.
  auto createDevice = Original<CreateDeviceFn>(directInput, kCreateDevice);
  void* mouse = nullptr;
  bool ok = false;
  if (SUCCEEDED(createDevice(directInput, kGuidSysMouse, &mouse, nullptr)) && mouse != nullptr) {
    ok = PatchDeviceTable(VtableOf(mouse));
    Release(mouse);
  }
  ok = PatchSlot(VtableOf(directInput), kCreateDevice, reinterpret_cast<void*>(&DetourCreateDevice)) && ok;
  Release(directInput);
  return ok;
}

}  // namespace

bool InstallDirectInputHooks() {
  static bool installed = false;
  if (installed) return true;
  // Loading dinput8 here means a game that loads it later gets this same, prepared copy.
  HMODULE module = LoadLibraryW(L"dinput8.dll");
  if (module == nullptr) {
    Log(LogLevel::Warn, "dinput8.dll could not be loaded");
    return false;
  }
  auto create = reinterpret_cast<DirectInput8CreateFn>(GetProcAddress(module, "DirectInput8Create"));
  if (create == nullptr) return false;
  bool wide = PrepareInterface(create, kIidDirectInput8W, "W");
  bool ansi = PrepareInterface(create, kIidDirectInput8A, "A");
  installed = wide && ansi;
  if (installed) Log(LogLevel::Info, "DirectInput controllers prepared for background use");
  return installed;
}

}  // namespace inputsplit::hook
