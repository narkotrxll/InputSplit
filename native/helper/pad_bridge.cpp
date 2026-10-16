#include "pad_bridge.h"

#include <setupapi.h>
// Older MinGW headers declare the HID functions without C linkage.
extern "C" {
#include <hidsdi.h>
}

#include <algorithm>
#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../common/hook_protocol.h"
#include "controllers.h"
#include "util.h"

namespace inputsplit::helper {
namespace {

namespace proto = inputsplit::proto;

constexpr uint16_t kSony = 0x054c;
constexpr uint16_t kNintendo = 0x057e;

enum class Kind { DualShock4, DualSense, SwitchPro };

bool KindOf(uint16_t vendor, uint16_t product, Kind& kind) {
  if (vendor == kSony) {
    if (product == 0x05c4 || product == 0x09cc || product == 0x0ba0) {
      kind = Kind::DualShock4;
      return true;
    }
    if (product == 0x0ce6 || product == 0x0df2) {
      kind = Kind::DualSense;
      return true;
    }
  }
  if (vendor == kNintendo && product == 0x2009) {
    kind = Kind::SwitchPro;
    return true;
  }
  return false;
}

// HID axis 0..255 (128 = centre) to an XInput thumb value. HID Y grows downwards.
int16_t AxisX(uint8_t v) { return static_cast<int16_t>(v * 257 - 32768); }
int16_t AxisY(uint8_t v) { return static_cast<int16_t>(32767 - v * 257); }

uint16_t Hat(uint8_t hat) {
  static const uint16_t kHat[8] = {
      XINPUT_GAMEPAD_DPAD_UP,
      XINPUT_GAMEPAD_DPAD_UP | XINPUT_GAMEPAD_DPAD_RIGHT,
      XINPUT_GAMEPAD_DPAD_RIGHT,
      XINPUT_GAMEPAD_DPAD_DOWN | XINPUT_GAMEPAD_DPAD_RIGHT,
      XINPUT_GAMEPAD_DPAD_DOWN,
      XINPUT_GAMEPAD_DPAD_DOWN | XINPUT_GAMEPAD_DPAD_LEFT,
      XINPUT_GAMEPAD_DPAD_LEFT,
      XINPUT_GAMEPAD_DPAD_UP | XINPUT_GAMEPAD_DPAD_LEFT,
  };
  return hat < 8 ? kHat[hat] : 0;
}

constexpr uint16_t kGuide = 0x0400;

// DualShock 4 layout (also DualSense's short Bluetooth report): sticks at b..b+3, hat and
// face buttons at b+4, shoulders at b+5, PS at b+6, triggers at b+7 and b+8.
void ParsePlayStation(const uint8_t* r, int b, int face, int shoulders, int ps, int l2, int r2,
                      XINPUT_GAMEPAD& pad) {
  pad.sThumbLX = AxisX(r[b]);
  pad.sThumbLY = AxisY(r[b + 1]);
  pad.sThumbRX = AxisX(r[b + 2]);
  pad.sThumbRY = AxisY(r[b + 3]);
  const uint8_t f = r[face];
  uint16_t buttons = Hat(f & 0x0F);
  if (f & 0x10) buttons |= XINPUT_GAMEPAD_X;  // square
  if (f & 0x20) buttons |= XINPUT_GAMEPAD_A;  // cross
  if (f & 0x40) buttons |= XINPUT_GAMEPAD_B;  // circle
  if (f & 0x80) buttons |= XINPUT_GAMEPAD_Y;  // triangle
  const uint8_t s = r[shoulders];
  if (s & 0x01) buttons |= XINPUT_GAMEPAD_LEFT_SHOULDER;
  if (s & 0x02) buttons |= XINPUT_GAMEPAD_RIGHT_SHOULDER;
  if (s & 0x10) buttons |= XINPUT_GAMEPAD_BACK;   // share / create
  if (s & 0x20) buttons |= XINPUT_GAMEPAD_START;  // options
  if (s & 0x40) buttons |= XINPUT_GAMEPAD_LEFT_THUMB;
  if (s & 0x80) buttons |= XINPUT_GAMEPAD_RIGHT_THUMB;
  if (r[ps] & 0x01) buttons |= kGuide;
  pad.wButtons = buttons;
  pad.bLeftTrigger = r[l2];
  pad.bRightTrigger = r[r2];
}

int16_t Stick12(int v, bool invert) {
  int value = (v - 2048) * 16;
  if (invert) value = -value;
  return static_cast<int16_t>(std::clamp(value, -32768, 32767));
}

// Switch Pro: the full report 0x30 (after a driver such as Steam switched it on) or the
// simple HID report 0x3F (default over Bluetooth). Buttons follow their position, so the
// bottom button (B on a Switch controller) is A, like on an Xbox controller.
bool ParseSwitch(const uint8_t* r, DWORD n, XINPUT_GAMEPAD& pad) {
  uint16_t buttons = 0;
  if (r[0] == 0x30 && n >= 12) {
    const uint8_t right = r[3], mid = r[4], left = r[5];
    if (right & 0x01) buttons |= XINPUT_GAMEPAD_X;  // Y
    if (right & 0x02) buttons |= XINPUT_GAMEPAD_Y;  // X
    if (right & 0x04) buttons |= XINPUT_GAMEPAD_A;  // B
    if (right & 0x08) buttons |= XINPUT_GAMEPAD_B;  // A
    if (right & 0x40) buttons |= XINPUT_GAMEPAD_RIGHT_SHOULDER;
    if (mid & 0x01) buttons |= XINPUT_GAMEPAD_BACK;
    if (mid & 0x02) buttons |= XINPUT_GAMEPAD_START;
    if (mid & 0x04) buttons |= XINPUT_GAMEPAD_RIGHT_THUMB;
    if (mid & 0x08) buttons |= XINPUT_GAMEPAD_LEFT_THUMB;
    if (mid & 0x10) buttons |= kGuide;
    if (left & 0x01) buttons |= XINPUT_GAMEPAD_DPAD_DOWN;
    if (left & 0x02) buttons |= XINPUT_GAMEPAD_DPAD_UP;
    if (left & 0x04) buttons |= XINPUT_GAMEPAD_DPAD_RIGHT;
    if (left & 0x08) buttons |= XINPUT_GAMEPAD_DPAD_LEFT;
    if (left & 0x40) buttons |= XINPUT_GAMEPAD_LEFT_SHOULDER;
    pad.bRightTrigger = (right & 0x80) ? 255 : 0;  // ZR
    pad.bLeftTrigger = (left & 0x80) ? 255 : 0;    // ZL
    pad.sThumbLX = Stick12(r[6] | ((r[7] & 0x0F) << 8), false);
    pad.sThumbLY = Stick12((r[7] >> 4) | (r[8] << 4), false);
    pad.sThumbRX = Stick12(r[9] | ((r[10] & 0x0F) << 8), false);
    pad.sThumbRY = Stick12((r[10] >> 4) | (r[11] << 4), false);
  } else if (r[0] == 0x3F && n >= 12) {
    const uint8_t a = r[1], b = r[2];
    if (a & 0x01) buttons |= XINPUT_GAMEPAD_A;  // B
    if (a & 0x02) buttons |= XINPUT_GAMEPAD_B;  // A
    if (a & 0x04) buttons |= XINPUT_GAMEPAD_X;  // Y
    if (a & 0x08) buttons |= XINPUT_GAMEPAD_Y;  // X
    if (a & 0x10) buttons |= XINPUT_GAMEPAD_LEFT_SHOULDER;
    if (a & 0x20) buttons |= XINPUT_GAMEPAD_RIGHT_SHOULDER;
    pad.bLeftTrigger = (a & 0x40) ? 255 : 0;
    pad.bRightTrigger = (a & 0x80) ? 255 : 0;
    if (b & 0x01) buttons |= XINPUT_GAMEPAD_BACK;
    if (b & 0x02) buttons |= XINPUT_GAMEPAD_START;
    if (b & 0x04) buttons |= XINPUT_GAMEPAD_LEFT_THUMB;
    if (b & 0x08) buttons |= XINPUT_GAMEPAD_RIGHT_THUMB;
    if (b & 0x10) buttons |= kGuide;
    buttons |= Hat(r[3]);
    auto u16 = [&](int i) { return static_cast<int>(r[i] | (r[i + 1] << 8)); };
    pad.sThumbLX = static_cast<int16_t>(u16(4) - 32768);
    pad.sThumbLY = static_cast<int16_t>(32767 - u16(6));
    pad.sThumbRX = static_cast<int16_t>(u16(8) - 32768);
    pad.sThumbRY = static_cast<int16_t>(32767 - u16(10));
  } else {
    return false;
  }
  pad.wButtons = buttons;
  return true;
}

bool ParseReport(Kind kind, bool bluetooth, const uint8_t* r, DWORD n, XINPUT_GAMEPAD& pad) {
  if (n < 10) return false;
  switch (kind) {
    case Kind::DualShock4:
      if (r[0] == 0x01) ParsePlayStation(r, 1, 5, 6, 7, 8, 9, pad);
      else if (r[0] == 0x11 && n >= 12) ParsePlayStation(r, 3, 7, 8, 9, 10, 11, pad);
      else return false;
      return true;
    case Kind::DualSense:
      if (r[0] == 0x01 && !bluetooth && n >= 11) {
        ParsePlayStation(r, 1, 8, 9, 10, 5, 6, pad);
      } else if (r[0] == 0x01) {
        ParsePlayStation(r, 1, 5, 6, 7, 8, 9, pad);  // short Bluetooth report
      } else if (r[0] == 0x31 && n >= 12) {
        ParsePlayStation(r, 2, 9, 10, 11, 6, 7, pad);
      } else {
        return false;
      }
      return true;
    case Kind::SwitchPro:
      return ParseSwitch(r, n, pad);
  }
  return false;
}

struct Device {
  std::wstring path;
  Kind kind = Kind::DualShock4;
  bool bluetooth = false;
  uint16_t vendorId = 0;
  uint16_t productId = 0;
  int slot = -1;
  UniqueHandle handle;
  DWORD inputLength = 0;
  DWORD outputLength = 0;
  std::atomic<bool> stop{false};
  std::thread thread;
};

std::mutex g_mutex;
std::atomic<bool> g_enabled{false};
std::thread g_scanner;
std::vector<std::unique_ptr<Device>> g_devices;
UniqueHandle g_section;
proto::PadBridgeMemory* g_memory = nullptr;

bool EnsureMemory() {
  if (g_memory != nullptr) return true;
  HANDLE section = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
                                      sizeof(proto::PadBridgeMemory), proto::kPadBridgeName);
  if (section == nullptr) return false;
  void* view =
      MapViewOfFile(section, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(proto::PadBridgeMemory));
  if (view == nullptr) {
    CloseHandle(section);
    return false;
  }
  g_section.reset(section);
  g_memory = static_cast<proto::PadBridgeMemory*>(view);
  std::memset(g_memory, 0, sizeof(*g_memory));
  g_memory->magic = proto::kPadBridgeMagic;
  g_memory->version = proto::kProtocolVersion;
  return true;
}

void Publish(int slot, bool connected, const XINPUT_GAMEPAD* pad, const Device* device) {
  if (g_memory == nullptr || slot < 0 || slot > 3) return;
  proto::BridgedPad& entry = g_memory->slots[slot];
  auto* sequence = reinterpret_cast<volatile LONG*>(&entry.sequence);
  InterlockedIncrement(sequence);  // odd: writing
  entry.connected = connected ? 1 : 0;
  if (pad != nullptr) {
    entry.packet++;
    entry.buttons = pad->wButtons;
    entry.leftTrigger = pad->bLeftTrigger;
    entry.rightTrigger = pad->bRightTrigger;
    entry.thumbLX = pad->sThumbLX;
    entry.thumbLY = pad->sThumbLY;
    entry.thumbRX = pad->sThumbRX;
    entry.thumbRY = pad->sThumbRY;
  }
  if (device != nullptr) {
    entry.vendorId = device->vendorId;
    entry.productId = device->productId;
  }
  InterlockedIncrement(sequence);  // even: done
}

// Vibration over USB. Bluetooth needs a checksummed report and is not sent yet.
void SendRumble(Device& device, uint16_t left, uint16_t right) {
  if (device.bluetooth || device.kind == Kind::SwitchPro || device.outputLength == 0) return;
  std::vector<uint8_t> report(device.outputLength, 0);
  if (device.kind == Kind::DualShock4 && report.size() >= 6) {
    report[0] = 0x05;
    report[1] = 0x01;  // motors only
    report[4] = static_cast<uint8_t>(right >> 8);
    report[5] = static_cast<uint8_t>(left >> 8);
  } else if (device.kind == Kind::DualSense && report.size() >= 5) {
    report[0] = 0x02;
    report[1] = 0x03;  // rumble emulation + motors
    report[3] = static_cast<uint8_t>(right >> 8);
    report[4] = static_cast<uint8_t>(left >> 8);
  } else {
    return;
  }
  OVERLAPPED overlapped{};
  UniqueHandle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  overlapped.hEvent = event.get();
  DWORD written = 0;
  if (!WriteFile(device.handle.get(), report.data(), static_cast<DWORD>(report.size()), nullptr,
                 &overlapped) &&
      GetLastError() == ERROR_IO_PENDING) {
    if (WaitForSingleObject(event.get(), 100) != WAIT_OBJECT_0) {
      CancelIoEx(device.handle.get(), &overlapped);
    }
    GetOverlappedResult(device.handle.get(), &overlapped, &written, TRUE);
  }
}

void ReadLoop(Device* device) {
  std::vector<uint8_t> buffer(device->inputLength);
  UniqueHandle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  uint32_t lastRumble = 0;
  while (!device->stop) {
    OVERLAPPED overlapped{};
    overlapped.hEvent = event.get();
    ResetEvent(event.get());
    DWORD bytes = 0;
    bool ok = ReadFile(device->handle.get(), buffer.data(), static_cast<DWORD>(buffer.size()),
                       nullptr, &overlapped) != FALSE;
    if (!ok && GetLastError() != ERROR_IO_PENDING) break;  // unplugged
    while (!device->stop && WaitForSingleObject(event.get(), 20) == WAIT_TIMEOUT) {
      if (g_memory != nullptr && device->slot >= 0) {
        proto::BridgedPad& entry = g_memory->slots[device->slot];
        if (entry.rumbleSequence != lastRumble) {
          lastRumble = entry.rumbleSequence;
          SendRumble(*device, entry.rumbleLeft, entry.rumbleRight);
        }
      }
    }
    if (device->stop) {
      CancelIoEx(device->handle.get(), &overlapped);
      GetOverlappedResult(device->handle.get(), &overlapped, &bytes, TRUE);
      break;
    }
    if (!GetOverlappedResult(device->handle.get(), &overlapped, &bytes, FALSE)) break;
    XINPUT_GAMEPAD pad{};
    if (ParseReport(device->kind, device->bluetooth, buffer.data(), bytes, pad)) {
      Publish(device->slot, true, &pad, nullptr);
    }
    if (g_memory != nullptr && device->slot >= 0) {
      proto::BridgedPad& entry = g_memory->slots[device->slot];
      if (entry.rumbleSequence != lastRumble) {
        lastRumble = entry.rumbleSequence;
        SendRumble(*device, entry.rumbleLeft, entry.rumbleRight);
      }
    }
  }
  device->stop = true;  // the scanner removes it
}

struct Found {
  std::wstring path;
  uint16_t vendorId;
  uint16_t productId;
};

std::vector<Found> FindControllers() {
  std::vector<Found> found;
  GUID hidGuid;
  HidD_GetHidGuid(&hidGuid);
  HDEVINFO set =
      SetupDiGetClassDevsW(&hidGuid, nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (set == INVALID_HANDLE_VALUE) return found;
  SP_DEVICE_INTERFACE_DATA iface{};
  iface.cbSize = sizeof(iface);
  for (DWORD i = 0; SetupDiEnumDeviceInterfaces(set, nullptr, &hidGuid, i, &iface); ++i) {
    DWORD size = 0;
    SetupDiGetDeviceInterfaceDetailW(set, &iface, nullptr, 0, &size, nullptr);
    if (size == 0) continue;
    std::vector<BYTE> storage(size);
    auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(storage.data());
    detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(set, &iface, detail, size, nullptr, nullptr)) continue;
    HANDLE probe = CreateFileW(detail->DevicePath, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                               OPEN_EXISTING, 0, nullptr);
    if (probe == INVALID_HANDLE_VALUE) continue;
    HIDD_ATTRIBUTES attributes{};
    attributes.Size = sizeof(attributes);
    Kind kind = Kind::DualShock4;
    if (HidD_GetAttributes(probe, &attributes) &&
        KindOf(attributes.VendorID, attributes.ProductID, kind)) {
      found.push_back({detail->DevicePath, attributes.VendorID, attributes.ProductID});
    }
    CloseHandle(probe);
  }
  SetupDiDestroyDeviceInfoList(set);
  return found;
}

bool OpenDevice(Device& device) {
  HANDLE handle = CreateFileW(device.path.c_str(), GENERIC_READ | GENERIC_WRITE,
                              FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                              FILE_FLAG_OVERLAPPED, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    // Read-only still gives input (no vibration).
    handle = CreateFileW(device.path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                         nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
  }
  if (handle == INVALID_HANDLE_VALUE) return false;
  device.handle.reset(handle);
  PHIDP_PREPARSED_DATA preparsed = nullptr;
  if (!HidD_GetPreparsedData(handle, &preparsed)) return false;
  HIDP_CAPS caps{};
  bool ok = HidP_GetCaps(preparsed, &caps) == HIDP_STATUS_SUCCESS;
  HidD_FreePreparsedData(preparsed);
  if (!ok || caps.InputReportByteLength == 0) return false;
  device.inputLength = caps.InputReportByteLength;
  device.outputLength = caps.OutputReportByteLength;
  // Bluetooth HID paths carry the HID-over-Bluetooth service id.
  std::wstring lower = ToLower(device.path);
  device.bluetooth = lower.find(L"00001124-0000-1000-8000-00805f9b34fb") != std::wstring::npos;
  return true;
}

void Scan() {
  // XInput slots first, without our lock (see SlotConnected).
  bool taken[4];
  for (int slot = 0; slot < 4; ++slot) {
    taken[slot] = ControllerMonitor::Instance().SlotConnected(slot);
  }
  std::vector<Found> found = FindControllers();
  bool changed = false;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    // Drop controllers whose reader stopped (unplugged).
    for (auto it = g_devices.begin(); it != g_devices.end();) {
      Device& device = **it;
      bool present = std::any_of(found.begin(), found.end(),
                                 [&](const Found& f) { return f.path == device.path; });
      if (device.stop || !present) {
        device.stop = true;
        if (device.thread.joinable()) device.thread.join();
        Publish(device.slot, false, nullptr, nullptr);
        it = g_devices.erase(it);
        changed = true;
      } else {
        ++it;
      }
    }
    for (const auto& device : g_devices) taken[device->slot] = true;
    for (const Found& f : found) {
      bool known = std::any_of(g_devices.begin(), g_devices.end(),
                               [&](const auto& d) { return d->path == f.path; });
      if (known) continue;
      int slot = -1;
      for (int s = 0; s < 4 && slot < 0; ++s) {
        if (!taken[s]) slot = s;
      }
      if (slot < 0) break;  // every XInput slot is in use
      auto device = std::make_unique<Device>();
      device->path = f.path;
      device->vendorId = f.vendorId;
      device->productId = f.productId;
      KindOf(f.vendorId, f.productId, device->kind);
      if (!OpenDevice(*device)) continue;  // hidden or held exclusively by another program
      device->slot = slot;
      taken[slot] = true;
      Publish(slot, true, nullptr, device.get());
      device->thread = std::thread(ReadLoop, device.get());
      g_devices.push_back(std::move(device));
      changed = true;
    }
  }
  if (changed) ControllerMonitor::Instance().MarkChanged();
}

void StopAllLocked() {
  for (auto& device : g_devices) {
    device->stop = true;
    if (device->thread.joinable()) device->thread.join();
    Publish(device->slot, false, nullptr, nullptr);
  }
  g_devices.clear();
}

}  // namespace

PadBridge& PadBridge::Instance() {
  static PadBridge instance;
  return instance;
}

bool PadBridge::enabled() const { return g_enabled; }

void PadBridge::SetEnabled(bool enabled) {
  if (enabled == g_enabled.exchange(enabled)) return;
  if (enabled) {
    {
      std::lock_guard<std::mutex> lock(g_mutex);
      if (!EnsureMemory()) {
        g_enabled = false;
        return;
      }
    }
    if (g_scanner.joinable()) g_scanner.join();
    g_scanner = std::thread([] {
      while (g_enabled) {
        Scan();
        for (int i = 0; i < 20 && g_enabled; ++i) Sleep(100);  // rescan every 2 s
      }
    });
  } else {
    if (g_scanner.joinable()) g_scanner.join();
    {
      std::lock_guard<std::mutex> lock(g_mutex);
      StopAllLocked();
    }
    ControllerMonitor::Instance().MarkChanged();
  }
}

Json PadBridge::List() {
  std::lock_guard<std::mutex> lock(g_mutex);
  Json list = Json::array();
  for (const auto& device : g_devices) {
    list.push_back(Json{{"slot", device->slot},
                        {"vendorId", device->vendorId},
                        {"productId", device->productId}});
  }
  return list;
}

bool PadBridge::Read(int slot, XINPUT_STATE& state) {
  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_memory == nullptr || slot < 0 || slot > 3) return false;
  bool held = std::any_of(g_devices.begin(), g_devices.end(),
                          [&](const auto& d) { return d->slot == slot; });
  if (!held) return false;
  const proto::BridgedPad& entry = g_memory->slots[slot];
  state.dwPacketNumber = entry.packet;
  state.Gamepad.wButtons = entry.buttons;
  state.Gamepad.bLeftTrigger = entry.leftTrigger;
  state.Gamepad.bRightTrigger = entry.rightTrigger;
  state.Gamepad.sThumbLX = entry.thumbLX;
  state.Gamepad.sThumbLY = entry.thumbLY;
  state.Gamepad.sThumbRX = entry.thumbRX;
  state.Gamepad.sThumbRY = entry.thumbRY;
  return true;
}

void PadBridge::Shutdown() { SetEnabled(false); }

}  // namespace inputsplit::helper
