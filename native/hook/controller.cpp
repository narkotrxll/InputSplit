// controller.cpp — applies a feature set requested by the helper and reports the truth.
//
// The rule: a feature is reported `active` only if every hook it needs was installed. If
// installation fails, the feature goes to `failed` and stays off. The UI shows exactly
// these bits, so it can never claim something that is not working.
#include "controller.h"

#include "hook_state.h"
#include "log.h"
#include "minhook_util.h"
#include "modules.h"

namespace inputsplit::hook {

// Definitions of the globals declared in hook_state.h.
HMODULE g_module = nullptr;
std::atomic<uint32_t> g_requested{0};
std::atomic<uint32_t> g_active{0};
std::atomic<uint32_t> g_failed{0};
std::atomic<HWND> g_gameWindow{nullptr};
std::atomic<uint32_t> g_xinputSlot{proto::kNoSlot};
Counters g_counters;

namespace {

uint32_t g_apisAtAttach = 0;  // snapshot taken before we pre-load any XInput DLL

constexpr uint32_t kWindowProcFeatures =
    proto::kFeatureActivationShield | proto::kFeatureBlockKeyboard | proto::kFeatureBlockMouse;

HWND ResolveGameWindow(HWND requested) {
  if (requested != nullptr && IsWindow(requested) && IsOwnWindow(requested)) return requested;
  return FindMainWindow();
}

}  // namespace

void SnapshotApisAtAttach() {
  g_apisAtAttach = DetectApis();
}

uint32_t ApisAtAttach() {
  return g_apisAtAttach;
}

void ApplyConfiguration(uint32_t features, uint32_t xinputSlot, HWND requestedWindow) {
  features &= proto::kAllFeatures;
  const uint32_t previouslyActive = g_active.load();

  g_requested.store(features);
  g_xinputSlot.store(xinputSlot);
  HWND game = ResolveGameWindow(requestedWindow);
  g_gameWindow.store(game);
  if (game == nullptr) Log(LogLevel::Warn, "No visible game window found");

  uint32_t failed = 0;
  if (!EnsureMinHook()) {
    failed = features;
  } else {
    if ((features & proto::kFeatureFocusSpoof) && !InstallFocusSpoofHooks()) {
      failed |= proto::kFeatureFocusSpoof;
    }
    if ((features & proto::kFeatureCursorGuard) && !InstallCursorGuardHooks()) {
      failed |= proto::kFeatureCursorGuard;
    }
    if ((features & (proto::kFeatureBlockKeyboard | proto::kFeatureBlockMouse)) &&
        !InstallInputBlockHooks()) {
      failed |= features & (proto::kFeatureBlockKeyboard | proto::kFeatureBlockMouse);
    }
    if ((features & (proto::kFeatureXInputBackground | proto::kFeatureXInputSlotLock)) &&
        !InstallXInputHooks()) {
      failed |= features & (proto::kFeatureXInputBackground | proto::kFeatureXInputSlotLock);
    }
    if (features & proto::kFeatureXInputBackground) {
      // Other controller stacks are best effort: a game that uses only XInput must not be
      // reported as limited because, say, DirectInput could not be prepared. Raw Input needs
      // the input-block hooks for GetRawInputData (they pass everything through unless
      // keyboard/mouse blocking is on).
      if (!InstallDirectInputHooks()) Log(LogLevel::Warn, "DirectInput background not available");
      if (!InstallInputBlockHooks() || !InstallRawInputHooks()) {
        Log(LogLevel::Warn, "Raw Input background not available");
      }
    }
    if ((features & proto::kFeatureXInputSlotLock) && xinputSlot > 3) {
      failed |= proto::kFeatureXInputSlotLock;
      Log(LogLevel::Warn, "Slot lock requested without a valid slot");
    }
  }

  uint32_t active = features & ~failed;
  g_failed.store(failed);
  g_active.store(active);  // from here on, detours obey the new set

  // Window procedures: needed for the shield and for sent keyboard/mouse messages.
  SyncShield((active & kWindowProcFeatures) != 0);
  if ((active & proto::kFeatureActivationShield) && game != nullptr && !ShieldCovers(game)) {
    // Without the main window the shield is not doing its job: report it honestly.
    active &= ~proto::kFeatureActivationShield;
    failed |= proto::kFeatureActivationShield;
    g_failed.store(failed);
    g_active.store(active);
    Log(LogLevel::Error, "Could not protect the game window");
  }

  const uint32_t turnedOn = active & ~previouslyActive;
  const uint32_t turnedOff = previouslyActive & ~active;
  if (turnedOn & proto::kFeatureXInputBackground) {
    OnXInputBackgroundEnabled();
    SyncRawInputRegistrations();
  }
  if (turnedOff & proto::kFeatureXInputBackground) {
    OnXInputBackgroundDisabled();
    SyncRawInputRegistrations();
  }
  if (turnedOn & proto::kFeatureCursorGuard) ReleaseGameCursorClip();
  if (turnedOn & proto::kFeatureActivationShield) WakeGame(GameWindow());

  Log(LogLevel::Info, "Configured: requested=0x%02X active=0x%02X failed=0x%02X slot=%u",
      features, active, failed, xinputSlot);
}

void DisableAll() {
  const uint32_t previouslyActive = g_active.exchange(0);
  g_requested.store(0);
  g_failed.store(0);
  SyncShield(false);
  SetFrameStats(false);
  if (previouslyActive & proto::kFeatureXInputBackground) {
    OnXInputBackgroundDisabled();
    SyncRawInputRegistrations();
  }
  if (previouslyActive != 0) Log(LogLevel::Info, "All features disabled (pass-through)");
}

void Tick() {
  FrameStatsTick();
  // Pick up windows the game created after isolation started (launcher -> game window,
  // splash -> main window, etc.).
  if (g_active.load() & kWindowProcFeatures) SyncShield(true);
  if (GameWindow() == nullptr && g_active.load() != 0) {
    HWND replacement = FindMainWindow();
    if (replacement != nullptr) {
      g_gameWindow.store(replacement);
      Log(LogLevel::Info, "Game window changed; following the new main window");
    }
  }
}

proto::StatusMessage BuildStatus() {
  auto status = proto::MakeMessage<proto::StatusMessage>(proto::MessageType::Status);
  status.requested = g_requested.load();
  status.active = g_active.load();
  status.failed = g_failed.load();
  uint64_t reads = g_counters.xinputReads.load();
  // After we pre-load XInput every process "has" it; report XInput only if the game had
  // loaded it itself or is actually calling it.
  status.detectedApis = (DetectApis() & ~proto::kApiXInput) | (g_apisAtAttach & proto::kApiXInput) |
                        (reads > 0 ? static_cast<uint32_t>(proto::kApiXInput) : 0u);
  status.gameWindow = reinterpret_cast<uint64_t>(GameWindow());
  status.subclassedWindows = ShieldWindowCount();
  status.xinputSlot = g_xinputSlot.load();
  status.xinputReads = reads;
  status.blockedKeyboard = g_counters.blockedKeyboard.load();
  status.blockedMouse = g_counters.blockedMouse.load();
  status.swallowedFocusEvents = g_counters.swallowedFocusEvents.load();
  status.blockedCursorCalls = g_counters.blockedCursorCalls.load();
  status.xinputEnableBlocked = g_counters.xinputEnableBlocked.load();
  status.directInputReads = g_counters.directInputReads.load();
  status.rawGamepadReads = g_counters.rawGamepadReads.load();
  FillFrameStats(status);
  return status;
}

}  // namespace inputsplit::hook
