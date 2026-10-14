// safety.h — decides whether InputSplit is allowed to touch a process.
//
// This check lives in native code on purpose: the UI only *displays* the verdict. Even a
// modified UI cannot make the helper inject into a refused process, because
// startIsolation runs the same check again before injecting.
//
// Anti-cheat protection is on by default. With `allowAntiCheat` (the user turned the
// protection off in Settings and accepted the ban risk) a detected anti-cheat becomes a
// warning instead of a blocker. Nothing is hidden from the anti-cheat either way.
#pragma once

#include <optional>
#include <string>
#include <vector>

#include "process_info.h"
#include "rpc.h"

namespace inputsplit::helper {

struct Finding {
  std::string code;     // stable identifier, translated by the UI
  std::string message;  // technical English explanation for diagnostics
};

struct TargetVerdict {
  ProcessDetails process;
  std::vector<Finding> blockers;  // any blocker => refuse
  std::vector<Finding> warnings;  // allowed, but the user should know
  std::optional<std::string> antiCheat;
};

TargetVerdict CheckTarget(unsigned long pid, const std::wstring& hookDllPath,
                          bool allowAntiCheat = false);

Json VerdictToJson(const TargetVerdict& verdict);

// Exposed for tests: anti-cheat evidence in a module list / game folder.
std::optional<std::string> FindAntiCheatInModules(const std::vector<std::wstring>& modules);
std::optional<std::string> FindAntiCheatInFolders(const std::wstring& exePath);

}  // namespace inputsplit::helper
