// input_block.cpp — hide the shared keyboard and mouse from the game.
//
// Once the game believes it is focused (focus_spoof.cpp), it would start reacting to
// whatever the other user types or clicks. Games read keyboard/mouse in several ways, and
// each one is covered here:
//
//   1. Window messages pulled with GetMessage/PeekMessage  -> turned into WM_NULL
//   2. Polling: GetAsyncKeyState / GetKeyState / GetKeyboardState -> "nothing pressed"
//   3. Raw Input: GetRawInputData / GetRawInputBuffer -> keyboard/mouse records neutralised
//   4. Cursor polling: GetCursorPos -> frozen point in the middle of the game window
//   (5. Messages *sent* directly to the window procedure are handled in activation_shield.cpp)
//
// Origin: ProtoInput MessageFilterHook.cpp (WM_NULL trick), GetAsyncKeyStateHook.cpp,
// GetKeyStateHook.cpp, GetKeyboardStateHook.cpp, GetCursorPosHook.cpp. ProtoInput feeds the
// game *fake* input; we feed it none. Raw-record neutralisation is InputSplit's own.
#include "modules.h"

#include "hook_state.h"
#include "minhook_util.h"

namespace inputsplit::hook {
namespace {

using GetMessageFn = BOOL(WINAPI*)(LPMSG, HWND, UINT, UINT);
using PeekMessageFn = BOOL(WINAPI*)(LPMSG, HWND, UINT, UINT, UINT);
using GetAsyncKeyStateFn = SHORT(WINAPI*)(int);
using GetKeyStateFn = SHORT(WINAPI*)(int);
using GetKeyboardStateFn = BOOL(WINAPI*)(PBYTE);
using GetRawInputDataFn = UINT(WINAPI*)(HRAWINPUT, UINT, LPVOID, PUINT, UINT);
using GetRawInputBufferFn = UINT(WINAPI*)(PRAWINPUT, PUINT, UINT);
using GetCursorPosFn = BOOL(WINAPI*)(LPPOINT);

GetMessageFn g_realGetMessageW = nullptr;
GetMessageFn g_realGetMessageA = nullptr;
PeekMessageFn g_realPeekMessageW = nullptr;
PeekMessageFn g_realPeekMessageA = nullptr;
GetAsyncKeyStateFn g_realGetAsyncKeyState = nullptr;
GetKeyStateFn g_realGetKeyState = nullptr;
GetKeyboardStateFn g_realGetKeyboardState = nullptr;
GetRawInputDataFn g_realGetRawInputData = nullptr;
GetRawInputBufferFn g_realGetRawInputBuffer = nullptr;
GetCursorPosFn g_realGetCursorPos = nullptr;

bool IsMouseButtonKey(int vk) {
  return vk == VK_LBUTTON || vk == VK_RBUTTON || vk == VK_MBUTTON || vk == VK_XBUTTON1 ||
         vk == VK_XBUTTON2;
}

// Should a virtual-key query be answered with "not pressed"?
bool ShouldHideKey(int vk) {
  return IsMouseButtonKey(vk) ? IsActive(proto::kFeatureBlockMouse)
                              : IsActive(proto::kFeatureBlockKeyboard);
}

// --- 1. Message queue filtering -------------------------------------------------------

void FilterMessage(MSG* msg) {
  if (msg == nullptr) return;
  bool hide = false;
  if (IsKeyboardMessage(msg->message)) {
    hide = IsActive(proto::kFeatureBlockKeyboard);
    if (hide) Count(g_counters.blockedKeyboard);
  } else if (IsMouseMessage(msg->message)) {
    hide = IsActive(proto::kFeatureBlockMouse);
    if (hide) Count(g_counters.blockedMouse);
  }
  if (hide) {
    // Returning WM_NULL keeps the game's message loop happy (no error path) and is
    // ignored by every window procedure. Technique from ProtoInput.
    HWND target = msg->hwnd;
    ZeroMemory(msg, sizeof(MSG));
    msg->hwnd = target;
    msg->message = WM_NULL;
  }
}

BOOL WINAPI DetourGetMessageW(LPMSG msg, HWND hwnd, UINT min, UINT max) {
  BOOL result = g_realGetMessageW(msg, hwnd, min, max);
  if (result > 0) FilterMessage(msg);
  return result;
}

BOOL WINAPI DetourGetMessageA(LPMSG msg, HWND hwnd, UINT min, UINT max) {
  BOOL result = g_realGetMessageA(msg, hwnd, min, max);
  if (result > 0) FilterMessage(msg);
  return result;
}

BOOL WINAPI DetourPeekMessageW(LPMSG msg, HWND hwnd, UINT min, UINT max, UINT remove) {
  BOOL result = g_realPeekMessageW(msg, hwnd, min, max, remove);
  if (result) FilterMessage(msg);
  return result;
}

BOOL WINAPI DetourPeekMessageA(LPMSG msg, HWND hwnd, UINT min, UINT max, UINT remove) {
  BOOL result = g_realPeekMessageA(msg, hwnd, min, max, remove);
  if (result) FilterMessage(msg);
  return result;
}

// --- 2. Key state polling ---------------------------------------------------------------

SHORT WINAPI DetourGetAsyncKeyState(int vk) {
  SHORT real = g_realGetAsyncKeyState(vk);
  if (real != 0 && ShouldHideKey(vk)) {
    Count(IsMouseButtonKey(vk) ? g_counters.blockedMouse : g_counters.blockedKeyboard);
    return 0;
  }
  return real;
}

SHORT WINAPI DetourGetKeyState(int vk) {
  SHORT real = g_realGetKeyState(vk);
  if (real != 0 && ShouldHideKey(vk)) {
    return 0;  // not counted: GetAsyncKeyState already counts real presses
  }
  return real;
}

BOOL WINAPI DetourGetKeyboardState(PBYTE keys) {
  BOOL result = g_realGetKeyboardState(keys);
  if (result && keys != nullptr) {
    bool hideKeyboard = IsActive(proto::kFeatureBlockKeyboard);
    bool hideMouse = IsActive(proto::kFeatureBlockMouse);
    if (hideKeyboard || hideMouse) {
      for (int vk = 0; vk < 256; ++vk) {
        if (IsMouseButtonKey(vk) ? hideMouse : hideKeyboard) keys[vk] = 0;
      }
    }
  }
  return result;
}

// --- 3. Raw input ------------------------------------------------------------------------

// Size of the record header in a buffer. A 32-bit game on 64-bit Windows (WOW64) receives
// GetRawInputBuffer records in the 64-bit layout: the header holds two 8-byte handles, so it
// is 24 bytes instead of 16, and records are aligned to 8 bytes. GetRawInputData converts
// records to the 32-bit layout, so this only applies to the buffer.
size_t BufferHeaderSize() {
#ifdef _WIN64
  return sizeof(RAWINPUTHEADER);
#else
  static const bool wow64 = [] {
    BOOL value = FALSE;
    return IsWow64Process(GetCurrentProcess(), &value) && value;
  }();
  return wow64 ? 24 : sizeof(RAWINPUTHEADER);
#endif
}

size_t BufferAlignment() {
#ifdef _WIN64
  return 8;
#else
  return BufferHeaderSize() == 24 ? 8 : 4;
#endif
}

// Rewrites one raw record in place so that it carries no information. `body` points to the
// data that follows the header (record->data in the normal layout). HID records are counted
// as controller reads.
void NeutraliseRawRecord(RAWINPUT* record, void* body) {
  if (record->header.dwType == RIM_TYPEHID) {
    if (IsActive(proto::kFeatureXInputBackground)) Count(g_counters.rawGamepadReads);
    return;
  }
  if (record->header.dwType == RIM_TYPEKEYBOARD && IsActive(proto::kFeatureBlockKeyboard)) {
    RAWKEYBOARD& kb = *static_cast<RAWKEYBOARD*>(body);
    if (kb.VKey != 0xFF) Count(g_counters.blockedKeyboard);
    kb.MakeCode = 0;
    kb.Flags = RI_KEY_BREAK;
    kb.VKey = 0xFF;  // documented as "no virtual key" — engines skip it
    kb.Message = WM_KEYUP;
    kb.ExtraInformation = 0;
  } else if (record->header.dwType == RIM_TYPEMOUSE && IsActive(proto::kFeatureBlockMouse)) {
    RAWMOUSE& mouse = *static_cast<RAWMOUSE*>(body);
    Count(g_counters.blockedMouse);
    mouse.usFlags = MOUSE_MOVE_RELATIVE;
    mouse.usButtonFlags = 0;
    mouse.usButtonData = 0;
    mouse.ulRawButtons = 0;
    mouse.lLastX = 0;
    mouse.lLastY = 0;
    mouse.ulExtraInformation = 0;
  }
}

UINT WINAPI DetourGetRawInputData(HRAWINPUT input, UINT command, LPVOID data, PUINT size,
                                  UINT headerSize) {
  UINT result = g_realGetRawInputData(input, command, data, size, headerSize);
  if (command == RID_INPUT && data != nullptr && result != static_cast<UINT>(-1) &&
      result >= sizeof(RAWINPUTHEADER)) {
    auto* record = static_cast<RAWINPUT*>(data);
    NeutraliseRawRecord(record, &record->data);
  }
  return result;
}

// Same as the Windows NEXTRAWINPUTBLOCK macro (written out because MinGW lacks the QWORD type
// the macro relies on), with the WOW64 alignment described at BufferHeaderSize().
RAWINPUT* NextRawRecord(RAWINPUT* record) {
  const uintptr_t align = BufferAlignment() - 1;
  uintptr_t next = reinterpret_cast<uintptr_t>(record) + record->header.dwSize;
  return reinterpret_cast<RAWINPUT*>((next + align) & ~align);
}

UINT WINAPI DetourGetRawInputBuffer(PRAWINPUT data, PUINT size, UINT headerSize) {
  UINT count = g_realGetRawInputBuffer(data, size, headerSize);
  if (data != nullptr && count != static_cast<UINT>(-1)) {
    RAWINPUT* record = data;
    const size_t headerSize = BufferHeaderSize();
    for (UINT i = 0; i < count; ++i) {
      NeutraliseRawRecord(record, reinterpret_cast<BYTE*>(record) + headerSize);
      record = NextRawRecord(record);
    }
  }
  return count;
}

// --- 4. Cursor position -------------------------------------------------------------------

BOOL WINAPI DetourGetCursorPos(LPPOINT point) {
  if (point != nullptr && IsActive(proto::kFeatureBlockMouse)) {
    HWND game = GameWindow();
    RECT client{};
    if (game != nullptr && GetClientRect(game, &client)) {
      // A fixed point: camera code that measures cursor movement sees none.
      point->x = (client.right - client.left) / 2;
      point->y = (client.bottom - client.top) / 2;
      ClientToScreen(game, point);
      return TRUE;
    }
  }
  return g_realGetCursorPos(point);
}

}  // namespace

bool IsKeyboardMessage(UINT message) {
  return message >= WM_KEYFIRST && message <= WM_KEYLAST;
}

bool IsMouseMessage(UINT message) {
  return (message >= WM_MOUSEFIRST && message <= WM_MOUSELAST) ||
         (message >= WM_NCMOUSEMOVE && message <= WM_NCXBUTTONDBLCLK) ||
         message == WM_MOUSEHOVER || message == WM_MOUSELEAVE || message == WM_NCMOUSEHOVER ||
         message == WM_NCMOUSELEAVE;
}

bool InstallInputBlockHooks() {
  static bool installed = false;
  if (installed) return true;
  const wchar_t* user32 = L"user32.dll";
  bool ok =
      CreateApiHook(user32, "GetMessageW", &DetourGetMessageW, &g_realGetMessageW) &&
      CreateApiHook(user32, "GetMessageA", &DetourGetMessageA, &g_realGetMessageA) &&
      CreateApiHook(user32, "PeekMessageW", &DetourPeekMessageW, &g_realPeekMessageW) &&
      CreateApiHook(user32, "PeekMessageA", &DetourPeekMessageA, &g_realPeekMessageA) &&
      CreateApiHook(user32, "GetAsyncKeyState", &DetourGetAsyncKeyState, &g_realGetAsyncKeyState) &&
      CreateApiHook(user32, "GetKeyState", &DetourGetKeyState, &g_realGetKeyState) &&
      CreateApiHook(user32, "GetKeyboardState", &DetourGetKeyboardState, &g_realGetKeyboardState) &&
      CreateApiHook(user32, "GetRawInputData", &DetourGetRawInputData, &g_realGetRawInputData) &&
      CreateApiHook(user32, "GetRawInputBuffer", &DetourGetRawInputBuffer, &g_realGetRawInputBuffer) &&
      CreateApiHook(user32, "GetCursorPos", &DetourGetCursorPos, &g_realGetCursorPos) &&
      ApplyQueuedHooks();
  installed = ok;
  return ok;
}

}  // namespace inputsplit::hook
