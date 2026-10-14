// controllers.h — XInput controller discovery and the live test stream.
//
// XInput knows four *logical* slots (0..3). It does not expose serial numbers, so a
// physical controller cannot be identified reliably; after reconnecting it may land in a
// different slot. The UI therefore talks about "Slot 1..4".
#pragma once

#include <string>

#include "rpc.h"

namespace inputsplit::helper {

class ControllerMonitor {
 public:
  static ControllerMonitor& Instance();

  bool Start();  // loads XInput and starts the background thread
  void Stop();

  Json List();                // current snapshot of the four slots
  void StartTest(int slot);   // stream "controllerState" events for one slot (~60 Hz)
  void StopTest();

  // Controller shortcut: emits "gamepadHotkey" {slot} when LB + RB + View are held for two
  // seconds on any connected controller.
  void SetHotkeyEnabled(bool enabled);
  // Short vibration as feedback ("on" one pulse, "off" two, "error" three). Returns false
  // when XInput cannot vibrate.
  bool Rumble(int slot, const std::string& pattern);

 private:
  ControllerMonitor() = default;
};

}  // namespace inputsplit::helper
