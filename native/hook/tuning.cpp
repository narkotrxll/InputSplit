// tuning.cpp — stick and trigger dead zones and button remapping, applied to what the game
// reads through XInput (InputSplit's own). A worn stick that rests a little off-centre
// ("drift") reads as zero inside the dead zone; outside it the range is rescaled so the
// stick still reaches full deflection. Only this game is affected; the controller and
// every other program see the real values.
//
// Written by the pipe thread, read by game threads: every field is its own atomic, so a
// read during an update can mix old and new values for one frame at most.
#include "modules.h"

#include <atomic>
#include <cmath>

#include "log.h"

namespace inputsplit::hook {
namespace {

std::atomic<bool> g_enabled{false};
std::atomic<int> g_leftDeadzone{0};
std::atomic<int> g_rightDeadzone{0};
std::atomic<int> g_triggerDeadzone{0};
std::atomic<uint8_t> g_buttonMap[16];
std::atomic<bool> g_orderEnabled{false};
std::atomic<uint8_t> g_playerSlots[4];

constexpr double kStickMax = 32767.0;

SHORT ClampThumb(double value) {
  if (value > kStickMax) return 32767;
  if (value < -32768.0) return -32768;
  return static_cast<SHORT>(std::lround(value));
}

void ApplyStick(SHORT& x, SHORT& y, int deadzone) {
  if (deadzone <= 0) return;
  const double fx = x, fy = y;
  const double length = std::sqrt(fx * fx + fy * fy);
  if (length <= deadzone) {
    x = 0;
    y = 0;
    return;
  }
  const double scaled =
      (std::fmin(length, kStickMax) - deadzone) / (kStickMax - deadzone) * kStickMax;
  x = ClampThumb(fx / length * scaled);
  y = ClampThumb(fy / length * scaled);
}

BYTE ApplyTrigger(BYTE value, int deadzone) {
  if (deadzone <= 0) return value;
  if (value <= deadzone) return 0;
  return static_cast<BYTE>((value - deadzone) * 255 / (255 - deadzone));
}

}  // namespace

void SetTuning(const proto::TuningMessage& tuning) {
  bool identity = true;
  for (int i = 0; i < 16; ++i) {
    uint8_t to = tuning.buttonMap[i];
    if (to != proto::kButtonOff && to > 15) to = static_cast<uint8_t>(i);  // invalid: unchanged
    g_buttonMap[i].store(to, std::memory_order_relaxed);
    identity = identity && to == i;
  }
  const int left = tuning.leftDeadzone > 32766 ? 32766 : tuning.leftDeadzone;
  const int right = tuning.rightDeadzone > 32766 ? 32766 : tuning.rightDeadzone;
  const int trigger = tuning.triggerDeadzone > 254 ? 254 : tuning.triggerDeadzone;
  g_leftDeadzone.store(left, std::memory_order_relaxed);
  g_rightDeadzone.store(right, std::memory_order_relaxed);
  g_triggerDeadzone.store(trigger, std::memory_order_relaxed);
  const bool enabled = !identity || left > 0 || right > 0 || trigger > 0;
  g_enabled.store(enabled, std::memory_order_release);
  bool order = false;
  for (int i = 0; i < 4; ++i) {
    uint8_t slot = tuning.playerSlots[i];
    if (slot > 3) slot = static_cast<uint8_t>(i);
    g_playerSlots[i].store(slot, std::memory_order_relaxed);
    order = order || slot != i;
  }
  g_orderEnabled.store(order, std::memory_order_release);
  if (order) {
    Log(LogLevel::Info, "Player order: slots %u %u %u %u", tuning.playerSlots[0] + 1u,
        tuning.playerSlots[1] + 1u, tuning.playerSlots[2] + 1u, tuning.playerSlots[3] + 1u);
  }
  Log(LogLevel::Info, "Tuning %s: dead zones L=%d R=%d triggers=%d, buttons %s",
      enabled ? "on" : "off", left, right, trigger, identity ? "unchanged" : "remapped");
}

void ClearTuning() {
  g_enabled.store(false, std::memory_order_release);
  g_orderEnabled.store(false, std::memory_order_release);
}

bool PlayerOrderSlot(DWORD userIndex, DWORD& physical) {
  if (userIndex > 3 || !g_orderEnabled.load(std::memory_order_acquire)) return false;
  physical = g_playerSlots[userIndex].load(std::memory_order_relaxed);
  return true;
}

void ApplyTuning(XINPUT_STATE* state) {
  if (state == nullptr || !g_enabled.load(std::memory_order_acquire)) return;
  XINPUT_GAMEPAD& pad = state->Gamepad;
  ApplyStick(pad.sThumbLX, pad.sThumbLY, g_leftDeadzone.load(std::memory_order_relaxed));
  ApplyStick(pad.sThumbRX, pad.sThumbRY, g_rightDeadzone.load(std::memory_order_relaxed));
  const int trigger = g_triggerDeadzone.load(std::memory_order_relaxed);
  pad.bLeftTrigger = ApplyTrigger(pad.bLeftTrigger, trigger);
  pad.bRightTrigger = ApplyTrigger(pad.bRightTrigger, trigger);
  WORD buttons = 0;
  for (int i = 0; i < 16; ++i) {
    if ((pad.wButtons & (1u << i)) == 0) continue;
    const uint8_t to = g_buttonMap[i].load(std::memory_order_relaxed);
    if (to != proto::kButtonOff) buttons = static_cast<WORD>(buttons | (1u << to));
  }
  pad.wButtons = buttons;
}

}  // namespace inputsplit::hook
