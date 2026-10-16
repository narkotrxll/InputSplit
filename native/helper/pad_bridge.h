// pad_bridge.h — PlayStation and Nintendo controllers as XInput controllers for isolated
// games (no driver, no virtual device: only games with InputSplit's hook see them).
//
// While enabled, the bridge opens every DualShock 4, DualSense and Switch Pro controller it
// finds, gives each one an XInput slot that no real Xbox controller uses, and keeps that
// slot's state in the shared memory section the hook reads (hook_protocol.h). Vibration the
// game asks for goes back to the controller (USB only for now).
#pragma once

#include <windows.h>
#include <xinput.h>

#include "rpc.h"

namespace inputsplit::helper {

class PadBridge {
 public:
  static PadBridge& Instance();

  void SetEnabled(bool enabled);
  bool enabled() const;
  // [{slot, vendorId, productId}] for the controller list.
  Json List();
  // The current state of a bridged slot (for the controller test); false if none.
  bool Read(int slot, XINPUT_STATE& state);
  void Shutdown();

 private:
  PadBridge() = default;
};

}  // namespace inputsplit::helper
