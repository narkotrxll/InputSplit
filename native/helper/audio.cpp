// The COM and WinRT headers below need the RPC headers that WIN32_LEAN_AND_MEAN (set for the
// whole project) leaves out of windows.h; MSVC fails to compile them without.
#undef WIN32_LEAN_AND_MEAN
#include <windows.h>

#include "audio.h"

#include <cfgmgr32.h>
#include <hstring.h>
#include <inspectable.h>
#include <mmdeviceapi.h>
#include <objbase.h>
#include <propidl.h>

#include <vector>

#include "displays.h"
#include "util.h"

namespace inputsplit::helper {
namespace {

// Spelled out here instead of linking the SDK's uuid/propkey libraries (MinGW lacks some).
constexpr CLSID kClsidMMDeviceEnumerator = {
    0xbcde0395, 0xe52f, 0x467c, {0x8e, 0x3d, 0xc4, 0x57, 0x92, 0x91, 0x69, 0x2e}};
constexpr IID kIidIMMDeviceEnumerator = {
    0xa95664d2, 0x9614, 0x4f35, {0xa7, 0x46, 0xde, 0x8d, 0xb6, 0x36, 0x17, 0xe6}};
constexpr GUID kDeviceFmtid = {
    0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}};
constexpr GUID kContainerIdFmtid = {
    0x8c7ed206, 0x3f8a, 0x4827, {0xb3, 0xab, 0xae, 0x9e, 0x1f, 0xae, 0xfc, 0x6c}};
constexpr PROPERTYKEY kPkeyDeviceDesc = {kDeviceFmtid, 2};
constexpr PROPERTYKEY kPkeyFriendlyName = {kDeviceFmtid, 14};
constexpr PROPERTYKEY kPkeyContainerId = {kContainerIdFmtid, 2};
constexpr DEVPROPKEY kDevpkeyContainerId = {kContainerIdFmtid, 2};
// Devices built into the PC itself all share this container.
constexpr GUID kLocalMachineContainer = {0, 0, 0, {0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}};

// Windows.Media.Internal.AudioPolicyConfig: the undocumented factory behind "App volume and
// device preferences" (also used by EarTrumpet and SoundVolumeView). Its IID changed in
// Windows 10 21H2; the methods we call sit at the same place in both versions.
constexpr IID kIidAudioPolicyConfig21H2 = {
    0xab3d4648, 0xe242, 0x459f, {0xb0, 0x2f, 0x54, 0x1c, 0x70, 0x30, 0x63, 0x24}};
constexpr IID kIidAudioPolicyConfigDownlevel = {
    0x2a59116d, 0x6c4f, 0x45e0, {0xa7, 0x4f, 0x70, 0x7e, 0x3f, 0xef, 0x92, 0x58}};

struct IAudioPolicyConfig : public IInspectable {
  // 19 methods we never call (volume groups, ringer, chat app), in vtable order.
  virtual HRESULT STDMETHODCALLTYPE Unused1() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused2() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused3() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused4() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused5() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused6() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused7() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused8() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused9() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused10() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused11() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused12() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused13() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused14() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused15() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused16() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused17() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused18() = 0;
  virtual HRESULT STDMETHODCALLTYPE Unused19() = 0;
  virtual HRESULT STDMETHODCALLTYPE SetPersistedDefaultAudioEndpoint(UINT pid, EDataFlow flow,
                                                                     ERole role,
                                                                     HSTRING deviceId) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetPersistedDefaultAudioEndpoint(UINT pid, EDataFlow flow,
                                                                     ERole role,
                                                                     HSTRING* deviceId) = 0;
};

// combase.dll is loaded at run time, like shcore in displays.cpp: no import library needed.
struct WinRt {
  using CreateStringFn = HRESULT(WINAPI*)(PCWSTR, UINT32, HSTRING*);
  using DeleteStringFn = HRESULT(WINAPI*)(HSTRING);
  using RawBufferFn = PCWSTR(WINAPI*)(HSTRING, UINT32*);
  using GetFactoryFn = HRESULT(WINAPI*)(HSTRING, REFIID, void**);

  CreateStringFn createString = nullptr;
  DeleteStringFn deleteString = nullptr;
  RawBufferFn rawBuffer = nullptr;
  GetFactoryFn getFactory = nullptr;

  bool ok() const { return createString && deleteString && rawBuffer && getFactory; }

  static const WinRt& Get() {
    static const WinRt api = [] {
      WinRt result;
      HMODULE combase = LoadLibraryW(L"combase.dll");
      if (combase == nullptr) return result;
      result.createString =
          reinterpret_cast<CreateStringFn>(GetProcAddress(combase, "WindowsCreateString"));
      result.deleteString =
          reinterpret_cast<DeleteStringFn>(GetProcAddress(combase, "WindowsDeleteString"));
      result.rawBuffer =
          reinterpret_cast<RawBufferFn>(GetProcAddress(combase, "WindowsGetStringRawBuffer"));
      result.getFactory =
          reinterpret_cast<GetFactoryFn>(GetProcAddress(combase, "RoGetActivationFactory"));
      return result;
    }();
    return api;
  }
};

// Request threads and session threads come and go, so each call joins the MTA itself.
class ComScope {
 public:
  ComScope() : hr_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~ComScope() {
    if (SUCCEEDED(hr_)) CoUninitialize();
  }
  ComScope(const ComScope&) = delete;
  ComScope& operator=(const ComScope&) = delete;

 private:
  HRESULT hr_;
};

template <typename T>
class ComPtr {
 public:
  ComPtr() = default;
  ~ComPtr() {
    if (ptr_ != nullptr) ptr_->Release();
  }
  ComPtr(const ComPtr&) = delete;
  ComPtr& operator=(const ComPtr&) = delete;
  T* operator->() const { return ptr_; }
  T* get() const { return ptr_; }
  T** put() { return &ptr_; }
  void** putVoid() { return reinterpret_cast<void**>(&ptr_); }

 private:
  T* ptr_ = nullptr;
};

bool NewPolicyConfig(ComPtr<IAudioPolicyConfig>& out) {
  const WinRt& api = WinRt::Get();
  if (!api.ok()) return false;
  static const wchar_t kClass[] = L"Windows.Media.Internal.AudioPolicyConfig";
  HSTRING className = nullptr;
  if (FAILED(api.createString(kClass, static_cast<UINT32>(wcslen(kClass)), &className))) {
    return false;
  }
  HRESULT hr = api.getFactory(className, kIidAudioPolicyConfig21H2, out.putVoid());
  if (FAILED(hr)) hr = api.getFactory(className, kIidAudioPolicyConfigDownlevel, out.putVoid());
  api.deleteString(className);
  return SUCCEEDED(hr) && out.get() != nullptr;
}

std::optional<GUID> MonitorContainerId(const std::wstring& devicePath) {
  // "\\?\DISPLAY#GSM5B7F#5&2f1f4bb&0&UID4353#{e6f07b5f-...}" -> "DISPLAY\GSM5B7F\5&2f1f4bb&0&UID4353"
  std::wstring instance = devicePath;
  if (instance.rfind(L"\\\\?\\", 0) == 0) instance.erase(0, 4);
  size_t interfaceGuid = instance.rfind(L"#{");
  if (interfaceGuid != std::wstring::npos) instance.erase(interfaceGuid);
  if (instance.empty()) return std::nullopt;
  for (wchar_t& c : instance) {
    if (c == L'#') c = L'\\';
  }
  DEVINST node = 0;
  if (CM_Locate_DevNodeW(&node, instance.data(), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS) {
    return std::nullopt;
  }
  GUID container{};
  DEVPROPTYPE type = 0;
  ULONG size = sizeof(container);
  if (CM_Get_DevNode_PropertyW(node, &kDevpkeyContainerId, &type,
                               reinterpret_cast<PBYTE>(&container), &size, 0) != CR_SUCCESS ||
      type != DEVPROP_TYPE_GUID) {
    return std::nullopt;
  }
  if (IsEqualGUID(container, GUID{}) || IsEqualGUID(container, kLocalMachineContainer)) {
    return std::nullopt;  // nothing to tell this monitor apart from the PC's own speakers
  }
  return container;
}

std::wstring StringProperty(IPropertyStore* store, const PROPERTYKEY& key) {
  PROPVARIANT value;
  PropVariantInit(&value);
  std::wstring result;
  if (SUCCEEDED(store->GetValue(key, &value)) && value.vt == VT_LPWSTR && value.pwszVal) {
    result = value.pwszVal;
  }
  PropVariantClear(&value);
  return result;
}

std::optional<GUID> GuidProperty(IPropertyStore* store, const PROPERTYKEY& key) {
  PROPVARIANT value;
  PropVariantInit(&value);
  std::optional<GUID> result;
  if (SUCCEEDED(store->GetValue(key, &value)) && value.vt == VT_CLSID && value.puuid) {
    result = *value.puuid;
  }
  PropVariantClear(&value);
  return result;
}

}  // namespace

std::optional<AudioEndpoint> FindDisplayAudio(const std::wstring& displayId) {
  std::optional<TargetInfo> target = FindDisplayTarget(displayId);
  if (!target) return std::nullopt;
  // HDMI and DisplayPort audio drivers give their endpoint the monitor's container id, which
  // is how Windows shows a TV and its speakers as one device. The EDID name is the fallback.
  std::optional<GUID> container = MonitorContainerId(target->devicePath);
  std::wstring monitorName = ToLower(target->friendlyName);

  ComScope com;
  ComPtr<IMMDeviceEnumerator> enumerator;
  if (FAILED(CoCreateInstance(kClsidMMDeviceEnumerator, nullptr, CLSCTX_ALL,
                              kIidIMMDeviceEnumerator, enumerator.putVoid()))) {
    return std::nullopt;
  }
  ComPtr<IMMDeviceCollection> devices;
  if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, devices.put()))) {
    return std::nullopt;
  }
  UINT count = 0;
  devices->GetCount(&count);
  std::vector<AudioEndpoint> byName;
  for (UINT i = 0; i < count; ++i) {
    ComPtr<IMMDevice> device;
    if (FAILED(devices->Item(i, device.put()))) continue;
    LPWSTR rawId = nullptr;
    if (FAILED(device->GetId(&rawId))) continue;
    AudioEndpoint endpoint{rawId, L""};
    CoTaskMemFree(rawId);
    ComPtr<IPropertyStore> store;
    if (FAILED(device->OpenPropertyStore(STGM_READ, store.put()))) continue;
    endpoint.name = StringProperty(store.get(), kPkeyFriendlyName);

    std::optional<GUID> endpointContainer = GuidProperty(store.get(), kPkeyContainerId);
    if (container && endpointContainer && IsEqualGUID(*container, *endpointContainer)) {
      return endpoint;
    }
    if (!monitorName.empty() &&
        ToLower(StringProperty(store.get(), kPkeyDeviceDesc)) == monitorName) {
      byName.push_back(endpoint);
    }
  }
  // Two identical monitors would have the same name: then we cannot tell which is which.
  if (byName.size() == 1) return byName.front();
  return std::nullopt;
}

std::optional<std::wstring> GetAppAudioDevice(DWORD pid) {
  ComScope com;
  ComPtr<IAudioPolicyConfig> config;
  if (!NewPolicyConfig(config)) return std::nullopt;
  const WinRt& api = WinRt::Get();
  HSTRING value = nullptr;
  if (FAILED(config->GetPersistedDefaultAudioEndpoint(pid, eRender, eMultimedia, &value))) {
    return std::nullopt;
  }
  std::wstring result;
  if (value != nullptr) {
    UINT32 length = 0;
    PCWSTR buffer = api.rawBuffer(value, &length);
    if (buffer != nullptr) result.assign(buffer, length);
    api.deleteString(value);
  }
  return result;
}

bool SetAppAudioDevice(DWORD pid, const std::wstring& deviceInterface) {
  ComScope com;
  ComPtr<IAudioPolicyConfig> config;
  if (!NewPolicyConfig(config)) return false;
  const WinRt& api = WinRt::Get();
  HSTRING value = nullptr;  // null = follow the Windows default
  if (!deviceInterface.empty() &&
      FAILED(api.createString(deviceInterface.c_str(),
                              static_cast<UINT32>(deviceInterface.size()), &value))) {
    return false;
  }
  // Games pick either role; Windows' own settings page sets both.
  bool ok = SUCCEEDED(config->SetPersistedDefaultAudioEndpoint(pid, eRender, eMultimedia, value)) &&
            SUCCEEDED(config->SetPersistedDefaultAudioEndpoint(pid, eRender, eConsole, value));
  if (value != nullptr) api.deleteString(value);
  return ok;
}

std::wstring EndpointInterfacePath(const std::wstring& endpointId) {
  // KSCATEGORY_AUDIO render interface of the MMDevAPI software device.
  return L"\\\\?\\SWD#MMDEVAPI#" + endpointId + L"#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
}

}  // namespace inputsplit::helper
