// modules.h — the functions each hook module exposes to the controller (pipe_client.cpp).
#pragma once

#include <windows.h>

#include <xinput.h>

#include <cstdint>

#include "../common/hook_protocol.h"

namespace inputsplit::hook {

// activation_shield.cpp
void SyncShield(bool wanted);  // subclass (or restore) all top-level windows of the game
uint32_t ShieldWindowCount();
bool ShieldCovers(HWND hwnd);
HWND FindMainWindow();  // largest visible, unowned top-level window of this process
void WakeGame(HWND game);  // one-time "you are active" for a game that already paused

// focus_spoof.cpp
bool InstallFocusSpoofHooks();

// cursor_guard.cpp
bool InstallCursorGuardHooks();
void ReleaseGameCursorClip();

// input_block.cpp
bool InstallInputBlockHooks();
bool IsKeyboardMessage(UINT message);
bool IsMouseMessage(UINT message);

// xinput_bridge.cpp
bool InstallXInputHooks();
void OnXInputBackgroundEnabled();
void OnXInputBackgroundDisabled();

// directinput_bridge.cpp
bool InstallDirectInputHooks();

// rawinput_bridge.cpp
bool InstallRawInputHooks();
void SyncRawInputRegistrations();  // re-register the game's HID controllers for the current state
// Handles our private sync message on the game's window thread (shield window procedure).
bool HandleRawInputSyncMessage(UINT msg, LRESULT& result);
bool IsGamepadUsage(USHORT usagePage, USHORT usage);

// frame_stats.cpp (the FPS overlay)
void SetFrameStats(bool enabled);  // hooks the game's Present calls on first use
void FrameStatsTick();             // hooks a renderer the game loaded later
void OnControllerRead(DWORD physicalSlot, const XINPUT_STATE* state);  // after a game read
void FillFrameStats(proto::StatusMessage& status);

// tuning.cpp (dead zones and button remapping, XInput only)
void SetTuning(const proto::TuningMessage& tuning);
void ClearTuning();
void ApplyTuning(XINPUT_STATE* state);  // no-op unless a tuning is set

// detection.cpp
uint32_t DetectApis();  // proto::DetectedApi bits

// controller.cpp
void ApplyConfiguration(uint32_t features, uint32_t xinputSlot, HWND requestedWindow);
void DisableAll();
void Tick();  // called about once per second by the pipe worker

}  // namespace inputsplit::hook
