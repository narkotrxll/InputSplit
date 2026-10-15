// audio.h — plays an isolated game's sound on the speakers of the screen it was moved to.
//
// Only the game's own output changes, the same way "Settings → Sound → Volume mixer → App
// output device" does it; the Windows default device stays as it is for the other person.
// Nothing here touches the game process: the routing is a per-app setting of the Windows
// audio service.
#pragma once

#include <windows.h>

#include <optional>
#include <string>

namespace inputsplit::helper {

struct AudioEndpoint {
  std::wstring id;    // IMMDevice id: "{0.0.0.00000000}.{guid}"
  std::wstring name;  // "LG TV (NVIDIA High Definition Audio)"
};

// The active playback device built into the monitor or TV shown as `displayId`
// (HDMI / DisplayPort audio), or nothing if it has none.
std::optional<AudioEndpoint> FindDisplayAudio(const std::wstring& displayId);

// Windows' per-app output device (Windows 10 1803 and later).
// The device the app was set to, "" when it follows the Windows default. nullopt on failure.
std::optional<std::wstring> GetAppAudioDevice(DWORD pid);
// `deviceInterface` is what GetAppAudioDevice returned or EndpointInterfacePath(id);
// "" makes the app follow the Windows default again.
bool SetAppAudioDevice(DWORD pid, const std::wstring& deviceInterface);
std::wstring EndpointInterfacePath(const std::wstring& endpointId);

}  // namespace inputsplit::helper
