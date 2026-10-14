#include "displays.h"

#include <shellscalingapi.h>

#include <algorithm>
#include <map>
#include <vector>

#include "windows_enum.h"

namespace inputsplit::helper {
namespace {

struct TargetInfo {
  std::wstring friendlyName;
  DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY technology = DISPLAYCONFIG_OUTPUT_TECHNOLOGY_OTHER;
};

// GDI device name ("\\.\DISPLAY1") -> monitor friendly name and connection type.
std::map<std::wstring, TargetInfo> QueryTargets() {
  std::map<std::wstring, TargetInfo> result;
  UINT32 pathCount = 0;
  UINT32 modeCount = 0;
  if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount) != ERROR_SUCCESS) {
    return result;
  }
  std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
  std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
  if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(),
                         nullptr) != ERROR_SUCCESS) {
    return result;
  }
  for (UINT32 i = 0; i < pathCount; ++i) {
    const DISPLAYCONFIG_PATH_INFO& path = paths[i];
    DISPLAYCONFIG_SOURCE_DEVICE_NAME source{};
    source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
    source.header.size = sizeof(source);
    source.header.adapterId = path.sourceInfo.adapterId;
    source.header.id = path.sourceInfo.id;
    if (DisplayConfigGetDeviceInfo(&source.header) != ERROR_SUCCESS) continue;

    DISPLAYCONFIG_TARGET_DEVICE_NAME target{};
    target.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
    target.header.size = sizeof(target);
    target.header.adapterId = path.targetInfo.adapterId;
    target.header.id = path.targetInfo.id;
    if (DisplayConfigGetDeviceInfo(&target.header) != ERROR_SUCCESS) continue;

    result[source.viewGdiDeviceName] = {target.monitorFriendlyDeviceName,
                                        target.outputTechnology};
  }
  return result;
}

const char* ConnectionName(DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY technology) {
  switch (technology) {
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI: return "hdmi";
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL:
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EXTERNAL: return "displayport";
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI: return "dvi";
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15: return "vga";
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL:
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED:
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED: return "internal";
    case DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST: return "wireless";
    default: return "other";
  }
}

struct MonitorEntry {
  HMONITOR handle;
  MONITORINFOEXW info;
};

BOOL CALLBACK CollectMonitor(HMONITOR monitor, HDC, LPRECT, LPARAM param) {
  auto* list = reinterpret_cast<std::vector<MonitorEntry>*>(param);
  MonitorEntry entry{monitor, {}};
  entry.info.cbSize = sizeof(entry.info);
  if (GetMonitorInfoW(monitor, &entry.info)) list->push_back(entry);
  return TRUE;
}

std::vector<MonitorEntry> Monitors() {
  std::vector<MonitorEntry> list;
  EnumDisplayMonitors(nullptr, nullptr, &CollectMonitor, reinterpret_cast<LPARAM>(&list));
  return list;
}

}  // namespace

Json ListDisplays() {
  auto targets = QueryTargets();
  Json displays = Json::array();
  int index = 0;
  for (const MonitorEntry& monitor : Monitors()) {
    ++index;
    UINT dpiX = 96;
    UINT dpiY = 96;
    GetDpiForMonitor(monitor.handle, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
    DEVMODEW mode{};
    mode.dmSize = sizeof(mode);
    int refresh = 0;
    if (EnumDisplaySettingsW(monitor.info.szDevice, ENUM_CURRENT_SETTINGS, &mode)) {
      refresh = static_cast<int>(mode.dmDisplayFrequency);
    }
    const RECT& r = monitor.info.rcMonitor;
    TargetInfo target;
    if (auto it = targets.find(monitor.info.szDevice); it != targets.end()) target = it->second;
    std::wstring name = target.friendlyName.empty() ? L"Display " + std::to_wstring(index)
                                                    : target.friendlyName;
    std::wstring lowerName = ToLower(name);
    bool hdmi = target.technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI;
    // A hint only, used to pre-select the TV: HDMI and either "TV" in the name or a 4K mode.
    bool likelyTv = hdmi && (lowerName.find(L"tv") != std::wstring::npos ||
                             (r.right - r.left) >= 3840);
    displays.push_back(Json{
        {"id", ToUtf8(monitor.info.szDevice)},
        {"name", ToUtf8(name)},
        {"isPrimary", (monitor.info.dwFlags & MONITORINFOF_PRIMARY) != 0},
        {"bounds", RectToJson(monitor.info.rcMonitor)},
        {"workArea", RectToJson(monitor.info.rcWork)},
        {"dpi", dpiX},
        {"scale", dpiX / 96.0},
        {"refreshRate", refresh},
        {"connection", ConnectionName(target.technology)},
        {"isLikelyTv", likelyTv},
    });
  }
  return Json{{"displays", displays}};
}

Json MoveWindowToDisplay(HWND hwnd, const std::wstring& displayId, const std::string& mode,
                         HelperError& error) {
  if (!IsWindow(hwnd)) {
    error = {"windowNotFound", "The window no longer exists."};
    return nullptr;
  }
  const MonitorEntry* target = nullptr;
  auto monitors = Monitors();
  for (const MonitorEntry& monitor : monitors) {
    if (displayId == monitor.info.szDevice) target = &monitor;
  }
  if (target == nullptr) {
    error = {"displayNotFound", "The display is not connected."};
    return nullptr;
  }

  RECT previous{};
  GetWindowRect(hwnd, &previous);
  // Bring a maximised/minimised window back to a normal state first, without activating it.
  if (IsZoomed(hwnd) || IsIconic(hwnd)) ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE);

  LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  bool hasTitleBar = (style & WS_CAPTION) == WS_CAPTION;
  bool fill = mode == "fill" || (mode == "auto" && !hasTitleBar);

  RECT next{};
  if (fill) {
    next = target->info.rcMonitor;
  } else {
    const RECT& work = target->info.rcWork;
    LONG width = std::min(previous.right - previous.left, work.right - work.left);
    LONG height = std::min(previous.bottom - previous.top, work.bottom - work.top);
    next.left = work.left + ((work.right - work.left) - width) / 2;
    next.top = work.top + ((work.bottom - work.top) - height) / 2;
    next.right = next.left + width;
    next.bottom = next.top + height;
  }
  // SWP_ASYNCWINDOWPOS: if the game is busy, we do not wait for it.
  if (!SetWindowPos(hwnd, nullptr, next.left, next.top, next.right - next.left,
                    next.bottom - next.top,
                    SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS)) {
    error = {"moveFailed", "SetWindowPos failed with error " + std::to_string(GetLastError())};
    return nullptr;
  }
  return Json{{"previous", RectToJson(previous)}, {"current", RectToJson(next)}};
}

bool RestoreWindowRect(HWND hwnd, const RECT& rect) {
  if (!IsWindow(hwnd)) return false;
  return SetWindowPos(hwnd, nullptr, rect.left, rect.top, rect.right - rect.left,
                      rect.bottom - rect.top,
                      SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS) != FALSE;
}

}  // namespace inputsplit::helper
