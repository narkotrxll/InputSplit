// detection.cpp — which input stacks does the game use?
//
// Only GetModuleHandle checks: cheap, read-only, no side effects. The result explains to
// the user *why* support may be limited (e.g. Windows.Gaming.Input requires focus).
#include "modules.h"

#include "hook_state.h"

namespace inputsplit::hook {

uint32_t DetectApis() {
  struct Probe {
    const wchar_t* module;
    uint32_t bit;
  };
  static const Probe probes[] = {
      {L"xinput1_4.dll", proto::kApiXInput},
      {L"xinput1_3.dll", proto::kApiXInput},
      {L"xinput9_1_0.dll", proto::kApiXInput},
      {L"xinput1_2.dll", proto::kApiXInput},
      {L"xinput1_1.dll", proto::kApiXInput},
      {L"dinput8.dll", proto::kApiDirectInput8},
      {L"Windows.Gaming.Input.dll", proto::kApiWindowsGamingInput},
      {L"GameInput.dll", proto::kApiGameInput},
      {L"SDL2.dll", proto::kApiSdl2},
      {L"SDL3.dll", proto::kApiSdl3},
      {L"UnityPlayer.dll", proto::kApiUnity},
      {L"steam_api64.dll", proto::kApiSteamApi},
      {L"steam_api.dll", proto::kApiSteamApi},
  };
  uint32_t bits = 0;
  for (const Probe& probe : probes) {
    if (GetModuleHandleW(probe.module) != nullptr) bits |= probe.bit;
  }
  return bits;
}

}  // namespace inputsplit::hook
