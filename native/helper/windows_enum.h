#pragma once

#include <windows.h>

#include <set>

#include "rpc.h"

namespace inputsplit::helper {

Json RectToJson(const RECT& rect);

// Visible, user-facing top-level windows (with process facts and game hints).
Json ListWindows(const std::set<DWORD>& excludedPids);

}  // namespace inputsplit::helper
