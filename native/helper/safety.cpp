#include "safety.h"

#include <tlhelp32.h>

#include "util.h"

namespace inputsplit::helper {
namespace {

struct Signature {
  const wchar_t* pattern;  // lower-case
  const char* product;
};

// Modules loaded into a protected game. Matched as a prefix of the module file name.
const Signature kModuleSignatures[] = {
    {L"easyanticheat", "Easy Anti-Cheat"},
    {L"beclient", "BattlEye"},
    {L"battleye", "BattlEye"},
    {L"xigncode", "XIGNCODE3"},
    {L"x3.xem", "XIGNCODE3"},
    {L"npggnt", "nProtect GameGuard"},
    {L"gameguard", "nProtect GameGuard"},
    {L"equ8", "EQU8"},
    {L"faceit", "FACEIT"},
    {L"mhyprot", "mhyprot"},
    {L"tersafe", "Tencent Anti-Cheat"},
    {L"pnkbstr", "PunkBuster"},
};

// Files or folders shipped next to a protected game. Exact (case-insensitive) names.
const Signature kFolderSignatures[] = {
    {L"easyanticheat", "Easy Anti-Cheat"},
    {L"easyanticheat_eos", "Easy Anti-Cheat"},
    {L"start_protected_game.exe", "Easy Anti-Cheat"},
    {L"easyanticheat_setup.exe", "Easy Anti-Cheat"},
    {L"easyanticheat_eos_setup.exe", "Easy Anti-Cheat"},
    {L"battleye", "BattlEye"},
    {L"beservice.exe", "BattlEye"},
    {L"beservice_x64.exe", "BattlEye"},
    {L"gameguard", "nProtect GameGuard"},
    {L"xigncode", "XIGNCODE3"},
    {L"anticheatexpert", "Tencent ACE"},
    {L"mhyprot2.sys", "mhyprot"},
    {L"mhyprot3.sys", "mhyprot"},
    {L"equ8", "EQU8"},
    {L"pnkbstra.exe", "PunkBuster"},
    {L"pbsvc.exe", "PunkBuster"},
    {L"vanguard", "Riot Vanguard"},
};

// Folders that are shared by many games (library roots). Anti-cheat files found there do
// not belong to the selected game, so the upward search stops before them.
const wchar_t* const kLibraryRoots[] = {
    L"common", L"steamapps", L"steamlibrary", L"epic games", L"xboxgames", L"games",
    L"program files", L"program files (x86)", L"gog galaxy", L"gog games", L"ea games",
    L"origin games", L"ubisoft game launcher", L"windowsapps"};

bool IsLibraryRoot(const std::wstring& lowerName) {
  for (const wchar_t* root : kLibraryRoots) {
    if (lowerName == root) return true;
  }
  return false;
}

size_t PathDepth(const std::wstring& path) {
  size_t depth = 0;
  for (wchar_t c : path) {
    if (c == L'\\') ++depth;
  }
  return depth;
}

std::optional<std::string> ScanFolder(const std::wstring& folder) {
  WIN32_FIND_DATAW data;
  HANDLE find = FindFirstFileW((folder + L"\\*").c_str(), &data);
  if (find == INVALID_HANDLE_VALUE) return std::nullopt;
  std::optional<std::string> hit;
  do {
    std::wstring name = ToLower(data.cFileName);
    for (const Signature& signature : kFolderSignatures) {
      if (name == signature.pattern) {
        hit = signature.product;
        break;
      }
    }
  } while (!hit && FindNextFileW(find, &data));
  FindClose(find);
  return hit;
}

bool IsProcessRunning(const wchar_t* lowerExeName) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return false;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  bool found = false;
  for (BOOL ok = Process32FirstW(snapshot, &entry); ok && !found;
       ok = Process32NextW(snapshot, &entry)) {
    found = ToLower(entry.szExeFile) == lowerExeName;
  }
  CloseHandle(snapshot);
  return found;
}

std::wstring WindowsDirectory() {
  wchar_t buffer[MAX_PATH];
  UINT length = GetWindowsDirectoryW(buffer, MAX_PATH);
  return ToLower(std::wstring(buffer, length));
}

}  // namespace

std::optional<std::string> FindAntiCheatInModules(const std::vector<std::wstring>& modules) {
  for (const std::wstring& module : modules) {
    for (const Signature& signature : kModuleSignatures) {
      if (module.rfind(signature.pattern, 0) == 0) return signature.product;
    }
  }
  return std::nullopt;
}

std::optional<std::string> FindAntiCheatInFolders(const std::wstring& exePath) {
  // Game executables often live a few levels below the game root, e.g.
  // <root>\Game\Binaries\Win64\Game-Win64-Shipping.exe with <root>\EasyAntiCheat.
  std::wstring folder = DirectoryOf(exePath);
  for (int level = 0; level < 4 && !folder.empty(); ++level) {
    if (PathDepth(folder) < 2) break;  // never scan a drive root or "C:\Games"
    if (IsLibraryRoot(ToLower(FileNameOf(folder)))) break;
    if (auto hit = ScanFolder(folder)) return hit;
    folder = DirectoryOf(folder);
  }
  return std::nullopt;
}

TargetVerdict CheckTarget(unsigned long pid, const std::wstring& hookDllPath,
                          bool allowAntiCheat) {
  TargetVerdict verdict;
  verdict.process = QueryProcess(pid, true);
  const ProcessDetails& process = verdict.process;
  auto block = [&](const char* code, const std::string& message) {
    verdict.blockers.push_back({code, message});
  };
  auto warn = [&](const char* code, const std::string& message) {
    verdict.warnings.push_back({code, message});
  };

  if (!process.exists) {
    block("processNotFound", "The process is no longer running.");
    return verdict;
  }
  const std::wstring exe = ToLower(process.exeName);
  if (pid == GetCurrentProcessId() || exe == L"inputsplit.exe" || exe == L"inputsplit-helper.exe") {
    block("selfProcess", "InputSplit cannot isolate itself.");
    return verdict;
  }
  if (!process.accessible || !process.canInject) {
    if (process.elevated && !IsSelfElevated()) {
      block("elevated", "The game runs as administrator and InputSplit does not.");
    } else {
      block("accessDenied", "Windows denied access to the process (protected process?).");
    }
    return verdict;
  }
  if (!process.exePath.empty() && ToLower(process.exePath).rfind(WindowsDirectory() + L"\\", 0) == 0) {
    block("systemProcess", "System processes are never modified.");
    return verdict;
  }
  if (process.appContainer) {
    block("appContainer", "Sandboxed (AppContainer) apps cannot load InputSplit.");
  }
  if (process.architecture != SelfArchitecture()) {
    block("unsupportedArchitecture",
          std::string("Only 64-bit games are supported for now; this one is ") +
              ArchitectureName(process.architecture) + ".");
  }

  verdict.antiCheat = FindAntiCheatInModules(process.modules);
  if (!verdict.antiCheat && !process.exePath.empty()) {
    verdict.antiCheat = FindAntiCheatInFolders(process.exePath);
  }
  if (verdict.antiCheat && allowAntiCheat) {
    warn("antiCheat", "Protected by " + *verdict.antiCheat +
                          ". Anti-cheat protection is off: the user accepted the ban risk.");
  } else if (verdict.antiCheat) {
    block("antiCheat", "Protected by " + *verdict.antiCheat +
                           ". InputSplit never injects into anti-cheat protected games.");
  }
  if (!PathExists(hookDllPath)) {
    block("hookMissing", "InputSplitHook64.dll was not found next to the helper.");
  }

  if (HasModule(process, L"windows.gaming.input.dll")) {
    warn("windowsGamingInput",
         "The game uses Windows.Gaming.Input, which only delivers controller input to the "
         "focused window.");
  }
  if (HasModule(process, L"gameinput.dll")) {
    warn("gameInput", "The game uses GameInput, which by default has no background input.");
  }
  bool steamGame = HasModule(process, L"steam_api64.dll") || HasModule(process, L"steam_api.dll") ||
                   ToLower(process.exePath).find(L"\\steamapps\\") != std::wstring::npos;
  if (steamGame && IsProcessRunning(L"steam.exe")) {
    warn("steamInput",
         "Steam is running. If Steam Input is enabled for this game, Steam may map the "
         "controller to the desktop mouse when the game is not focused.");
  }
  return verdict;
}

Json VerdictToJson(const TargetVerdict& verdict) {
  auto findings = [](const std::vector<Finding>& list) {
    Json array = Json::array();
    for (const Finding& finding : list) {
      array.push_back(Json{{"code", finding.code}, {"message", finding.message}});
    }
    return array;
  };
  return Json{
      {"pid", verdict.process.pid},
      {"exePath", verdict.process.exePath.empty() ? Json(nullptr)
                                                  : Json(ToUtf8(verdict.process.exePath))},
      {"architecture", ArchitectureName(verdict.process.architecture)},
      {"blockers", findings(verdict.blockers)},
      {"warnings", findings(verdict.warnings)},
      {"antiCheat", verdict.antiCheat ? Json(*verdict.antiCheat) : Json(nullptr)},
  };
}

}  // namespace inputsplit::helper
