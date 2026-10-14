#include "process_info.h"

#include <psapi.h>

#include <algorithm>

#include "util.h"

namespace inputsplit::helper {
namespace {

Architecture MachineToArchitecture(USHORT machine) {
  switch (machine) {
    case IMAGE_FILE_MACHINE_I386: return Architecture::X86;
    case IMAGE_FILE_MACHINE_AMD64: return Architecture::X64;
    case 0xAA64 /* IMAGE_FILE_MACHINE_ARM64 */: return Architecture::Arm64;
    default: return Architecture::Unknown;
  }
}

Architecture QueryArchitecture(HANDLE process) {
  // IsWow64Process2 exists on Windows 10 1709+; looked up dynamically.
  using IsWow64Process2Fn = BOOL(WINAPI*)(HANDLE, USHORT*, USHORT*);
  static auto isWow64Process2 = reinterpret_cast<IsWow64Process2Fn>(
      GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "IsWow64Process2"));
  if (isWow64Process2 != nullptr) {
    USHORT processMachine = 0;
    USHORT nativeMachine = 0;
    if (isWow64Process2(process, &processMachine, &nativeMachine)) {
      return MachineToArchitecture(processMachine == IMAGE_FILE_MACHINE_UNKNOWN ? nativeMachine
                                                                                : processMachine);
    }
  }
  BOOL wow64 = FALSE;
  if (IsWow64Process(process, &wow64)) return wow64 ? Architecture::X86 : Architecture::X64;
  return Architecture::Unknown;
}

void QueryToken(HANDLE process, ProcessDetails& details) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return;
  TOKEN_ELEVATION elevation{};
  DWORD size = 0;
  if (GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size)) {
    details.elevated = elevation.TokenIsElevated != 0;
  }
  DWORD isAppContainer = 0;
  if (GetTokenInformation(token, TokenIsAppContainer, &isAppContainer, sizeof(isAppContainer),
                          &size)) {
    details.appContainer = isAppContainer != 0;
  }
  CloseHandle(token);
}

std::vector<std::wstring> QueryModules(HANDLE process) {
  std::vector<std::wstring> names;
  std::vector<HMODULE> modules(1024);
  DWORD needed = 0;
  if (!EnumProcessModulesEx(process, modules.data(),
                            static_cast<DWORD>(modules.size() * sizeof(HMODULE)), &needed,
                            LIST_MODULES_ALL)) {
    return names;
  }
  size_t count = std::min<size_t>(needed / sizeof(HMODULE), modules.size());
  wchar_t name[MAX_PATH];
  for (size_t i = 0; i < count; ++i) {
    if (GetModuleBaseNameW(process, modules[i], name, MAX_PATH) > 0) {
      names.push_back(ToLower(name));
    }
  }
  return names;
}

bool Contains(const std::wstring& haystack, const wchar_t* needle) {
  return haystack.find(needle) != std::wstring::npos;
}

}  // namespace

const char* ArchitectureName(Architecture arch) {
  switch (arch) {
    case Architecture::X86: return "x86";
    case Architecture::X64: return "x64";
    case Architecture::Arm64: return "arm64";
    default: return "unknown";
  }
}

Architecture SelfArchitecture() {
  return sizeof(void*) == 8 ? Architecture::X64 : Architecture::X86;
}

bool IsSelfElevated() {
  ProcessDetails self;
  QueryToken(GetCurrentProcess(), self);
  return self.elevated;
}

ProcessDetails QueryProcess(DWORD pid, bool withModules) {
  ProcessDetails details;
  details.pid = pid;

  UniqueHandle limited(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
  if (!limited.valid()) {
    details.exists = GetLastError() == ERROR_ACCESS_DENIED;  // exists, but protected/elevated
    return details;
  }
  details.exists = true;
  details.accessible = true;

  wchar_t path[MAX_PATH * 2];
  DWORD length = static_cast<DWORD>(std::size(path));
  if (QueryFullProcessImageNameW(limited.get(), 0, path, &length)) {
    details.exePath.assign(path, length);
    details.exeName = FileNameOf(details.exePath);
  }
  details.architecture = QueryArchitecture(limited.get());
  QueryToken(limited.get(), details);

  // The rights CreateRemoteThread-based injection needs.
  UniqueHandle full(OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
                                    PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
                                FALSE, pid));
  details.canInject = full.valid();
  if (withModules && full.valid()) details.modules = QueryModules(full.get());
  return details;
}

bool HasModule(const ProcessDetails& process, const wchar_t* lowerCaseName) {
  return std::find(process.modules.begin(), process.modules.end(), lowerCaseName) !=
         process.modules.end();
}

GameGuess GuessGame(const ProcessDetails& process, bool borderlessFullscreen) {
  GameGuess guess;
  const std::wstring path = ToLower(process.exePath);
  const std::wstring exe = ToLower(process.exeName);

  // Everyday desktop applications are never suggested as games.
  static const wchar_t* const kNotGames[] = {
      L"chrome.exe", L"msedge.exe", L"firefox.exe", L"opera.exe", L"brave.exe", L"vivaldi.exe",
      L"code.exe", L"devenv.exe", L"explorer.exe", L"telegram.exe", L"discord.exe",
      L"slack.exe", L"spotify.exe", L"steam.exe", L"steamwebhelper.exe",
      L"epicgameslauncher.exe", L"notepad.exe", L"notepad++.exe", L"windowsterminal.exe",
      L"cmd.exe", L"powershell.exe", L"pwsh.exe", L"idea64.exe", L"rider64.exe",
      L"pycharm64.exe", L"webstorm64.exe", L"obs64.exe", L"ms-teams.exe", L"teams.exe",
      L"outlook.exe", L"winword.exe", L"excel.exe", L"powerpnt.exe", L"inputsplit.exe",
      L"applicationframehost.exe", L"systemsettings.exe", L"textinputhost.exe",
      L"shellexperiencehost.exe", L"searchhost.exe", L"startmenuexperiencehost.exe",
      L"galaxyclient.exe", L"eadesktop.exe", L"ubisoftconnect.exe", L"battle.net.exe",
      L"xboxpcapp.exe", L"gamebar.exe", L"taskmgr.exe", L"mstsc.exe", L"zoom.exe",
      L"whatsapp.exe", L"figma.exe", L"notion.exe", L"obsidian.exe", L"cursor.exe"};
  for (const wchar_t* name : kNotGames) {
    if (exe == name) return guess;
  }

  auto add = [&](int points, const char* hint) {
    guess.score += points;
    guess.hints.emplace_back(hint);
  };

  if (Contains(path, L"\\steamapps\\common\\")) add(3, "steam");
  if (Contains(path, L"\\epic games\\")) add(3, "epic");
  if (Contains(path, L"\\gog galaxy\\games\\") || Contains(path, L"\\gog games\\")) add(3, "gog");
  if (Contains(path, L"\\xboxgames\\")) add(3, "xbox");
  if (Contains(path, L"\\ea games\\") || Contains(path, L"\\origin games\\")) add(3, "ea");
  if (Contains(path, L"\\ubisoft game launcher\\games\\")) add(3, "ubisoft");

  if (HasModule(process, L"unityplayer.dll")) add(3, "unity");
  const std::wstring shippingSuffix = L"-win64-shipping.exe";  // Unreal Engine naming
  if (exe.size() > shippingSuffix.size() &&
      exe.compare(exe.size() - shippingSuffix.size(), shippingSuffix.size(), shippingSuffix) == 0) {
    add(3, "unreal");
  }
  if (HasModule(process, L"steam_api64.dll") || HasModule(process, L"steam_api.dll")) {
    add(2, "steamworks");
  }
  if (HasModule(process, L"eossdk-win64-shipping.dll")) add(2, "epicOnlineServices");

  bool xinput = false;
  for (const std::wstring& module : process.modules) {
    if (module.rfind(L"xinput", 0) == 0) xinput = true;
  }
  if (xinput) add(1, "xinput");
  if (HasModule(process, L"d3d12.dll") || HasModule(process, L"d3d11.dll") ||
      HasModule(process, L"d3d9.dll") || HasModule(process, L"vulkan-1.dll")) {
    add(1, "gpu");
  }
  if (HasModule(process, L"dinput8.dll")) guess.hints.emplace_back("directInput");
  if (HasModule(process, L"windows.gaming.input.dll")) guess.hints.emplace_back("windowsGamingInput");
  if (HasModule(process, L"gameinput.dll")) guess.hints.emplace_back("gameInput");
  if (HasModule(process, L"sdl2.dll") || HasModule(process, L"sdl3.dll")) {
    guess.hints.emplace_back("sdl");
  }
  if (borderlessFullscreen) add(1, "fullscreenWindow");

  guess.likelyGame = guess.score >= 3;
  return guess;
}

}  // namespace inputsplit::helper
