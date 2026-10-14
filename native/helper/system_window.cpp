#include "system_window.h"

#include <windows.h>

#include <atomic>
#include <thread>

#include "displays.h"
#include "rpc.h"
#include "session.h"

namespace inputsplit::helper {
namespace {

constexpr int kHotkeyId = 1;
constexpr UINT kMsgSetHotkey = WM_APP + 1;  // wParam: 1 register, 0 unregister

std::atomic<HWND> g_window{nullptr};
std::thread g_thread;
bool g_hotkeyRegistered = false;  // only touched on the window thread

LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case kMsgSetHotkey:
      if (wParam != 0 && !g_hotkeyRegistered) {
        g_hotkeyRegistered = RegisterHotKey(hwnd, kHotkeyId,
                                            MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                                            'Q') != FALSE;
      } else if (wParam == 0 && g_hotkeyRegistered) {
        UnregisterHotKey(hwnd, kHotkeyId);
        g_hotkeyRegistered = false;
      }
      return g_hotkeyRegistered ? 1 : 0;

    case WM_HOTKEY:
      if (wParam == kHotkeyId) {
        // Handled here, not in the UI: works even when the UI is frozen.
        std::thread([] {
          int stopped = SessionManager::Instance().StopAll("emergencyStop", 2000);
          SendEvent("emergencyStop", Json{{"stoppedSessions", stopped}});
        }).detach();
      }
      return 0;

    case WM_DISPLAYCHANGE:
      SendEvent("displaysChanged", ListDisplays());
      return 0;

    case WM_DESTROY:
      if (g_hotkeyRegistered) UnregisterHotKey(hwnd, kHotkeyId);
      g_hotkeyRegistered = false;
      PostQuitMessage(0);
      return 0;

    default:
      return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

void Run(HANDLE ready) {
  WNDCLASSW windowClass{};
  windowClass.lpfnWndProc = WindowProc;
  windowClass.hInstance = GetModuleHandleW(nullptr);
  windowClass.lpszClassName = L"InputSplitHelperWindow";
  RegisterClassW(&windowClass);
  // A real (never shown) top-level window: message-only windows do not receive broadcasts
  // such as WM_DISPLAYCHANGE.
  HWND hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, windowClass.lpszClassName, L"InputSplit Helper",
                              WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, windowClass.hInstance, nullptr);
  g_window.store(hwnd);
  if (hwnd == nullptr) {
    LogEvent("warn", "CreateWindowEx failed with error " + std::to_string(GetLastError()));
  }
  SetEvent(ready);
  if (hwnd == nullptr) return;
  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  g_window.store(nullptr);
}

}  // namespace

bool StartSystemWindow() {
  HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  g_thread = std::thread(Run, ready);
  WaitForSingleObject(ready, 5000);
  CloseHandle(ready);
  return g_window.load() != nullptr;
}

void StopSystemWindow() {
  HWND hwnd = g_window.load();
  if (hwnd != nullptr) PostMessageW(hwnd, WM_CLOSE, 0, 0);
  if (g_thread.joinable()) g_thread.join();
}

bool SetEmergencyHotkey(bool enabled) {
  HWND hwnd = g_window.load();
  if (hwnd == nullptr) return false;
  DWORD_PTR result = 0;
  SendMessageTimeoutW(hwnd, kMsgSetHotkey, enabled ? 1 : 0, 0, SMTO_ABORTIFHUNG, 2000, &result);
  return result != 0;
}

const char* EmergencyHotkeyLabel() {
  return "Ctrl+Alt+Shift+Q";
}

}  // namespace inputsplit::helper
