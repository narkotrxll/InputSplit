// dllmain.cpp — entry points of InputSplitHook.dll.
//
// DllMain runs under the Windows "loader lock", where almost anything (creating threads
// and waiting for them, loading libraries, hooking) can deadlock the game. So DllMain only
// remembers our module handle. The real start happens in InputSplitAttach, which the helper
// calls in a separate remote thread after LoadLibraryW has returned.
#include <windows.h>

#include "hook_state.h"
#include "pipe_client.h"

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    inputsplit::hook::g_module = module;
    DisableThreadLibraryCalls(module);
  }
  // No DLL_PROCESS_DETACH work: the DLL is never unloaded while the game runs (see
  // docs/ARCHITECTURE.md, "Fail-safe chain"). At process exit there is nothing to restore.
  return TRUE;
}

// Called by the helper via CreateRemoteThread. Starts (or restarts, after a helper restart)
// the worker that connects to the helper's pipe. Exported undecorated via hook.def.
extern "C" DWORD WINAPI InputSplitAttach(LPVOID) {
  return inputsplit::hook::StartWorker() ? 0 : 1;
}
