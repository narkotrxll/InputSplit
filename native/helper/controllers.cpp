#include "controllers.h"

#include <windows.h>
#include <xinput.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>

namespace inputsplit::helper {
namespace {

using GetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_STATE*);
using GetCapabilitiesFn = DWORD(WINAPI*)(DWORD, DWORD, XINPUT_CAPABILITIES*);
using GetBatteryFn = DWORD(WINAPI*)(DWORD, BYTE, XINPUT_BATTERY_INFORMATION*);
using SetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_VIBRATION*);

struct XInputApi {
  GetStateFn getState = nullptr;
  GetStateFn getStateEx = nullptr;  // ordinal 100: also reports the Guide button
  GetCapabilitiesFn getCapabilities = nullptr;
  GetBatteryFn getBattery = nullptr;
  SetStateFn setState = nullptr;
} g_api;

constexpr WORD kGuideButton = 0x0400;  // only reported by XInputGetStateEx

struct SlotInfo {
  bool connected = false;
  BYTE subType = 0;
  WORD flags = 0;
  BYTE batteryType = BATTERY_TYPE_DISCONNECTED;
  BYTE batteryLevel = BATTERY_LEVEL_EMPTY;
  bool hasBattery = false;

  bool operator==(const SlotInfo& o) const {
    return connected == o.connected && subType == o.subType && flags == o.flags &&
           batteryType == o.batteryType && batteryLevel == o.batteryLevel &&
           hasBattery == o.hasBattery;
  }
  bool operator!=(const SlotInfo& o) const { return !(*this == o); }
};

std::mutex g_mutex;
std::condition_variable g_wake;
SlotInfo g_slots[XUSER_MAX_COUNT];
int g_testSlot = -1;
bool g_running = false;
std::thread g_thread;

// Controller shortcut: LB + RB + View (Back) held for kHotkeyHoldMs on any controller.
constexpr WORD kHotkeyMask =
    XINPUT_GAMEPAD_LEFT_SHOULDER | XINPUT_GAMEPAD_RIGHT_SHOULDER | XINPUT_GAMEPAD_BACK;
constexpr auto kHotkeyHoldMs = std::chrono::milliseconds(2000);
constexpr auto kHotkeyPollMs = std::chrono::milliseconds(50);
bool g_hotkeyEnabled = false;

struct HotkeyTracker {
  bool holding = false;
  bool fired = false;  // once per hold: release all three buttons to arm again
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
  };
}

Json SnapshotLocked() {
  Json list = Json::array();
  for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) list.push_back(SlotToJson(slot, g_slots[slot]));
  return Json{{"controllers", list}};
}

void EmitTestState(int slot, DWORD& lastPacket, bool& wasConnected) {
  XINPUT_STATE state{};
  GetStateFn read = g_api.getStateEx != nullptr ? g_api.getStateEx : g_api.getState;
  bool connected = read(static_cast<DWORD>(slot), &state) == ERROR_SUCCESS;
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
void PollHotkey(const bool connected[XUSER_MAX_COUNT], HotkeyTracker trackers[XUSER_MAX_COUNT]) {
  const auto now = std::chrono::steady_clock::now();
  for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
    HotkeyTracker& tracker = trackers[slot];
    XINPUT_STATE state{};
    bool pressed = connected[slot] &&
                   g_api.getState(static_cast<DWORD>(slot), &state) == ERROR_SUCCESS &&
                   (state.Gamepad.wButtons & kHotkeyMask) == kHotkeyMask;
    if (!pressed) {
      tracker = HotkeyTracker{};
      continue;
    }
    if (!tracker.holding) {
      tracker.holding = true;
      tracker.since = now;
    } else if (!tracker.fired && now - tracker.since >= kHotkeyHoldMs) {
      tracker.fired = true;
      SendEvent("gamepadHotkey", Json{{"slot", slot}});
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
  HotkeyTracker trackers[XUSER_MAX_COUNT];

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
      lock.lock();
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) {
        if (fresh[slot] != g_slots[slot]) changed = true;
        g_slots[slot] = fresh[slot];
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
    if (g_hotkeyEnabled) {
      bool connected[XUSER_MAX_COUNT];
      for (int slot = 0; slot < XUSER_MAX_COUNT; ++slot) connected[slot] = g_slots[slot].connected;
      lock.unlock();
      PollHotkey(connected, trackers);
      lock.lock();
    } else {
      for (HotkeyTracker& tracker : trackers) tracker = HotkeyTracker{};
    }

    if (streamedSlot >= 0) {
      g_wake.wait_for(lock, std::chrono::milliseconds(16));
    } else if (g_hotkeyEnabled) {
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
    g_hotkeyEnabled = enabled;
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
