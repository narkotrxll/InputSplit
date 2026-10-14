// modules.h — the functions each hook module exposes to the controller (pipe_client.cpp).
#pragma once

#include <windows.h>

#include <cstdint>

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

// detection.cpp
uint32_t DetectApis();  // proto::DetectedApi bits

// controller.cpp
void ApplyConfiguration(uint32_t features, uint32_t xinputSlot, HWND requestedWindow);
void DisableAll();
void Tick();  // called about once per second by the pipe worker

}  // namespace inputsplit::hook
