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

Json ListDisplays();

// mode: "auto" (fill the monitor if the window has no title bar, otherwise centre it),
// "fill" or "center". Returns {"previous": rect, "current": rect}.
Json MoveWindowToDisplay(HWND hwnd, const std::wstring& displayId, const std::string& mode,
                         HelperError& error);

bool RestoreWindowRect(HWND hwnd, const RECT& rect);

}  // namespace inputsplit::helper
