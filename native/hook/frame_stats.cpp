// frame_stats.cpp — counts the game's frames and measures "controller input -> frame" time
// for the FPS overlay.
//
// Nothing here is installed until the player turns the overlay on for the first time. Then:
//
//  * Present calls are hooked for every graphics API the game has loaded: DXGI (Direct3D 10,
//    11 and 12), Direct3D 9, OpenGL (wglSwapBuffers) and, when the game calls it directly,
//    Vulkan's vkQueuePresentKHR. Each Present is one frame.
//  * The COM methods are found the usual way: create a throw-away device and swap chain on a
//    hidden window, read the function addresses from their vtables, release everything. All
//    swap chains of one implementation share that code, so hooking the code (not the table)
//    covers the game's own swap chains too.
//  * Input latency: when an XInput read by the game returns a changed controller state, the
//    time is remembered; the next Present closes the measurement. So the number is "the game
//    saw the new input -> the game handed the frame to Windows". It does not include the
//    controller and its connection, the time before the game polls, GPU work after Present,
//    Windows composition, the cable, or the TV's own processing.
//
// Like every other hook, the detours forward untouched while measuring is off.
#include "modules.h"

#include <d3d11.h>
#include <d3d12.h>
#include <d3d9.h>
#include <dxgi1_4.h>
#include <xinput.h>

#include "hook_state.h"
#include "log.h"
#include "minhook_util.h"

namespace inputsplit::hook {
namespace {

// vtable indexes (declaration order in the SDK headers, IUnknown included).
constexpr int kDxgiPresent = 8;    // IDXGISwapChain::Present
constexpr int kDxgiPresent1 = 22;  // IDXGISwapChain1::Present1
constexpr int kD3d9Present = 17;   // IDirect3DDevice9::Present
constexpr int kD3d9SwapChainPresent = 3;  // IDirect3DSwapChain9::Present

constexpr UINT kDxgiPresentTest = 0x00000001;  // DXGI_PRESENT_TEST: nothing is shown

// Defined here so that we do not need dxguid.lib.
const GUID kIidSwapChain1 = {0x790a45f7, 0x0d42, 0x4876, {0x98, 0x3a, 0x0a, 0x55, 0xcf, 0xe6, 0xf4, 0xaa}};
const GUID kIidFactory2 = {0x50c83a1c, 0xe072, 0x4c48, {0x87, 0xb0, 0x36, 0x30, 0xfa, 0x36, 0xa6, 0xd0}};
const GUID kIidD3d12Device = {0x189819f1, 0x1db6, 0x4b57, {0xbe, 0x54, 0x18, 0x21, 0x33, 0x9b, 0x85, 0xf7}};
const GUID kIidD3d12Queue = {0x0ec870a6, 0x5d7e, 0x4c22, {0x8c, 0xfc, 0x5b, 0xaa, 0xe0, 0x76, 0x16, 0xed}};

using DxgiPresentFn = HRESULT(STDMETHODCALLTYPE*)(void*, UINT, UINT);
using DxgiPresent1Fn = HRESULT(STDMETHODCALLTYPE*)(void*, UINT, UINT, const void*);
using D3d9PresentFn = HRESULT(STDMETHODCALLTYPE*)(void*, const RECT*, const RECT*, HWND, const RGNDATA*);
using D3d9SwapChainPresentFn =
    HRESULT(STDMETHODCALLTYPE*)(void*, const RECT*, const RECT*, HWND, const RGNDATA*, DWORD);
using SwapBuffersFn = BOOL(WINAPI*)(HDC);
using VkQueuePresentFn = int32_t(WINAPI*)(void*, const void*);  // VKAPI_CALL is stdcall

using D3D11CreateDeviceAndSwapChainFn = decltype(&D3D11CreateDeviceAndSwapChain);
using D3D12CreateDeviceFn = HRESULT(WINAPI*)(IUnknown*, D3D_FEATURE_LEVEL, REFIID, void**);
using CreateDxgiFactory1Fn = HRESULT(WINAPI*)(REFIID, void**);
using Direct3DCreate9Fn = IDirect3D9*(WINAPI*)(UINT);

struct Originals {
  DxgiPresentFn dxgi11Present = nullptr;
  DxgiPresent1Fn dxgi11Present1 = nullptr;
  DxgiPresentFn dxgi12Present = nullptr;
  DxgiPresent1Fn dxgi12Present1 = nullptr;
  D3d9PresentFn d3d9Present = nullptr;
  D3d9SwapChainPresentFn d3d9SwapChainPresent = nullptr;
  SwapBuffersFn swapBuffers = nullptr;
  VkQueuePresentFn vkQueuePresent = nullptr;
} g_real;

std::atomic<bool> g_measuring{false};
std::atomic<uint32_t> g_hookedApis{0};

std::atomic<uint64_t> g_frames{0};
std::atomic<uint64_t> g_lastFrameUs{0};
std::atomic<uint64_t> g_worstFrameUs{0};
std::atomic<uint64_t> g_pendingInputUs{0};  // a new controller state was read, no frame yet
std::atomic<uint64_t> g_latencySumUs{0};
std::atomic<uint64_t> g_latencySamples{0};
std::atomic<uint64_t> g_worstLatencyUs{0};
std::atomic<uint64_t> g_lastInputSignature[4] = {};  // 0 = not seen yet

// Frames longer than this are pauses (loading, alt-tab), not frame times.
constexpr uint64_t kMaxFrameUs = 2'000'000;
constexpr uint64_t kMaxLatencyUs = 1'000'000;

// Attempts per API: creating a throw-away device that fails once will fail again.
int g_attempts[4] = {};
constexpr int kMaxAttempts = 3;

thread_local int t_presentDepth = 0;  // one frame even if a Present calls another one

uint64_t NowUs() {
  static const LONGLONG frequency = [] {
    LARGE_INTEGER f;
    QueryPerformanceFrequency(&f);
    return f.QuadPart;
  }();
  LARGE_INTEGER now;
  QueryPerformanceCounter(&now);
  return static_cast<uint64_t>(now.QuadPart / frequency * 1'000'000 +
                               now.QuadPart % frequency * 1'000'000 / frequency);
}

void StoreMax(std::atomic<uint64_t>& target, uint64_t value) {
  uint64_t current = target.load(std::memory_order_relaxed);
  while (value > current &&
         !target.compare_exchange_weak(current, value, std::memory_order_relaxed)) {
  }
}

void OnFrame() {
  if (!g_measuring.load(std::memory_order_relaxed)) return;
  const uint64_t now = NowUs();
  const uint64_t last = g_lastFrameUs.exchange(now, std::memory_order_relaxed);
  if (last != 0 && now > last && now - last < kMaxFrameUs) StoreMax(g_worstFrameUs, now - last);
  g_frames.fetch_add(1, std::memory_order_relaxed);
  const uint64_t input = g_pendingInputUs.exchange(0, std::memory_order_relaxed);
  if (input != 0 && now >= input && now - input < kMaxLatencyUs) {
    g_latencySumUs.fetch_add(now - input, std::memory_order_relaxed);
    g_latencySamples.fetch_add(1, std::memory_order_relaxed);
    StoreMax(g_worstLatencyUs, now - input);
  }
}

struct PresentScope {
  explicit PresentScope(bool counts) {
    if (t_presentDepth++ == 0 && counts) OnFrame();
  }
  ~PresentScope() { --t_presentDepth; }
  PresentScope(const PresentScope&) = delete;
  PresentScope& operator=(const PresentScope&) = delete;
};

// --- Detours --------------------------------------------------------------------------------

HRESULT STDMETHODCALLTYPE DetourDxgi11Present(void* self, UINT sync, UINT flags) {
  PresentScope scope((flags & kDxgiPresentTest) == 0);
  return g_real.dxgi11Present(self, sync, flags);
}

HRESULT STDMETHODCALLTYPE DetourDxgi11Present1(void* self, UINT sync, UINT flags, const void* params) {
  PresentScope scope((flags & kDxgiPresentTest) == 0);
  return g_real.dxgi11Present1(self, sync, flags, params);
}

HRESULT STDMETHODCALLTYPE DetourDxgi12Present(void* self, UINT sync, UINT flags) {
  PresentScope scope((flags & kDxgiPresentTest) == 0);
  return g_real.dxgi12Present(self, sync, flags);
}

HRESULT STDMETHODCALLTYPE DetourDxgi12Present1(void* self, UINT sync, UINT flags, const void* params) {
  PresentScope scope((flags & kDxgiPresentTest) == 0);
  return g_real.dxgi12Present1(self, sync, flags, params);
}

HRESULT STDMETHODCALLTYPE DetourD3d9Present(void* self, const RECT* source, const RECT* dest,
                                            HWND window, const RGNDATA* dirty) {
  PresentScope scope(true);
  return g_real.d3d9Present(self, source, dest, window, dirty);
}

HRESULT STDMETHODCALLTYPE DetourD3d9SwapChainPresent(void* self, const RECT* source, const RECT* dest,
                                                     HWND window, const RGNDATA* dirty, DWORD flags) {
  PresentScope scope(true);
  return g_real.d3d9SwapChainPresent(self, source, dest, window, dirty, flags);
}

BOOL WINAPI DetourSwapBuffers(HDC dc) {
  PresentScope scope(true);
  return g_real.swapBuffers(dc);
}

int32_t WINAPI DetourVkQueuePresent(void* queue, const void* info) {
  PresentScope scope(true);
  return g_real.vkQueuePresent(queue, info);
}

// --- Finding the Present functions ----------------------------------------------------------

void** VtableOf(void* object) {
  return *static_cast<void***>(object);
}

FARPROC Slot(void* object, int index) {
  return reinterpret_cast<FARPROC>(VtableOf(object)[index]);
}

template <typename T>
void Release(T*& object) {
  if (object != nullptr) object->Release();
  object = nullptr;
}

// A hidden window for the throw-away swap chains. Never shown; destroyed right after.
class ProbeWindow {
 public:
  ProbeWindow() {
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = DefWindowProcW;
    wc.hInstance = g_module;
    wc.lpszClassName = L"InputSplitFrameProbe";
    RegisterClassExW(&wc);  // fails harmlessly when already registered
    hwnd_ = CreateWindowExW(0, wc.lpszClassName, L"", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100,
                            nullptr, nullptr, g_module, nullptr);
  }
  ~ProbeWindow() {
    if (hwnd_ != nullptr) DestroyWindow(hwnd_);
  }
  ProbeWindow(const ProbeWindow&) = delete;
  ProbeWindow& operator=(const ProbeWindow&) = delete;
  HWND get() const { return hwnd_; }

 private:
  HWND hwnd_ = nullptr;
};

bool HookDxgiFromD3d11(HWND window) {
  HMODULE d3d11 = LoadLibraryW(L"d3d11.dll");
  auto create = d3d11 != nullptr ? reinterpret_cast<D3D11CreateDeviceAndSwapChainFn>(
                                       GetProcAddress(d3d11, "D3D11CreateDeviceAndSwapChain"))
                                 : nullptr;
  if (create == nullptr) return false;

  DXGI_SWAP_CHAIN_DESC desc{};
  desc.BufferCount = 1;
  desc.BufferDesc.Width = 100;
  desc.BufferDesc.Height = 100;
  desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  desc.OutputWindow = window;
  desc.SampleDesc.Count = 1;
  desc.Windowed = TRUE;
  desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

  IDXGISwapChain* swapChain = nullptr;
  ID3D11Device* device = nullptr;
  ID3D11DeviceContext* context = nullptr;
  const D3D_DRIVER_TYPE drivers[] = {D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
  HRESULT hr = E_FAIL;
  for (D3D_DRIVER_TYPE driver : drivers) {
    hr = create(nullptr, driver, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &desc, &swapChain,
                &device, nullptr, &context);
    if (SUCCEEDED(hr)) break;
  }
  if (FAILED(hr) || swapChain == nullptr) {
    Log(LogLevel::Warn, "Frame counter: no Direct3D 11 test device (0x%08lX)",
        static_cast<unsigned long>(hr));
    return false;
  }
  bool ok = CreateHookAt(Slot(swapChain, kDxgiPresent), &DetourDxgi11Present, &g_real.dxgi11Present,
                         "IDXGISwapChain::Present");
  IDXGISwapChain1* swapChain1 = nullptr;
  if (SUCCEEDED(swapChain->QueryInterface(kIidSwapChain1, reinterpret_cast<void**>(&swapChain1)))) {
    CreateHookAt(Slot(swapChain1, kDxgiPresent1), &DetourDxgi11Present1, &g_real.dxgi11Present1,
                 "IDXGISwapChain1::Present1");
  }
  Release(swapChain1);
  Release(swapChain);
  Release(context);
  Release(device);
  return ok;
}

// Direct3D 12 swap chains are created differently; in case their Present lives elsewhere,
// they get their own hooks (MinHook reports "already created" when it is the same code).
bool HookDxgiFromD3d12(HWND window) {
  HMODULE d3d12 = GetModuleHandleW(L"d3d12.dll");
  HMODULE dxgi = GetModuleHandleW(L"dxgi.dll");
  if (d3d12 == nullptr || dxgi == nullptr) return false;  // only for games that use Direct3D 12
  auto createDevice =
      reinterpret_cast<D3D12CreateDeviceFn>(GetProcAddress(d3d12, "D3D12CreateDevice"));
  auto createFactory =
      reinterpret_cast<CreateDxgiFactory1Fn>(GetProcAddress(dxgi, "CreateDXGIFactory1"));
  if (createDevice == nullptr || createFactory == nullptr) return false;

  ID3D12Device* device = nullptr;
  ID3D12CommandQueue* queue = nullptr;
  IDXGIFactory2* factory = nullptr;
  IDXGISwapChain1* swapChain = nullptr;
  if (SUCCEEDED(createDevice(nullptr, D3D_FEATURE_LEVEL_11_0, kIidD3d12Device,
                             reinterpret_cast<void**>(&device)))) {
    D3D12_COMMAND_QUEUE_DESC queueDesc{};
    queueDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    if (SUCCEEDED(device->CreateCommandQueue(&queueDesc, kIidD3d12Queue,
                                             reinterpret_cast<void**>(&queue))) &&
        SUCCEEDED(createFactory(kIidFactory2, reinterpret_cast<void**>(&factory)))) {
      DXGI_SWAP_CHAIN_DESC1 desc{};
      desc.Width = 100;
      desc.Height = 100;
      desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
      desc.SampleDesc.Count = 1;
      desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
      desc.BufferCount = 2;
      desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
      factory->CreateSwapChainForHwnd(queue, window, &desc, nullptr, nullptr, &swapChain);
    }
  }
  bool ok = false;
  if (swapChain != nullptr) {
    ok = CreateHookAt(Slot(swapChain, kDxgiPresent), &DetourDxgi12Present, &g_real.dxgi12Present,
                      "IDXGISwapChain::Present (D3D12)");
    CreateHookAt(Slot(swapChain, kDxgiPresent1), &DetourDxgi12Present1, &g_real.dxgi12Present1,
                 "IDXGISwapChain1::Present1 (D3D12)");
  } else {
    Log(LogLevel::Debug, "Frame counter: no Direct3D 12 test swap chain");
  }
  Release(swapChain);
  Release(factory);
  Release(queue);
  Release(device);
  return ok;
}

bool HookD3d9(HWND window) {
  HMODULE d3d9 = GetModuleHandleW(L"d3d9.dll");
  auto create = d3d9 != nullptr
                    ? reinterpret_cast<Direct3DCreate9Fn>(GetProcAddress(d3d9, "Direct3DCreate9"))
                    : nullptr;
  if (create == nullptr) return false;
  IDirect3D9* d3d = create(D3D_SDK_VERSION);
  if (d3d == nullptr) return false;

  D3DPRESENT_PARAMETERS params{};
  params.Windowed = TRUE;
  params.SwapEffect = D3DSWAPEFFECT_DISCARD;
  params.BackBufferFormat = D3DFMT_UNKNOWN;
  params.hDeviceWindow = window;
  IDirect3DDevice9* device = nullptr;
  // The null reference device draws nothing and needs no GPU, but uses the same classes.
  HRESULT hr = d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_NULLREF, window,
                                 D3DCREATE_SOFTWARE_VERTEXPROCESSING |
                                     D3DCREATE_DISABLE_DRIVER_MANAGEMENT,
                                 &params, &device);
  bool ok = false;
  if (SUCCEEDED(hr) && device != nullptr) {
    ok = CreateHookAt(Slot(device, kD3d9Present), &DetourD3d9Present, &g_real.d3d9Present,
                      "IDirect3DDevice9::Present");
    IDirect3DSwapChain9* swapChain = nullptr;
    if (SUCCEEDED(device->GetSwapChain(0, &swapChain)) && swapChain != nullptr) {
      CreateHookAt(Slot(swapChain, kD3d9SwapChainPresent), &DetourD3d9SwapChainPresent,
                   &g_real.d3d9SwapChainPresent, "IDirect3DSwapChain9::Present");
    }
    Release(swapChain);
  } else {
    Log(LogLevel::Warn, "Frame counter: no Direct3D 9 test device (0x%08lX)",
        static_cast<unsigned long>(hr));
  }
  Release(device);
  Release(d3d);
  return ok;
}

// Hooks every API the game has loaded and that is not hooked yet.
void InstallMissing() {
  if (!EnsureMinHook()) return;
  uint32_t hooked = g_hookedApis.load();
  uint32_t added = 0;
  auto due = [&](uint32_t api, int index, const wchar_t* module) {
    return (hooked & api) == 0 && g_attempts[index] < kMaxAttempts &&
           GetModuleHandleW(module) != nullptr;
  };
  const bool wantDxgi = due(proto::kFrameApiDxgi, 0, L"dxgi.dll");
  const bool wantD3d9 = due(proto::kFrameApiD3d9, 1, L"d3d9.dll");
  if (wantDxgi || wantD3d9) {
    ProbeWindow window;
    if (window.get() == nullptr) {
      Log(LogLevel::Warn, "Frame counter: could not create a test window");
    } else {
      if (wantDxgi) {
        ++g_attempts[0];
        // Both: a Direct3D 12 game may also refuse the Direct3D 11 test device, or the other way round.
        const bool d3d11 = HookDxgiFromD3d11(window.get());
        const bool d3d12 = HookDxgiFromD3d12(window.get());
        if (d3d11 || d3d12) added |= proto::kFrameApiDxgi;
      }
      if (wantD3d9) {
        ++g_attempts[1];
        if (HookD3d9(window.get())) added |= proto::kFrameApiD3d9;
      }
    }
  }
  if (due(proto::kFrameApiOpenGl, 2, L"opengl32.dll")) {
    ++g_attempts[2];
    if (CreateApiHook(L"opengl32.dll", "wglSwapBuffers", &DetourSwapBuffers, &g_real.swapBuffers)) {
      added |= proto::kFrameApiOpenGl;
    }
  }
  if (due(proto::kFrameApiVulkan, 3, L"vulkan-1.dll")) {
    ++g_attempts[3];
    if (CreateApiHook(L"vulkan-1.dll", "vkQueuePresentKHR", &DetourVkQueuePresent,
                      &g_real.vkQueuePresent)) {
      added |= proto::kFrameApiVulkan;
    }
  }
  if (added == 0) return;
  if (!ApplyQueuedHooks()) {
    Log(LogLevel::Error, "Frame counter: hooks could not be enabled");
    return;
  }
  g_hookedApis.fetch_or(added);
  Log(LogLevel::Info, "Frame counter hooked: 0x%02X", added);
}

}  // namespace

void SetFrameStats(bool enabled) {
  if (enabled) {
    g_lastFrameUs.store(0);
    g_pendingInputUs.store(0);
    for (auto& signature : g_lastInputSignature) signature.store(0);
    InstallMissing();
  }
  if (g_measuring.exchange(enabled) != enabled) {
    Log(LogLevel::Info, "Frame counter %s", enabled ? "on" : "off");
  }
}

void FrameStatsTick() {
  // A game may create its renderer after the overlay was turned on.
  if (g_measuring.load()) InstallMissing();
}

void OnControllerRead(DWORD physicalSlot, const XINPUT_STATE* read) {
  if (!g_measuring.load(std::memory_order_relaxed) || physicalSlot > 3 || read == nullptr) return;
  const XINPUT_GAMEPAD& state = read->Gamepad;
  // Buttons, triggers and sticks (coarsely: small stick noise is not "new input").
  uint64_t signature = 1ull << 63 | static_cast<uint64_t>(state.wButtons) |
                       static_cast<uint64_t>(state.bLeftTrigger >> 5) << 16 |
                       static_cast<uint64_t>(state.bRightTrigger >> 5) << 19 |
                       static_cast<uint64_t>((state.sThumbLX + 32768) >> 12) << 22 |
                       static_cast<uint64_t>((state.sThumbLY + 32768) >> 12) << 26 |
                       static_cast<uint64_t>((state.sThumbRX + 32768) >> 12) << 30 |
                       static_cast<uint64_t>((state.sThumbRY + 32768) >> 12) << 34;
  const uint64_t previous =
      g_lastInputSignature[physicalSlot].exchange(signature, std::memory_order_relaxed);
  if (previous == 0 || previous == signature) return;
  uint64_t none = 0;  // keep the earliest unanswered input
  g_pendingInputUs.compare_exchange_strong(none, NowUs(), std::memory_order_relaxed);
}

void FillFrameStats(proto::StatusMessage& status) {
  status.timeUs = NowUs();
  status.frames = g_frames.load();
  status.inputLatencySumUs = g_latencySumUs.load();
  status.inputLatencySamples = g_latencySamples.load();
  status.worstFrameUs = static_cast<uint32_t>(g_worstFrameUs.exchange(0));
  status.worstInputLatencyUs = static_cast<uint32_t>(g_worstLatencyUs.exchange(0));
  status.frameStatsEnabled = g_measuring.load() ? 1 : 0;
  status.frameApis = g_hookedApis.load();
}

}  // namespace inputsplit::hook
