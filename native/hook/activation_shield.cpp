// activation_shield.cpp — the game's windows never hear "you lost focus".
//
// When another window becomes active, Windows *sends* (not posts) WM_ACTIVATE,
// WM_ACTIVATEAPP, WM_NCACTIVATE and WM_KILLFOCUS directly to the game's window procedure.
// Most games pause, mute or stop reading input in response. We insert our own window
// procedure in front of the game's ("subclassing") and do not forward those messages.
//
// The same procedure handles other *sent* messages that a GetMessage hook cannot see:
// WM_MOUSEACTIVATE (a click on the TV must not activate the game) and keyboard messages
// delivered by SendMessage.
//
// Origin: NoFocusLoss NewWndProc (list of swallowed messages). Improvements: all top-level
// windows of the process are covered (NoFocusLoss handled only the largest one), windows
// created later are picked up by a periodic re-scan, ANSI/Unicode windows are handled
// separately, and the original procedure is restored when isolation stops.
#include "modules.h"

#include "hook_state.h"
#include "log.h"

namespace inputsplit::hook {
namespace {

constexpr int kMaxWindows = 64;

struct Entry {
  HWND hwnd = nullptr;
  WNDPROC original = nullptr;
  bool unicode = true;
  bool inChain = false;  // our procedure is still part of the window's subclass chain
};

SRWLOCK g_lock = SRWLOCK_INIT;
Entry g_entries[kMaxWindows];

bool Lookup(HWND hwnd, Entry& out) {
  AcquireSRWLockShared(&g_lock);
  bool found = false;
  for (const Entry& entry : g_entries) {
    if (entry.hwnd == hwnd) {
      out = entry;
      found = true;
      break;
    }
  }
  ReleaseSRWLockShared(&g_lock);
  return found;
}

void Forget(HWND hwnd) {
  AcquireSRWLockExclusive(&g_lock);
  for (Entry& entry : g_entries) {
    if (entry.hwnd == hwnd) entry = Entry{};
  }
  ReleaseSRWLockExclusive(&g_lock);
}

LRESULT CALLBACK ShieldProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  Entry entry;
  if (!Lookup(hwnd, entry) || entry.original == nullptr) {
    return DefWindowProcW(hwnd, msg, wParam, lParam);  // should never happen
  }
  auto callOriginal = [&]() -> LRESULT {
    return entry.unicode ? CallWindowProcW(entry.original, hwnd, msg, wParam, lParam)
                         : CallWindowProcA(entry.original, hwnd, msg, wParam, lParam);
  };
  auto callDefault = [&]() -> LRESULT {
    return entry.unicode ? DefWindowProcW(hwnd, msg, wParam, lParam)
                         : DefWindowProcA(hwnd, msg, wParam, lParam);
  };

  if (msg == WM_NCDESTROY) {
    LRESULT result = callOriginal();
    Forget(hwnd);
    return result;
  }

  if (IsActive(proto::kFeatureActivationShield)) {
    switch (msg) {
      case WM_ACTIVATE:
        if (LOWORD(wParam) == WA_INACTIVE) {
          Count(g_counters.swallowedFocusEvents);
          return 0;
        }
        break;
      case WM_ACTIVATEAPP:
        if (wParam == FALSE) {
          Count(g_counters.swallowedFocusEvents);
          return 0;
        }
        break;
      case WM_NCACTIVATE:
        if (wParam == FALSE) {
          // Let Windows update the title bar normally, but keep the game unaware.
          Count(g_counters.swallowedFocusEvents);
          return callDefault();
        }
        break;
      case WM_KILLFOCUS:
        Count(g_counters.swallowedFocusEvents);
        return 0;
      case WM_IME_SETCONTEXT:
        if (wParam == FALSE) return 0;
        break;
      default:
        break;
    }
  }

  if (IsActive(proto::kFeatureBlockMouse)) {
    if (msg == WM_MOUSEACTIVATE) {
      Count(g_counters.blockedMouse);
      return MA_NOACTIVATEANDEAT;  // do not activate, and discard the click
    }
    if (msg == WM_SETCURSOR) return callDefault();  // the game must not hide the shared cursor
    if (IsMouseMessage(msg)) {
      Count(g_counters.blockedMouse);
      return (msg >= WM_NCMOUSEMOVE && msg <= WM_NCXBUTTONDBLCLK) ? callDefault() : 0;
    }
  }

  if (IsActive(proto::kFeatureBlockKeyboard) && IsKeyboardMessage(msg)) {
    Count(g_counters.blockedKeyboard);
    return 0;  // not even DefWindowProc: Alt+F4 typed elsewhere must never close the game
  }

  return callOriginal();
}

void Subclass(HWND hwnd) {
  bool unicode = IsWindowUnicode(hwnd) != FALSE;
  auto current = reinterpret_cast<WNDPROC>(unicode ? GetWindowLongPtrW(hwnd, GWLP_WNDPROC)
                                                   : GetWindowLongPtrA(hwnd, GWLP_WNDPROC));
  if (current == ShieldProc || current == nullptr) return;

  // Register first, so messages arriving right after SetWindowLongPtr find the entry.
  AcquireSRWLockExclusive(&g_lock);
  Entry* slot = nullptr;
  for (Entry& entry : g_entries) {
    if (entry.hwnd == hwnd) slot = &entry;
  }
  if (slot == nullptr) {
    for (Entry& entry : g_entries) {
      if (entry.hwnd == nullptr || !IsWindow(entry.hwnd)) {
        entry = Entry{};
        slot = &entry;
        break;
      }
    }
  }
  if (slot != nullptr) {
    slot->hwnd = hwnd;
    slot->original = current;
    slot->unicode = unicode;
    slot->inChain = true;
  }
  ReleaseSRWLockExclusive(&g_lock);

  if (slot == nullptr) {
    Log(LogLevel::Warn, "Too many windows to protect; skipping one");
    return;
  }

  LONG_PTR previous = unicode
      ? SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&ShieldProc))
      : SetWindowLongPtrA(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&ShieldProc));
  if (previous == 0) {
    Log(LogLevel::Warn, "SetWindowLongPtr failed (error %lu)", GetLastError());
    Forget(hwnd);
  }
}

struct EnumContext {
  DWORD pid;
  HWND game;
};

BOOL CALLBACK SubclassCallback(HWND hwnd, LPARAM param) {
  auto* context = reinterpret_cast<EnumContext*>(param);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid == context->pid && (hwnd == context->game || IsWindowVisible(hwnd))) Subclass(hwnd);
  return TRUE;
}

struct LargestContext {
  DWORD pid;
  HWND best;
  long long bestArea;
};

BOOL CALLBACK LargestCallback(HWND hwnd, LPARAM param) {
  auto* context = reinterpret_cast<LargestContext*>(param);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != context->pid || !IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr) {
    return TRUE;
  }
  RECT rect{};
  GetWindowRect(hwnd, &rect);
  long long area = static_cast<long long>(rect.right - rect.left) * (rect.bottom - rect.top);
  if (area > context->bestArea) {
    context->bestArea = area;
    context->best = hwnd;
  }
  return TRUE;
}

}  // namespace

void SyncShield(bool wanted) {
  if (wanted) {
    EnumContext context{GetCurrentProcessId(), GameWindow()};
    EnumWindows(&SubclassCallback, reinterpret_cast<LPARAM>(&context));
    return;
  }
  // Restore original procedures where we are still at the top of the chain. If the game
  // subclassed the window after us, we stay in the chain as a pure pass-through.
  AcquireSRWLockExclusive(&g_lock);
  for (Entry& entry : g_entries) {
    if (entry.hwnd == nullptr || !entry.inChain) continue;
    if (!IsWindow(entry.hwnd)) {
      entry = Entry{};
      continue;
    }
    auto current = reinterpret_cast<WNDPROC>(entry.unicode
                                                 ? GetWindowLongPtrW(entry.hwnd, GWLP_WNDPROC)
                                                 : GetWindowLongPtrA(entry.hwnd, GWLP_WNDPROC));
    if (current == ShieldProc) {
      if (entry.unicode) {
        SetWindowLongPtrW(entry.hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(entry.original));
      } else {
        SetWindowLongPtrA(entry.hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(entry.original));
      }
      // Keep `original` so a message already inside ShieldProc can still forward it.
      entry.inChain = false;
    }
  }
  ReleaseSRWLockExclusive(&g_lock);
}

uint32_t ShieldWindowCount() {
  uint32_t count = 0;
  AcquireSRWLockShared(&g_lock);
  for (const Entry& entry : g_entries) {
    if (entry.hwnd != nullptr && entry.inChain) ++count;
  }
  ReleaseSRWLockShared(&g_lock);
  return count;
}

bool ShieldCovers(HWND hwnd) {
  Entry entry;
  return hwnd != nullptr && Lookup(hwnd, entry) && entry.inChain;
}

void WakeGame(HWND game) {
  // When the user presses "Start" in InputSplit, the game has *already* been told that it
  // lost focus and is probably paused. The shield only hides future deactivations, so the
  // game is told once that it is active again. This is a single set of posted messages,
  // not a loop (ProtoInput's FocusMessageLoop re-sends them every 5 ms).
  if (game == nullptr) return;
  // GetForegroundWindow is spoofed inside this process; GetGUIThreadInfo is not hooked and
  // tells the truth about the real foreground window.
  GUITHREADINFO info{};
  info.cbSize = sizeof(info);
  if (GetGUIThreadInfo(0, &info) && IsOwnWindow(info.hwndActive)) return;  // already in front
  PostMessageW(game, WM_ACTIVATEAPP, TRUE, 0);
  PostMessageW(game, WM_ACTIVATE, WA_ACTIVE, 0);
  PostMessageW(game, WM_SETFOCUS, 0, 0);
  Log(LogLevel::Info, "Told the game it is active again");
}

HWND FindMainWindow() {
  LargestContext context{GetCurrentProcessId(), nullptr, 0};
  EnumWindows(&LargestCallback, reinterpret_cast<LPARAM>(&context));
  return context.best;
}

}  // namespace inputsplit::hook
