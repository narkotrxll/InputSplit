#include "controllers.h"

#include <windows.h>
#include <xinput.h>
#include <setupapi.h>
// Older MinGW headers declare the HID functions without C linkage.
extern "C" {
#include <hidsdi.h>
}

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <vector>

#include "pad_bridge.h"

namespace inputsplit::helper {
namespace {

using GetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_STATE*);
using GetCapabilitiesFn = DWORD(WINAPI*)(DWORD, DWORD, XINPUT_CAPABILITIES*);
using GetBatteryFn = DWORD(WINAPI*)(DWORD, BYTE, XINPUT_BATTERY_INFORMATION*);
using SetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_VIBRATION*);

// XInputGetCapabilitiesEx (xinput1_4 ordinal 108): the documented capabilities plus the
// controller's USB ids. Undocumented, but stable since Windows 8 (SDL relies on it too).
struct XInputCapabilitiesEx {
  XINPUT_CAPABILITIES capabilities;
  WORD vendorId;
  WORD productId;
  WORD versionNumber;
  WORD unknown1;
  DWORD unknown2;
};
using GetCapabilitiesExFn = DWORD(WINAPI*)(DWORD, DWORD, DWORD, XInputCapabilitiesEx*);

struct XInputApi {
  GetStateFn getState = nullptr;
  GetStateFn getStateEx = nullptr;  // ordinal 100: also reports the Guide button
  GetCapabilitiesFn getCapabilities = nullptr;
  GetCapabilitiesExFn getCapabilitiesEx = nullptr;  // ordinal 108, xinput1_4 only
  GetBatteryFn getBattery = nullptr;
  SetStateFn setState = nullptr;
} g_api;

constexpr WORD kGuideButton = 0x0400;  // only reported by XInputGetStateEx

struct SlotInfo {
  bool connected = false;
  BYTE subType = 0;
  WORD flags = 0;
  WORD vendorId = 0;  // 0 = not reported
  WORD productId = 0;
  BYTE batteryType = BATTERY_TYPE_DISCONNECTED;
  BYTE batteryLevel = BATTERY_LEVEL_EMPTY;
  bool hasBattery = false;

  bool operator==(const SlotInfo& o) const {
    return connected == o.connected && subType == o.subType && flags == o.flags &&
           vendorId == o.vendorId && productId == o.productId &&
           batteryType == o.batteryType && batteryLevel == o.batteryLevel &&
           hasBattery == o.hasBattery;
  }
  bool operator!=(const SlotInfo& o) const { return !(*this == o); }
};

std::mutex g_mutex;
std::condition_variable g_wake;
SlotInfo g_slots[XUSER_MAX_COUNT];
struct HidPad {
  WORD vendorId;
  WORD productId;
};
std::vector<HidPad> g_hidPads;
int g_testSlot = -1;
bool g_running = false;
std::thread g_thread;

// Controller shortcuts, held on any controller:
//   LB + RB + View (Back) for 2 s: start or stop isolation ("gamepadHotkey")
//   LB + RB + Menu (Start) for 1 s: show or hide the FPS and latency overlay ("overlayHotkey")
struct Shortcut {
  WORD mask;
  std::chrono::milliseconds hold;
  const char* event;
};
constexpr Shortcut kShortcuts[] = {
    {XINPUT_GAMEPAD_LEFT_SHOULDER | XINPUT_GAMEPAD_RIGHT_SHOULDER | XINPUT_GAMEPAD_BACK,
     std::chrono::milliseconds(2000), "gamepadHotkey"},
    {XINPUT_GAMEPAD_LEFT_SHOULDER | XINPUT_GAMEPAD_RIGHT_SHOULDER | XINPUT_GAMEPAD_START,
     std::chrono::milliseconds(1000), "overlayHotkey"},
};
constexpr size_t kShortcutCount = sizeof(kShortcuts) / sizeof(kShortcuts[0]);
constexpr auto kHotkeyPollMs = std::chrono::milliseconds(50);
bool g_shortcutEnabled[kShortcutCount] = {};

bool AnyShortcutEnabled() {
  for (bool enabled : g_shortcutEnabled) {
    if (enabled) return true;
  }
  return false;
}

struct HotkeyTracker {
  bool holding = false;
  bool fired = false;  // once per hold: release the buttons to arm again
  std::chrono::steady_clock::time_point since{};
};

std::atomic<unsigned> g_rumbleGeneration{0};

const char* SubTypeName(BYTE subType) {
  switch (subType) {
    case XINPUT_DEVSUBTYPE_GAMEPAD: return "gamepad";
    case XINPUT_DEVSUBTYPE_WHEEL: return "wheel";
    case XINPUT_DEVSUBTYPE_ARCADE_STICK: return "arcadeStick";
    case 0x04 /* XINPUT_DEVSUBTYPE_FLIGHT_STICK (misspelled in MinGW headers) */:
      return "flightStick";
    case XINPUT_DEVSUBTYPE_DANCE_PAD: return "dancePad";
    case XINPUT_DEVSUBTYPE_GUITAR:
    case XINPUT_DEVSUBTYPE_GUITAR_ALTERNATE:
    case XINPUT_DEVSUBTYPE_GUITAR_BASS: return "guitar";
    case XINPUT_DEVSUBTYPE_DRUM_KIT: return "drumKit";
    case XINPUT_DEVSUBTYPE_ARCADE_PAD: return "arcadePad";
    default: return "unknown";
  }
}

const char* BatteryTypeName(BYTE type) {
  switch (type) {
    case BATTERY_TYPE_WIRED: return "wired";
    case BATTERY_TYPE_ALKALINE: return "alkaline";
    case BATTERY_TYPE_NIMH: return "nimh";
    case BATTERY_TYPE_DISCONNECTED: return "disconnected";
    default: return "unknown";
  }
}

const char* BatteryLevelName(BYTE level) {
  switch (level) {
    case BATTERY_LEVEL_EMPTY: return "empty";
    case BATTERY_LEVEL_LOW: return "low";
    case BATTERY_LEVEL_MEDIUM: return "medium";
    default: return "full";
  }
}

SlotInfo ReadSlot(DWORD slot, bool withBattery, const SlotInfo& previous) {
  SlotInfo info;
  XINPUT_STATE state{};
  info.connected = g_api.getState(slot, &state) == ERROR_SUCCESS;
  if (!info.connected) return info;
  XINPUT_CAPABILITIES caps{};
  if (g_api.getCapabilities(slot, XINPUT_FLAG_GAMEPAD, &caps) == ERROR_SUCCESS) {
    info.subType = caps.SubType;
    info.flags = caps.Flags;
  }
  XInputCapabilitiesEx capsEx{};
  if (g_api.getCapabilitiesEx != nullptr &&
      g_api.getCapabilitiesEx(1, slot, XINPUT_FLAG_GAMEPAD, &capsEx) == ERROR_SUCCESS) {
    info.vendorId = capsEx.vendorId;
    info.productId = capsEx.productId;
  }
  if (withBattery && g_api.getBattery != nullptr) {
    XINPUT_BATTERY_INFORMATION battery{};
    if (g_api.getBattery(slot, BATTERY_DEVTYPE_GAMEPAD, &battery) == ERROR_SUCCESS) {
      info.hasBattery = true;
      info.batteryType = battery.BatteryType;
      info.batteryLevel = battery.BatteryLevel;
    }
  } else if (previous.connected) {
    info.hasBattery = previous.hasBattery;
    info.batteryType = previous.batteryType;
    info.batteryLevel = previous.batteryLevel;
  }
  return info;
}

// HID game controllers that are not XInput devices (an XInput device has "IG_" in its
// path). PlayStation and Nintendo pads appear here; when Steam Input or DS4Windows drives
// them, XInput only sees a virtual Xbox controller, and this list says what is behind it.
std::vector<HidPad> ListHidGamepads() {
  std::vector<HidPad> pads;
  GUID hidGuid;
  HidD_GetHidGuid(&hidGuid);
  HDEVINFO set = SetupDiGetClassDevsW(&hidGuid, nullptr, nullptr,
                                      DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (set == INVALID_HANDLE_VALUE) return pads;
  SP_DEVICE_INTERFACE_DATA iface{};
  iface.cbSize = sizeof(iface);
  for (DWORD i = 0; SetupDiEnumDeviceInterfaces(set, nullptr, &hidGuid, i, &iface); ++i) {
    DWORD size = 0;
    SetupDiGetDeviceInterfaceDetailW(set, &iface, nullptr, 0, &size, nullptr);
    if (size == 0) continue;
    std::vector<BYTE> buffer(size);
    auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(buffer.data());
    detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(set, &iface, detail, size, nullptr, nullptr)) continue;
    std::wstring path = detail->DevicePath;
    if (path.find(L"IG_") != std::wstring::npos || path.find(L"ig_") != std::wstring::npos)
      continue;
    // No access rights: enough for attributes, and works while another app owns the pad.
    HANDLE device = CreateFileW(path.c_str(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                OPEN_EXISTING, 0, nullptr);
    if (device == INVALID_HANDLE_VALUE) continue;
    HIDD_ATTRIBUTES attributes{};
    attributes.Size = sizeof(attributes);
    PHIDP_PREPARSED_DATA preparsed = nullptr;
    if (HidD_GetAttributes(device, &attributes) && HidD_GetPreparsedData(device, &preparsed)) {
      HIDP_CAPS caps{};
      bool gamepad = HidP_GetCaps(preparsed, &caps) == HIDP_STATUS_SUCCESS &&
                     caps.UsagePage == 0x01 && (caps.Usage == 0x04 || caps.Usage == 0x05);
      if (gamepad) pads.push_back({attributes.VendorID, attributes.ProductID});
      HidD_FreePreparsedData(preparsed);
    }
    CloseHandle(device);
  }
  SetupDiDestroyDeviceInfoList(set);
  return pads;
}

Json SlotToJson(int slot, const SlotInfo& info) {
  Json battery = nullptr;
  if (info.connected && info.hasBattery) {
    battery = Json{{"type", BatteryTypeName(info.batteryType)},
                   {"level", BatteryLevelName(info.batteryLevel)}};
  }
  return Json{
      {"slot", slot},
      {"connected", info.connected},
      {"kind", info.connected ? SubTypeName(info.subType) : "unknown"},
      // XINPUT_CAPS_WIRELESS (0x0002) is reported by xinput1_4 only.
      {"wireless", info.connected ? Json((info.flags & 0x0002) != 0) : Json(nullptr)},
      {"battery", battery},
      {"vendorId", info.connected && info.vendorId != 0 ? Json(info.vendorId) : Json(nullptr)},
      {"productId", info.connected && info.vendorId != 0 ? Json(info.productId) : Json(nullptr)},
  };
}

Json SnapshotLocked() {
  Json list = Json::array();
  for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) list.push_back(SlotToJson(slot, g_slots[slot]));
  Json pads = Json::array();
  for (const HidPad& pad : g_hidPads) {
    pads.push_back(Json{{"vendorId", pad.vendorId}, {"productId", pad.productId}});
  }
  return Json{{"controllers", list},
              {"hidGamepads", pads},
              {"bridged", PadBridge::Instance().List()}};
}

void EmitTestState(int slot, DWORD& lastPacket, bool& wasConnected) {
  XINPUT_STATE state{};
  GetStateFn read = g_api.getStateEx != nullptr ? g_api.getStateEx : g_api.getState;
  bool connected = read(static_cast<DWORD>(slot), &state) == ERROR_SUCCESS ||
                   PadBridge::Instance().Read(slot, state);
  if (!connected) {
    if (wasConnected) SendEvent("controllerState", Json{{"slot", slot}, {"connected", false}});
    wasConnected = false;
    return;
  }
  if (wasConnected && state.dwPacketNumber == lastPacket) return;  // nothing changed
  wasConnected = true;
  lastPacket = state.dwPacketNumber;
  const XINPUT_GAMEPAD& pad = state.Gamepad;
  SendEvent("controllerState", Json{
                                   {"slot", slot},
                                   {"connected", true},
                                   {"packet", state.dwPacketNumber},
                                   {"buttons", pad.wButtons & ~kGuideButton},
                                   {"guide", (pad.wButtons & kGuideButton) != 0},
                                   {"leftTrigger", pad.bLeftTrigger},
                                   {"rightTrigger", pad.bRightTrigger},
                                   {"thumbLX", pad.sThumbLX},
                                   {"thumbLY", pad.sThumbLY},
                                   {"thumbRX", pad.sThumbRX},
                                   {"thumbRY", pad.sThumbRY},
                               });
}

// Reads the buttons of every connected slot and reports a completed hold. Runs on the
// monitor thread without the lock (XInputGetState may block briefly).
void PollHotkey(const bool connected[XUSER_MAX_COUNT], const bool enabled[kShortcutCount],
                HotkeyTracker trackers[XUSER_MAX_COUNT][kShortcutCount]) {
  const auto now = std::chrono::steady_clock::now();
  for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
    XINPUT_STATE state{};
    bool read = connected[slot]
                    ? g_api.getState(static_cast<DWORD>(slot), &state) == ERROR_SUCCESS
                    : PadBridge::Instance().Read(slot, state);
    for (size_t i = 0; i < kShortcutCount; ++i) {
      HotkeyTracker& tracker = trackers[slot][i];
      bool pressed = enabled[i] && read &&
                     (state.Gamepad.wButtons & kShortcuts[i].mask) == kShortcuts[i].mask;
      if (!pressed) {
        tracker = HotkeyTracker{};
        continue;
      }
      if (!tracker.holding) {
        tracker.holding = true;
        tracker.since = now;
      } else if (!tracker.fired && now - tracker.since >= kShortcuts[i].hold) {
        tracker.fired = true;
        SendEvent(kShortcuts[i].event, Json{{"slot", slot}});
      }
    }
  }
}

void Run() {
  using Clock = std::chrono::steady_clock;
  auto nextPresenceCheck = Clock::now();
  auto nextBatteryCheck = Clock::now();
  int streamedSlot = -1;
  DWORD lastPacket = 0;
  bool wasConnected = false;
  bool hidListed = false;
  HotkeyTracker trackers[XUSER_MAX_COUNT][kShortcutCount];

  std::unique_lock<std::mutex> lock(g_mutex);
  while (g_running) {
    const auto now = Clock::now();

    // Presence: once per second. Polling an empty slot is slow (it probes the driver),
    // so it never runs at test-stream frequency.
    if (now >= nextPresenceCheck) {
      bool withBattery = now >= nextBatteryCheck;
      bool changed = false;
      SlotInfo fresh[XUSER_MAX_COUNT];
      SlotInfo previous[XUSER_MAX_COUNT];
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) previous[slot] = g_slots[slot];
      lock.unlock();
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
        fresh[slot] = ReadSlot(static_cast<DWORD>(slot), withBattery, previous[slot]);
      }
      bool replugged = !hidListed;
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
        if (fresh[slot].connected != previous[slot].connected ||
            fresh[slot].vendorId != previous[slot].vendorId) {
          replugged = true;
        }
      }
      // HID enumeration is slower than XInput, so it runs only when a slot changes owner:
      // a translator creates its virtual slot when the physical pad connects.
      std::vector<HidPad> pads;
      if (replugged) pads = ListHidGamepads();
      lock.lock();
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
        if (fresh[slot] != g_slots[slot]) changed = true;
        g_slots[slot] = fresh[slot];
      }
      if (replugged) {
        hidListed = true;
        changed = true;
        g_hidPads = std::move(pads);
      }
      if (changed) SendEvent("controllersChanged", SnapshotLocked());
      nextPresenceCheck = now + std::chrono::seconds(1);
      if (withBattery) nextBatteryCheck = now + std::chrono::seconds(15);
    }

    // Test stream for the Controllers page: ~60 Hz, only while requested.
    if (g_testSlot != streamedSlot) {
      streamedSlot = g_testSlot;
      wasConnected = false;
    }
    if (streamedSlot >= 0) {
      int slot = streamedSlot;
      lock.unlock();
      EmitTestState(slot, lastPacket, wasConnected);
      lock.lock();
    }

    // Shortcut: only connected slots are read (an empty slot is slow to poll).
    if (AnyShortcutEnabled()) {
      bool connected[XUSER_MAX_COUNT];
      bool enabled[kShortcutCount];
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) connected[slot] = g_slots[slot].connected;
      for (size_t i = 0; i < kShortcutCount; ++i) enabled[i] = g_shortcutEnabled[i];
      lock.unlock();
      PollHotkey(connected, enabled, trackers);
      lock.lock();
    } else {
      for (auto& slotTrackers : trackers) {
        for (HotkeyTracker& tracker : slotTrackers) tracker = HotkeyTracker{};
      }
    }

    if (streamedSlot >= 0) {
      g_wake.wait_for(lock, std::chrono::milliseconds(16));
    } else if (AnyShortcutEnabled()) {
      g_wake.wait_until(lock, (std::min)(nextPresenceCheck, Clock::now() + kHotkeyPollMs));
    } else {
      g_wake.wait_until(lock, nextPresenceCheck);
    }
  }
}

}  // namespace

ControllerMonitor& ControllerMonitor::Instance() {
  static ControllerMonitor instance;
  return instance;
}

bool ControllerMonitor::Start() {
  HMODULE module = LoadLibraryW(L"xinput1_4.dll");
  if (module == nullptr) module = LoadLibraryW(L"xinput9_1_0.dll");
  if (module == nullptr) return false;
  g_api.getState = reinterpret_cast<GetStateFn>(GetProcAddress(module, "XInputGetState"));
  g_api.getStateEx = reinterpret_cast<GetStateFn>(GetProcAddress(module, MAKEINTRESOURCEA(100)));
  g_api.getCapabilities =
      reinterpret_cast<GetCapabilitiesFn>(GetProcAddress(module, "XInputGetCapabilities"));
  g_api.getCapabilitiesEx =
      reinterpret_cast<GetCapabilitiesExFn>(GetProcAddress(module, MAKEINTRESOURCEA(108)));
  g_api.getBattery =
      reinterpret_cast<GetBatteryFn>(GetProcAddress(module, "XInputGetBatteryInformation"));
  g_api.setState = reinterpret_cast<SetStateFn>(GetProcAddress(module, "XInputSetState"));
  if (g_api.getState == nullptr || g_api.getCapabilities == nullptr) return false;

  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_running) return true;
  g_running = true;
  g_thread = std::thread(Run);
  return true;
}

void ControllerMonitor::Stop() {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_running) return;
    g_running = false;
  }
  g_wake.notify_all();
  if (g_thread.joinable()) g_thread.join();
}

Json ControllerMonitor::List() {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (!g_running) return Json{{"controllers", Json::array()}};
  return SnapshotLocked();
}

void ControllerMonitor::StartTest(int slot) {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_testSlot = (slot >= 0 && slot < XUSER_MAX_COUNT) ? slot : -1;
  }
  g_wake.notify_all();
}

bool ControllerMonitor::SlotConnected(int slot) {
  std::lock_guard<std::mutex> lock(g_mutex);
  return slot >= 0 && slot < XUSER_MAX_COUNT && g_slots[slot].connected;
}

void ControllerMonitor::MarkChanged() {
  std::lock_guard<std::mutex> lock(g_mutex);
  SendEvent("controllersChanged", SnapshotLocked());
}

void ControllerMonitor::StopTest() {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_testSlot = -1;
  }
  g_wake.notify_all();
}

void ControllerMonitor::SetHotkeyEnabled(bool enabled) {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_shortcutEnabled[0] = enabled;
  }
  g_wake.notify_all();
}

void ControllerMonitor::SetOverlayHotkeyEnabled(bool enabled) {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_shortcutEnabled[1] = enabled;
  }
  g_wake.notify_all();
}

bool ControllerMonitor::Rumble(int slot, const std::string& pattern) {
  if (g_api.setState == nullptr || slot < 0 || slot >= XUSER_MAX_COUNT) return false;
  int pulses = pattern == "on" ? 1 : pattern == "off" ? 2 : 3;
  auto pulseLength = std::chrono::milliseconds(pattern == "on" ? 350 : 140);
  // A newer pattern on any slot ends the previous one early.
  unsigned generation = ++g_rumbleGeneration;
  std::thread([slot, pulses, pulseLength, generation] {
    for (int i = 0; i < pulses && g_rumbleGeneration == generation; ++i) {
      XINPUT_VIBRATION on{40000, 40000};
      g_api.setState(static_cast<DWORD>(slot), &on);
      std::this_thread::sleep_for(pulseLength);
      XINPUT_VIBRATION off{0, 0};
      g_api.setState(static_cast<DWORD>(slot), &off);
      if (i + 1 < pulses) std::this_thread::sleep_for(std::chrono::milliseconds(120));
    }
  }).detach();
  return true;
}

}  // namespace inputsplit::helper
