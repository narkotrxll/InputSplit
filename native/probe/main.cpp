// InputSplitProbe.exe — a tiny "game" that shows exactly what a game sees.
//
// It behaves like a typical game:
//   * pauses when it thinks it lost focus (WM_ACTIVATEAPP / WM_ACTIVATE / foreground check),
//   * calls XInputEnable(FALSE) when deactivated (old XInput games do this),
//   * polls XInput user index 0 every frame,
//   * reads keyboard and mouse through messages, GetAsyncKeyState, Raw Input (with
//     RIDEV_INPUTSINK, i.e. even in background) and GetCursorPos,
//   * optionally (--fps-cursor) re-centres and confines the cursor like a shooter.
//
// Every number on screen is also appended once per second to %TEMP%\InputSplitProbe.log,
// so test results can be attached to bug reports and docs/COMPATIBILITY.md.
//
// "Really in background" is measured with GetGUIThreadInfo, which InputSplit does not hook,
// so the probe can tell the truth even while its focus queries are being spoofed.
//
// Flags:
//   --always-poll        read XInput even while paused, never call XInputEnable: measures
//                        whether Windows itself delivers controller input in background (E1)
//   --no-xinput-enable   do not call XInputEnable on focus changes
//   --fps-cursor         grab the cursor with SetCursorPos/ClipCursor while "focused"
#include <windows.h>
#include <xinput.h>

#include <cstdio>
#include <cwchar>
#include <string>

namespace {

using XInputGetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_STATE*);
using XInputEnableFn = void(WINAPI*)(BOOL);

XInputGetStateFn g_xinputGetState = nullptr;
XInputEnableFn g_xinputEnable = nullptr;

bool g_useXInputEnable = true;
bool g_fpsCursor = false;
bool g_alwaysPoll = false;

struct Stats {
  // Focus as reported to the game
  bool believesActive = true;  // from WM_ACTIVATEAPP / WM_ACTIVATE
  unsigned deactivateAppMsgs = 0;
  unsigned deactivateMsgs = 0;
  unsigned killFocusMsgs = 0;
  unsigned mouseActivateMsgs = 0;
  // XInput
  bool padConnected = false;
  DWORD lastPacket = 0;
  unsigned packetsTotal = 0;
  unsigned packetsInBackground = 0;
  XINPUT_GAMEPAD pad{};
  // Keyboard leaks
  unsigned keyMessages = 0;
  unsigned charMessages = 0;
  unsigned asyncKeyPresses = 0;
  unsigned rawKeyboard = 0;
  // Mouse leaks
  unsigned mouseMoveMessages = 0;
  unsigned mouseClickMessages = 0;
  unsigned rawMouse = 0;
  unsigned cursorPosChanges = 0;
  // Frames
  unsigned framesRunning = 0;
  unsigned framesPaused = 0;
} g;

bool g_asyncDown[256] = {};
POINT g_lastCursor{};
wchar_t g_logPath[MAX_PATH];
FILE* g_log = nullptr;

bool ReallyInBackground(HWND self) {
  GUITHREADINFO info{};
  info.cbSize = sizeof(info);
  if (!GetGUIThreadInfo(0, &info)) return false;
  return info.hwndActive != self;
}

bool GameThinksFocused(HWND self) {
  // Typical engine check: our own activation state AND "is the foreground window mine?".
  return g.believesActive && GetForegroundWindow() == self;
}

void LoadXInput() {
  HMODULE module = LoadLibraryW(L"xinput1_4.dll");
  if (module == nullptr) module = LoadLibraryW(L"xinput9_1_0.dll");
  if (module == nullptr) return;
  g_xinputGetState = reinterpret_cast<XInputGetStateFn>(GetProcAddress(module, "XInputGetState"));
  g_xinputEnable = reinterpret_cast<XInputEnableFn>(GetProcAddress(module, "XInputEnable"));
}

void RegisterRawInput(HWND hwnd) {
  RAWINPUTDEVICE devices[2]{};
  devices[0].usUsagePage = 0x01;  // generic desktop
  devices[0].usUsage = 0x06;      // keyboard
  devices[0].dwFlags = RIDEV_INPUTSINK;
  devices[0].hwndTarget = hwnd;
  devices[1].usUsagePage = 0x01;
  devices[1].usUsage = 0x02;  // mouse
  devices[1].dwFlags = RIDEV_INPUTSINK;
  devices[1].hwndTarget = hwnd;
  RegisterRawInputDevices(devices, 2, sizeof(RAWINPUTDEVICE));
}

void OnRawInput(LPARAM lParam) {
  RAWINPUT record{};
  UINT size = sizeof(record);
  if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, &record, &size,
                      sizeof(RAWINPUTHEADER)) == static_cast<UINT>(-1)) {
    return;
  }
  if (record.header.dwType == RIM_TYPEKEYBOARD) {
    if (record.data.keyboard.VKey != 0xFF && !(record.data.keyboard.Flags & RI_KEY_BREAK)) {
      ++g.rawKeyboard;
    }
  } else if (record.header.dwType == RIM_TYPEMOUSE) {
    const RAWMOUSE& mouse = record.data.mouse;
    if (mouse.lLastX != 0 || mouse.lLastY != 0 || mouse.usButtonFlags != 0) ++g.rawMouse;
  }
}

void Frame(HWND hwnd) {
  bool background = ReallyInBackground(hwnd);
  bool focused = GameThinksFocused(hwnd);
  (focused ? g.framesRunning : g.framesPaused)++;

  // Controller: a real game would read it only while "running".
  if (g_xinputGetState != nullptr && (focused || g_alwaysPoll)) {
    XINPUT_STATE state{};
    g.padConnected = g_xinputGetState(0, &state) == ERROR_SUCCESS;
    if (g.padConnected && state.dwPacketNumber != g.lastPacket) {
      g.lastPacket = state.dwPacketNumber;
      ++g.packetsTotal;
      if (background) ++g.packetsInBackground;
    }
    g.pad = state.Gamepad;
  }

  // Keyboard polling (what many engines do every frame).
  for (int vk = 0x08; vk <= 0xFE; ++vk) {
    if (vk >= VK_LBUTTON && vk <= VK_XBUTTON2) continue;
    bool down = (GetAsyncKeyState(vk) & 0x8000) != 0;
    if (down && !g_asyncDown[vk]) ++g.asyncKeyPresses;
    g_asyncDown[vk] = down;
  }

  POINT cursor{};
  GetCursorPos(&cursor);
  if (cursor.x != g_lastCursor.x || cursor.y != g_lastCursor.y) ++g.cursorPosChanges;
  g_lastCursor = cursor;

  if (g_fpsCursor && focused) {
    RECT client{};
    GetClientRect(hwnd, &client);
    POINT center{(client.right - client.left) / 2, (client.bottom - client.top) / 2};
    ClientToScreen(hwnd, &center);
    RECT clip = client;
    MapWindowPoints(hwnd, nullptr, reinterpret_cast<POINT*>(&clip), 2);
    ClipCursor(&clip);
    SetCursorPos(center.x, center.y);
    g_lastCursor = center;
  }
}

std::wstring StatusText(HWND hwnd) {
  bool background = ReallyInBackground(hwnd);
  bool focused = GameThinksFocused(hwnd);
  wchar_t text[4096];
  swprintf(text, 4096,
           L"InputSplit Probe  —  %ls\n"
           L"Window is really %ls (GetGUIThreadInfo)\n\n"
           L"FOCUS AS SEEN BY THE GAME\n"
           L"  believes active (messages): %ls\n"
           L"  GetForegroundWindow() == me: %ls\n"
           L"  WM_ACTIVATEAPP(FALSE): %u   WM_ACTIVATE(INACTIVE): %u   WM_KILLFOCUS: %u\n"
           L"  WM_MOUSEACTIVATE: %u\n"
           L"  frames running: %u   frames paused: %u\n\n"
           L"CONTROLLER (XInput user index 0)\n"
           L"  connected: %ls   packet: %lu\n"
           L"  packets seen: %u   of them while really in background: %u\n"
           L"  LX %6d  LY %6d  RX %6d  RY %6d  LT %3u  RT %3u  buttons 0x%04X\n\n"
           L"KEYBOARD THAT REACHED THE GAME (should stay 0 while isolated)\n"
           L"  key messages: %u   char messages: %u\n"
           L"  GetAsyncKeyState presses: %u   raw keyboard records: %u\n\n"
           L"MOUSE THAT REACHED THE GAME (should stay 0 while isolated)\n"
           L"  move messages: %u   click messages: %u   raw mouse records: %u\n"
           L"  GetCursorPos changes: %u\n\n"
           L"Options: XInputEnable on focus change = %ls, FPS cursor grab = %ls, always poll = %ls\n"
           L"Log: %ls\n"
           L"Press R (while this window is really focused) to reset counters.",
           focused ? L"RUNNING" : L"PAUSED (thinks it lost focus)",
           background ? L"IN BACKGROUND" : L"FOCUSED", g.believesActive ? L"yes" : L"no",
           GetForegroundWindow() == hwnd ? L"yes" : L"no", g.deactivateAppMsgs, g.deactivateMsgs,
           g.killFocusMsgs, g.mouseActivateMsgs, g.framesRunning, g.framesPaused,
           g.padConnected ? L"yes" : L"no", g.lastPacket, g.packetsTotal, g.packetsInBackground,
           g.pad.sThumbLX, g.pad.sThumbLY, g.pad.sThumbRX, g.pad.sThumbRY, g.pad.bLeftTrigger,
           g.pad.bRightTrigger, g.pad.wButtons, g.keyMessages, g.charMessages, g.asyncKeyPresses,
           g.rawKeyboard, g.mouseMoveMessages, g.mouseClickMessages, g.rawMouse,
           g.cursorPosChanges, g_useXInputEnable ? L"on" : L"off", g_fpsCursor ? L"on" : L"off",
           g_alwaysPoll ? L"on" : L"off", g_logPath);
  return text;
}

void WriteLogLine(HWND hwnd) {
  if (g_log == nullptr) return;
  SYSTEMTIME time;
  GetLocalTime(&time);
  fprintf(g_log,
          "%02d:%02d:%02d background=%d running=%d deactivateApp=%u deactivate=%u killFocus=%u "
          "mouseActivate=%u padConnected=%d packets=%u packetsBackground=%u keyMsgs=%u "
          "charMsgs=%u asyncPresses=%u rawKb=%u mouseMoves=%u mouseClicks=%u rawMouse=%u "
          "cursorChanges=%u\n",
          time.wHour, time.wMinute, time.wSecond, ReallyInBackground(hwnd) ? 1 : 0,
          GameThinksFocused(hwnd) ? 1 : 0, g.deactivateAppMsgs, g.deactivateMsgs, g.killFocusMsgs,
          g.mouseActivateMsgs, g.padConnected ? 1 : 0, g.packetsTotal, g.packetsInBackground,
          g.keyMessages, g.charMessages, g.asyncKeyPresses, g.rawKeyboard, g.mouseMoveMessages,
          g.mouseClickMessages, g.rawMouse, g.cursorPosChanges);
  fflush(g_log);
}

LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_CREATE:
      RegisterRawInput(hwnd);
      SetTimer(hwnd, 1, 16, nullptr);    // ~60 "frames" per second
      SetTimer(hwnd, 2, 1000, nullptr);  // log line
      return 0;
    case WM_TIMER:
      if (wParam == 1) {
        Frame(hwnd);
        InvalidateRect(hwnd, nullptr, FALSE);
      } else {
        WriteLogLine(hwnd);
      }
      return 0;
    case WM_ACTIVATEAPP:
      if (!wParam) ++g.deactivateAppMsgs;
      g.believesActive = wParam != FALSE;
      if (g_useXInputEnable && g_xinputEnable != nullptr) g_xinputEnable(wParam ? TRUE : FALSE);
      if (!wParam) ClipCursor(nullptr);  // well-behaved games release the cursor here
      break;
    case WM_ACTIVATE:
      if (LOWORD(wParam) == WA_INACTIVE) {
        ++g.deactivateMsgs;
        g.believesActive = false;
      } else {
        g.believesActive = true;
      }
      break;
    case WM_KILLFOCUS:
      ++g.killFocusMsgs;
      break;
    case WM_MOUSEACTIVATE:
      ++g.mouseActivateMsgs;
      break;
    case WM_INPUT:
      OnRawInput(lParam);
      break;  // DefWindowProc must still run for WM_INPUT
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
      ++g.keyMessages;
      if (wParam == 'R' && !ReallyInBackground(hwnd)) {
        g = Stats{};
        g.believesActive = true;
      }
      if (wParam == VK_ESCAPE) {
        g_fpsCursor = false;
        ClipCursor(nullptr);
      }
      break;
    case WM_CHAR:
      ++g.charMessages;
      return 0;
    case WM_MOUSEMOVE:
      ++g.mouseMoveMessages;
      return 0;
    case WM_LBUTTONDOWN:
    case WM_RBUTTONDOWN:
    case WM_MBUTTONDOWN:
      ++g.mouseClickMessages;
      return 0;
    case WM_PAINT: {
      PAINTSTRUCT paint;
      HDC dc = BeginPaint(hwnd, &paint);
      RECT client;
      GetClientRect(hwnd, &client);
      // Double-buffered so the 60 Hz redraw does not flicker.
      HDC memory = CreateCompatibleDC(dc);
      HBITMAP bitmap = CreateCompatibleBitmap(dc, client.right, client.bottom);
      HGDIOBJ oldBitmap = SelectObject(memory, bitmap);
      bool running = GameThinksFocused(hwnd);
      HBRUSH background = CreateSolidBrush(running ? RGB(16, 40, 28) : RGB(48, 20, 20));
      FillRect(memory, &client, background);
      DeleteObject(background);
      HFONT font = CreateFontW(-16, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, 0, 0,
                               CLEARTYPE_QUALITY, FIXED_PITCH, L"Consolas");
      HGDIOBJ oldFont = SelectObject(memory, font);
      SetBkMode(memory, TRANSPARENT);
      SetTextColor(memory, RGB(230, 232, 235));
      RECT textRect{20, 16, client.right - 20, client.bottom - 16};
      std::wstring text = StatusText(hwnd);
      DrawTextW(memory, text.c_str(), -1, &textRect, DT_LEFT | DT_TOP | DT_NOPREFIX);
      BitBlt(dc, 0, 0, client.right, client.bottom, memory, 0, 0, SRCCOPY);
      SelectObject(memory, oldFont);
      DeleteObject(font);
      SelectObject(memory, oldBitmap);
      DeleteObject(bitmap);
      DeleteDC(memory);
      EndPaint(hwnd, &paint);
      return 0;
    }
    case WM_ERASEBKGND:
      return 1;
    case WM_DESTROY:
      ClipCursor(nullptr);
      PostQuitMessage(0);
      return 0;
    default:
      break;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR commandLine, int show) {
  if (wcsstr(commandLine, L"--no-xinput-enable") != nullptr) g_useXInputEnable = false;
  if (wcsstr(commandLine, L"--fps-cursor") != nullptr) g_fpsCursor = true;
  if (wcsstr(commandLine, L"--always-poll") != nullptr) {
    g_alwaysPoll = true;
    g_useXInputEnable = false;
  }
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  LoadXInput();

  wchar_t temp[MAX_PATH];
  GetTempPathW(MAX_PATH, temp);
  swprintf(g_logPath, MAX_PATH, L"%lsInputSplitProbe.log", temp);
  g_log = _wfopen(g_logPath, L"a");
  if (g_log != nullptr) fprintf(g_log, "--- probe started (pid %lu) ---\n", GetCurrentProcessId());

  WNDCLASSW windowClass{};
  windowClass.lpfnWndProc = WindowProc;
  windowClass.hInstance = instance;
  windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  windowClass.lpszClassName = L"InputSplitProbe";
  RegisterClassW(&windowClass);
  HWND hwnd = CreateWindowExW(0, windowClass.lpszClassName, L"InputSplit Probe",
                              WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 900, 640, nullptr,
                              nullptr, instance, nullptr);
  ShowWindow(hwnd, show);

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  if (g_log != nullptr) fclose(g_log);
  return 0;
}
