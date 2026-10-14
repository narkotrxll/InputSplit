// system_window.h — a hidden window that receives system notifications:
//   * WM_HOTKEY for the emergency stop shortcut (Ctrl+Alt+Shift+Q),
//   * WM_DISPLAYCHANGE when monitors are added, removed or change resolution.
//
// RegisterHotKey only reserves that one key combination; it does not see or block any
// other keys (unlike a global keyboard hook, which InputSplit never uses).
#pragma once

#include <string>

namespace inputsplit::helper {

bool StartSystemWindow();
void StopSystemWindow();

// Returns true if the hotkey is (now) registered. Thread-safe.
bool SetEmergencyHotkey(bool enabled);
const char* EmergencyHotkeyLabel();

}  // namespace inputsplit::helper
