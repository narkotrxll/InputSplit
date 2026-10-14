// injector.h — loads InputSplitHook64.dll into a game and starts it.
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

#include "util.h"

namespace inputsplit::helper {

// Returns the RVA of an exported function by reading the PE file from disk.
std::optional<uint32_t> FindExportRva(const std::wstring& dllPath, const char* exportName);

// Base address of a module (matched by file name, case-insensitive) in `process`.
std::optional<uintptr_t> FindRemoteModule(HANDLE process, const std::wstring& fileName);

// Ensures the hook DLL is loaded in `process` and calls InputSplitAttach.
bool InjectAndAttach(HANDLE process, const std::wstring& dllPath, HelperError& error);

}  // namespace inputsplit::helper
