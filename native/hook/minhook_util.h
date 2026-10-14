// minhook_util.h — small typed wrappers around MinHook.
//
// MinHook replaces the first bytes of a function with a jump to our "detour" and gives
// us a "trampoline": a pointer that still runs the original code. Calling the trampoline
// from inside the detour is how we forward a call unchanged.
#pragma once

#include <windows.h>

#include <MinHook.h>

#include "log.h"

namespace inputsplit::hook {

// Initialises MinHook once. Safe to call repeatedly.
bool EnsureMinHook();

// Hooks a function by address (used for exports by ordinal).
template <typename Fn>
bool CreateHookAt(FARPROC target, Fn detour, Fn* original, const char* label) {
  if (target == nullptr) {
    Log(LogLevel::Warn, "Hook target %s not found", label);
    return false;
  }
  void* trampoline = nullptr;
  MH_STATUS status = MH_CreateHook(reinterpret_cast<void*>(target), reinterpret_cast<void*>(detour),
                                   &trampoline);
  if (status == MH_ERROR_ALREADY_CREATED) {
    Log(LogLevel::Debug, "Hook %s already exists", label);
    return true;  // installed by an earlier Configure; original pointer is already set
  }
  if (status != MH_OK) {
    Log(LogLevel::Error, "MH_CreateHook(%s) failed: %s", label, MH_StatusToString(status));
    return false;
  }
  if (original != nullptr) *original = reinterpret_cast<Fn>(trampoline);
  status = MH_QueueEnableHook(reinterpret_cast<void*>(target));
  if (status != MH_OK) {
    Log(LogLevel::Error, "MH_QueueEnableHook(%s) failed: %s", label, MH_StatusToString(status));
    return false;
  }
  return true;
}

// Hooks `functionName` exported by `moduleName` (which must already be loaded).
// `original` receives the trampoline. The hook is queued; call ApplyQueuedHooks().
template <typename Fn>
bool CreateApiHook(const wchar_t* moduleName, const char* functionName, Fn detour, Fn* original) {
  HMODULE module = GetModuleHandleW(moduleName);
  if (module == nullptr) {
    Log(LogLevel::Warn, "Module %ls is not loaded; cannot hook %s", moduleName, functionName);
    return false;
  }
  return CreateHookAt(GetProcAddress(module, functionName), detour, original, functionName);
}

// Enables all queued hooks at once (MinHook briefly suspends other threads while patching).
bool ApplyQueuedHooks();

}  // namespace inputsplit::hook
