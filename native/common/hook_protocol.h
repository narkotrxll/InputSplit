// hook_protocol.h — binary protocol between inputsplit-helper.exe and InputSplitHook.dll.
//
// Why binary and not JSON? The DLL runs inside a game. We keep it tiny and free of
// parsers/allocations: every message is a fixed-size struct with a common header.
//
// Transport: a message-mode named pipe "\\.\pipe\InputSplit.Hook.<gamePid>".
// The helper is the pipe server, the DLL is the client.
//
// For TypeScript readers: think of each struct as an interface whose layout is fixed in
// memory. `static_assert`s at the bottom guarantee that the 64-bit helper and both DLLs
// (InputSplitHook64.dll and InputSplitHook32.dll) agree on sizes.
#pragma once

#include <cstdint>

namespace inputsplit::proto {

constexpr uint32_t kMagic = 0x4C505349;  // "ISPL" in little-endian
constexpr uint16_t kProtocolVersion = 3;  // 2: DirectInput / Raw Input counters, 3: frame stats

// Pipe name prefix; the game PID (decimal) is appended.
constexpr wchar_t kPipePrefix[] = L"\\\\.\\pipe\\InputSplit.Hook.";

enum class MessageType : uint16_t {
  Hello = 1,      // DLL -> helper, once after connecting
  Configure = 2,  // helper -> DLL, apply a feature set (also used to change it)
  Disable = 3,    // helper -> DLL, turn everything off (pass-through)
  Status = 4,     // DLL -> helper, after every Configure/Disable and every second
  Log = 5,        // DLL -> helper, diagnostic text
  FrameStats = 6, // helper -> DLL, start or stop measuring frames (the FPS overlay)
};

// Features that the helper can request. Bit flags, combine with |.
enum Feature : uint32_t {
  kFeatureNone = 0,
  kFeatureActivationShield = 1u << 0,  // swallow "you lost focus" window messages
  kFeatureFocusSpoof = 1u << 1,        // GetForegroundWindow & co. return the game window
  kFeatureXInputBackground = 1u << 2,  // controller in background: XInput (required), plus
                                       // DirectInput and Raw Input HID gamepads (best effort)
  kFeatureXInputSlotLock = 1u << 3,    // game's controller #1 = chosen physical slot
  kFeatureBlockKeyboard = 1u << 4,     // game cannot see keyboard input
  kFeatureBlockMouse = 1u << 5,        // game cannot see mouse input, clicks do not activate it
  kFeatureCursorGuard = 1u << 6,       // game cannot move or confine the shared cursor
};
constexpr uint32_t kAllFeatures = (1u << 7) - 1;

// Input/engine APIs detected in the game process (GetModuleHandle checks).
enum DetectedApi : uint32_t {
  kApiXInput = 1u << 0,              // an xinput*.dll was loaded by the game itself
  kApiDirectInput8 = 1u << 1,        // dinput8.dll
  kApiWindowsGamingInput = 1u << 2,  // Windows.Gaming.Input.dll (needs focus by design)
  kApiGameInput = 1u << 3,           // GameInput.dll (no background input by default)
  kApiSdl2 = 1u << 4,
  kApiSdl3 = 1u << 5,
  kApiUnity = 1u << 6,     // UnityPlayer.dll
  kApiSteamApi = 1u << 7,  // steam_api64.dll / steam_api.dll
};

// Present calls the DLL could hook to count frames (StatusMessage::frameApis).
enum FrameApi : uint32_t {
  kFrameApiDxgi = 1u << 0,    // IDXGISwapChain::Present / Present1 (Direct3D 10, 11, 12)
  kFrameApiD3d9 = 1u << 1,    // IDirect3DDevice9::Present, IDirect3DSwapChain9::Present
  kFrameApiOpenGl = 1u << 2,  // wglSwapBuffers
  kFrameApiVulkan = 1u << 3,  // vkQueuePresentKHR exported by vulkan-1.dll (not every game)
};

constexpr uint32_t kNoSlot = 0xFFFFFFFFu;

#pragma pack(push, 8)

struct Header {
  uint32_t magic;
  uint16_t version;
  uint16_t type;  // MessageType
  uint32_t size;  // total size of the message including this header
  uint32_t reserved;
};

struct HelloMessage {
  Header header;
  uint32_t pid;
  uint32_t architectureBits;  // 64 or 32
  uint32_t detectedApis;      // DetectedApi bits seen before we touched anything
  uint32_t reserved;
  uint64_t dllBuildId;        // INPUTSPLIT_BUILD_ID, to detect stale DLLs
};

struct ConfigureMessage {
  Header header;
  uint32_t features;      // Feature bits requested
  uint32_t xinputSlot;    // 0..3, or kNoSlot
  uint64_t gameWindow;    // HWND chosen in the UI (0 = auto-detect)
};

struct DisableMessage {
  Header header;
};

struct FrameStatsMessage {
  Header header;
  uint32_t enabled;  // 1: hook the game's Present calls (once) and measure; 0: stop measuring
  uint32_t reserved;
};

struct StatusMessage {
  Header header;
  uint32_t requested;  // Feature bits currently requested
  uint32_t active;     // Feature bits confirmed working
  uint32_t failed;     // Feature bits that could not be applied
  uint32_t detectedApis;
  uint64_t gameWindow;  // HWND the DLL treats as "the game window"
  uint32_t subclassedWindows;
  uint32_t xinputSlot;
  // Cumulative counters since the DLL was attached.
  uint64_t xinputReads;           // XInputGetState/Ex calls by the game
  uint64_t blockedKeyboard;       // keyboard messages / raw records / key-state queries hidden
  uint64_t blockedMouse;          // mouse messages / raw records hidden
  uint64_t swallowedFocusEvents;  // deactivation messages not delivered to the game
  uint64_t blockedCursorCalls;    // SetCursorPos / ClipCursor calls ignored
  uint64_t xinputEnableBlocked;   // XInputEnable(FALSE) calls ignored
  uint64_t directInputReads;      // GetDeviceState/GetDeviceData calls on DirectInput controllers
  uint64_t rawGamepadReads;       // Raw Input records from HID controllers read by the game
  // Frame stats (only counted while the helper asked for them, see FrameStatsMessage).
  uint64_t timeUs;               // monotonic clock of this message, microseconds
  uint64_t frames;               // Present calls counted
  uint64_t inputLatencySumUs;    // sum of "controller read with new input -> next Present"
  uint64_t inputLatencySamples;  // number of such measurements
  uint32_t worstFrameUs;         // longest gap between two Present calls since the last STATUS
  uint32_t worstInputLatencyUs;  // longest input -> Present time since the last STATUS
  uint32_t frameStatsEnabled;    // 1 while measuring
  uint32_t frameApis;            // FrameApi bits that were hooked
};

struct LogMessage {
  Header header;
  uint32_t level;  // 0 debug, 1 info, 2 warn, 3 error
  uint32_t reserved;
  char text[480];  // UTF-8, zero-terminated
};

#pragma pack(pop)

static_assert(sizeof(Header) == 16, "Header layout changed");
static_assert(sizeof(HelloMessage) == 40, "HelloMessage layout changed");
static_assert(sizeof(ConfigureMessage) == 32, "ConfigureMessage layout changed");
static_assert(sizeof(FrameStatsMessage) == 24, "FrameStatsMessage layout changed");
static_assert(sizeof(StatusMessage) == 160, "StatusMessage layout changed");
static_assert(sizeof(LogMessage) == 504, "LogMessage layout changed");

// The largest message; used as the receive buffer size.
constexpr uint32_t kMaxMessageSize = sizeof(LogMessage);

template <typename T>
inline T MakeMessage(MessageType type) {
  T message{};
  message.header.magic = kMagic;
  message.header.version = kProtocolVersion;
  message.header.type = static_cast<uint16_t>(type);
  message.header.size = sizeof(T);
  return message;
}

// Validates a received buffer. Returns the message type, or 0 if invalid.
inline uint16_t ValidateMessage(const void* data, uint32_t bytes) {
  if (bytes < sizeof(Header)) return 0;
  const auto* header = static_cast<const Header*>(data);
  if (header->magic != kMagic || header->version != kProtocolVersion) return 0;
  if (header->size != bytes) return 0;
  switch (static_cast<MessageType>(header->type)) {
    case MessageType::Hello: return bytes == sizeof(HelloMessage) ? header->type : 0;
    case MessageType::Configure: return bytes == sizeof(ConfigureMessage) ? header->type : 0;
    case MessageType::Disable: return bytes == sizeof(DisableMessage) ? header->type : 0;
    case MessageType::Status: return bytes == sizeof(StatusMessage) ? header->type : 0;
    case MessageType::Log: return bytes == sizeof(LogMessage) ? header->type : 0;
    case MessageType::FrameStats: return bytes == sizeof(FrameStatsMessage) ? header->type : 0;
  }
  return 0;
}

}  // namespace inputsplit::proto
