// displays.h — monitors (with friendly names) and moving a game window between them.
//
// The helper is per-monitor DPI aware, so every rectangle here is in physical pixels.
// We never change the display configuration (resolution, arrangement, primary monitor).
#pragma once

#include <windows.h>

#include <optional>
#include <string>

#include "rpc.h"
#include "util.h"

namespace inputsplit::helper {

// What Windows knows about the monitor shown as `displayId` ("\\.\DISPLAY1").
struct TargetInfo {
  std::wstring friendlyName;
  // Device interface path of the monitor ("\\?\DISPLAY#GSM5B7F#5&...#{e6f07b5f-...}").
  std::wstring devicePath;
  DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY technology = DISPLAYCONFIG_OUTPUT_TECHNOLOGY_OTHER;
};

std::optional<TargetInfo> FindDisplayTarget(const std::wstring& displayId);

Json ListDisplays();

// mode: "auto" (fill the monitor if the window has no title bar, otherwise centre it),
// "fill" or "center". Returns {"previous": rect, "current": rect}.
Json MoveWindowToDisplay(HWND hwnd, const std::wstring& displayId, const std::string& mode,
                         HelperError& error);

bool RestoreWindowRect(HWND hwnd, const RECT& rect);

}  // namespace inputsplit::helper
