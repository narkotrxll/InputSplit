// process_info.h — read-only facts about other processes.
#pragma once

#include <windows.h>

#include <string>
#include <vector>

namespace inputsplit::helper {

enum class Architecture { Unknown, X86, X64, Arm64 };

const char* ArchitectureName(Architecture arch);

struct ProcessDetails {
  DWORD pid = 0;
  bool exists = false;
  bool accessible = false;   // we could open it with query rights
  bool canInject = false;    // we could open it with the rights injection needs
  bool elevated = false;     // runs as administrator (only known when accessible)
  bool appContainer = false;
  std::wstring exePath;      // empty when not accessible
  std::wstring exeName;
  Architecture architecture = Architecture::Unknown;
  std::vector<std::wstring> modules;  // lower-case module file names (if requested)
};

// Collects details. `withModules` enumerates loaded DLLs (needs PROCESS_VM_READ).
ProcessDetails QueryProcess(DWORD pid, bool withModules);

// The architecture of the helper itself.
Architecture SelfArchitecture();

bool IsSelfElevated();

bool HasModule(const ProcessDetails& process, const wchar_t* lowerCaseName);

// Heuristic "is this a game?" scoring, with machine-readable hints for the UI.
struct GameGuess {
  int score = 0;
  bool likelyGame = false;
  std::vector<std::string> hints;
};
GameGuess GuessGame(const ProcessDetails& process, bool borderlessFullscreen);

}  // namespace inputsplit::helper
