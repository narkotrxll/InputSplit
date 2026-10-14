// windows_enum.cpp — the list of windows the user can choose a game from.
#include "windows_enum.h"

#include <dwmapi.h>

#include <map>
#include <set>

#include "process_info.h"
#include "util.h"

namespace inputsplit::helper {
namespace {

struct Candidate {
  HWND hwnd;
  DWORD pid;
};

bool IsCloaked(HWND hwnd) {
  // Windows 10 "cloaks" windows of suspended UWP apps and other virtual desktops: they are
  // visible to EnumWindows but not to the user.
  DWORD cloaked = 0;
  return SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) &&
         cloaked != 0;
}

bool IsUserFacingWindow(HWND hwnd) {
  if (!IsWindowVisible(hwnd) || IsCloaked(hwnd)) return false;
  if (GetWindow(hwnd, GW_OWNER) != nullptr) return false;
  LONG_PTR exStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if (exStyle & WS_EX_TOOLWINDOW) return false;
  if (GetWindowTextLengthW(hwnd) == 0) return false;
  wchar_t className[64];
  GetClassNameW(hwnd, className, 64);
  static const wchar_t* const kShellClasses[] = {L"Progman", L"WorkerW", L"Shell_TrayWnd",
                                                 L"Shell_SecondaryTrayWnd"};
  for (const wchar_t* shellClass : kShellClasses) {
    if (wcscmp(className, shellClass) == 0) return false;
  }
  return true;
}

BOOL CALLBACK Collect(HWND hwnd, LPARAM param) {
  auto* out = reinterpret_cast<std::vector<Candidate>*>(param);
  if (!IsUserFacingWindow(hwnd)) return TRUE;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  out->push_back({hwnd, pid});
  return TRUE;
}

// A window without caption that exactly covers its monitor: typical "borderless fullscreen".
bool IsBorderlessFullscreen(HWND hwnd, const RECT& rect, std::wstring& monitorName) {
  HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  MONITORINFOEXW info{};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfoW(monitor, &info)) return false;
  monitorName = info.szDevice;
  LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  return (style & WS_CAPTION) != WS_CAPTION && EqualRect(&rect, &info.rcMonitor);
}

}  // namespace

Json RectToJson(const RECT& rect) {
  return Json{{"x", rect.left},
              {"y", rect.top},
              {"width", rect.right - rect.left},
              {"height", rect.bottom - rect.top}};
}

Json ListWindows(const std::set<DWORD>& excludedPids) {
  std::vector<Candidate> candidates;
  EnumWindows(&Collect, reinterpret_cast<LPARAM>(&candidates));

  const DWORD selfPid = GetCurrentProcessId();
  HWND foreground = GetForegroundWindow();
  std::map<DWORD, ProcessDetails> processes;  // one query per process, not per window

  Json windows = Json::array();
  for (const Candidate& candidate : candidates) {
    if (candidate.pid == selfPid || excludedPids.count(candidate.pid) != 0) continue;

    auto it = processes.find(candidate.pid);
    if (it == processes.end()) {
      it = processes.emplace(candidate.pid, QueryProcess(candidate.pid, true)).first;
    }
    const ProcessDetails& process = it->second;

    wchar_t title[512];
    GetWindowTextW(candidate.hwnd, title, 512);
    wchar_t className[256];
    GetClassNameW(candidate.hwnd, className, 256);
    RECT rect{};
    GetWindowRect(candidate.hwnd, &rect);
    std::wstring monitorName;
    bool borderless = IsBorderlessFullscreen(candidate.hwnd, rect, monitorName);
    GameGuess guess = GuessGame(process, borderless);

    windows.push_back(Json{
        {"hwnd", reinterpret_cast<uint64_t>(candidate.hwnd)},
        {"title", ToUtf8(title)},
        {"className", ToUtf8(className)},
        {"pid", candidate.pid},
        {"exePath", process.exePath.empty() ? Json(nullptr) : Json(ToUtf8(process.exePath))},
        {"exeName", ToUtf8(process.exeName)},
        {"architecture", ArchitectureName(process.architecture)},
        {"accessible", process.canInject},
        {"elevated", process.elevated},
        {"isMinimized", IsIconic(candidate.hwnd) != FALSE},
        {"isForeground", candidate.hwnd == foreground},
        {"rect", RectToJson(rect)},
        {"monitor", ToUtf8(monitorName)},
        {"gameScore", guess.score},
        {"isLikelyGame", guess.likelyGame},
        {"hints", guess.hints},
    });
  }
  return Json{{"windows", windows}};
}

}  // namespace inputsplit::helper
