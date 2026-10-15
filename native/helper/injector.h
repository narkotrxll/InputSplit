// injector.h — loads the hook DLL into a game and starts it.
//
// 64-bit games get InputSplitHook64.dll, 32-bit (WOW64) games get InputSplitHook32.dll. The
// helper itself is always 64-bit: CreateRemoteThread works across the two architectures as
// long as the start address is code of the game's architecture.
//
// Step 1: CreateRemoteThread(LoadLibraryW, "<path>\InputSplitHook64.dll").
//         The DLL's DllMain does nothing heavy (see hook/dllmain.cpp).
// Step 2: CreateRemoteThread(<module base> + <RVA of InputSplitAttach>).
//         The RVA is read from the DLL file's export table, so we never have to load the
//         DLL into the helper itself.
// If the DLL is already loaded (isolation was started before), step 1 is skipped.
#pragma once

#include <windows.h>

#include <cstdint>
#include <optional>
#include <string>

#include "process_info.h"
#include "util.h"

namespace inputsplit::helper {

// Returns the RVA of an exported function by reading the PE file from disk.
std::optional<uint32_t> FindExportRva(const std::wstring& dllPath, const char* exportName);

// Base address of a module (matched by file name, case-insensitive) in `process`.
std::optional<uintptr_t> FindRemoteModule(HANDLE process, const std::wstring& fileName);

// The hook DLL for a game of `arch`: `hook64Path` itself, or the "...32.dll" next to it.
std::wstring HookDllForArchitecture(const std::wstring& hook64Path, Architecture arch);

// Ensures the hook DLL is loaded in `process` and calls InputSplitAttach.
bool InjectAndAttach(HANDLE process, const std::wstring& dllPath, HelperError& error);

}  // namespace inputsplit::helper
