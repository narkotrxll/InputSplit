// main.cpp — inputsplit-helper.exe
//
// Started by the Electron main process with stdin/stdout pipes. Reads one JSON request per
// line from stdin, answers on stdout. It can also be used by hand from a terminal:
//
//   > inputsplit-helper.exe
//   {"id":1,"method":"listControllers"}
//   {"id":1,"result":{"controllers":[...]}}
//
// Lifetime: when stdin closes (the app exited or crashed), every session is stopped and
// the helper exits. Requests run on their own threads, so a slow injection never delays a
// "ping" from the app's watchdog.
#include <windows.h>

#include <fcntl.h>
#include <io.h>

#include <chrono>
#include <cstdio>
#include <iostream>
#include <set>
#include <string>
#include <thread>

#include "../common/hook_protocol.h"
#include "../common/version.h"
#include "controllers.h"
#include "displays.h"
#include "process_info.h"
#include "rpc.h"
#include "safety.h"
#include "session.h"
#include "system_window.h"
#include "util.h"
#include "windows_enum.h"

using namespace inputsplit::helper;
namespace proto = inputsplit::proto;

namespace {

const auto g_startTime = std::chrono::steady_clock::now();

DWORD WindowsBuildNumber() {
  // GetVersionEx lies without a manifest; RtlGetVersion does not.
  using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOW*);
  auto rtlGetVersion = reinterpret_cast<RtlGetVersionFn>(
      GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion"));
  OSVERSIONINFOW info{};
  info.dwOSVersionInfoSize = sizeof(info);
  if (rtlGetVersion != nullptr && rtlGetVersion(&info) == 0) return info.dwBuildNumber;
  return 0;
}

RECT RectFromJson(const Json& json) {
  RECT rect{};
  rect.left = json.at("x").get<LONG>();
  rect.top = json.at("y").get<LONG>();
  rect.right = rect.left + json.at("width").get<LONG>();
  rect.bottom = rect.top + json.at("height").get<LONG>();
  return rect;
}

HWND HwndFromJson(const Json& value) {
  return value.is_null() ? nullptr
                         : reinterpret_cast<HWND>(static_cast<uintptr_t>(value.get<uint64_t>()));
}

uint32_t SlotFromJson(const Json& params) {
  if (!params.contains("xinputSlot") || params["xinputSlot"].is_null()) return proto::kNoSlot;
  int slot = params["xinputSlot"].get<int>();
  return (slot >= 0 && slot <= 3) ? static_cast<uint32_t>(slot) : proto::kNoSlot;
}

// Executes one request. Throws HelperError for expected failures; nlohmann exceptions
// for malformed parameters are turned into "invalidParams" by the caller.
Json Handle(const std::string& method, const Json& params) {
  if (method == "hello") {
    return Json{{"helperVersion", INPUTSPLIT_VERSION},
                {"protocolVersion", 1},
                {"hookProtocolVersion", proto::kProtocolVersion},
                {"architecture", ArchitectureName(SelfArchitecture())},
                {"windowsBuild", WindowsBuildNumber()},
                {"isElevated", IsSelfElevated()},
                {"pid", GetCurrentProcessId()},
                {"hookDllFound", PathExists(SessionManager::Instance().hookDllPath())},
                {"emergencyHotkey", EmergencyHotkeyLabel()}};
  }
  if (method == "ping") {
    auto uptime = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - g_startTime)
                      .count();
    return Json{{"uptimeMs", uptime}};
  }
  if (method == "listWindows") {
    std::set<DWORD> excluded;
    if (params.contains("excludePids")) {
      for (const Json& pid : params["excludePids"]) excluded.insert(pid.get<DWORD>());
    }
    return ListWindows(excluded);
  }
  if (method == "listControllers") return ControllerMonitor::Instance().List();
  if (method == "listDisplays") return ListDisplays();
  if (method == "startControllerTest") {
    ControllerMonitor::Instance().StartTest(params.at("slot").get<int>());
    return Json::object();
  }
  if (method == "stopControllerTest") {
    ControllerMonitor::Instance().StopTest();
    return Json::object();
  }
  if (method == "checkTarget") {
    return VerdictToJson(CheckTarget(params.at("pid").get<DWORD>(),
                                     SessionManager::Instance().hookDllPath(),
                                     params.value("allowAntiCheat", false)));
  }
  if (method == "startIsolation") {
    StartRequest request;
    request.pid = params.at("pid").get<DWORD>();
    request.window = params.contains("hwnd") ? HwndFromJson(params["hwnd"]) : nullptr;
    request.features = FeaturesFromJson(params.at("features"));
    request.xinputSlot = SlotFromJson(params);
    request.allowAntiCheat = params.value("allowAntiCheat", false);
    HelperError error;
    Json status = SessionManager::Instance().Start(request, error);
    if (status.is_null()) throw error;
    return status;
  }
  if (method == "updateIsolation") {
    if (!SessionManager::Instance().Reconfigure(params.at("sessionId").get<int>(),
                                                FeaturesFromJson(params.at("features")),
                                                SlotFromJson(params))) {
      throw HelperError{"sessionNotFound", "No such session."};
    }
    return Json::object();
  }
  if (method == "stopIsolation") {
    if (!SessionManager::Instance().Stop(params.at("sessionId").get<int>(), "stopped")) {
      throw HelperError{"sessionNotFound", "No such session."};
    }
    return Json::object();
  }
  if (method == "routeAudio") {
    Json result = SessionManager::Instance().RouteAudio(
        params.at("sessionId").get<int>(), FromUtf8(params.at("displayId").get<std::string>()));
    if (result.is_null()) throw HelperError{"sessionNotFound", "No such session."};
    return result;
  }
  if (method == "moveWindow") {
    HelperError error;
    Json result = MoveWindowToDisplay(HwndFromJson(params.at("hwnd")),
                                      FromUtf8(params.at("displayId").get<std::string>()),
                                      params.value("mode", std::string("auto")), error);
    if (result.is_null()) throw error;
    return result;
  }
  if (method == "restoreWindowRect") {
    bool ok = RestoreWindowRect(HwndFromJson(params.at("hwnd")), RectFromJson(params.at("rect")));
    return Json{{"restored", ok}};
  }
  if (method == "setGamepadHotkey") {
    ControllerMonitor::Instance().SetHotkeyEnabled(params.at("enabled").get<bool>());
    return Json::object();
  }
  if (method == "rumble") {
    if (!ControllerMonitor::Instance().Rumble(params.at("slot").get<int>(),
                                              params.at("pattern").get<std::string>())) {
      throw HelperError{"rumbleUnavailable", "This controller cannot vibrate."};
    }
    return Json::object();
  }
  if (method == "setEmergencyHotkey") {
    bool registered = SetEmergencyHotkey(params.at("enabled").get<bool>());
    return Json{{"registered", registered}, {"accelerator", EmergencyHotkeyLabel()}};
  }
  throw HelperError{"unknownMethod", "Unknown method: " + method};
}

void Dispatch(const std::string& line) {
  Json request = Json::parse(line, nullptr, false);
  if (request.is_discarded() || !request.is_object() || !request.contains("method")) {
    LogEvent("warn", "Ignoring a malformed request line");
    return;
  }
  Json id = request.value("id", Json(nullptr));
  std::string method = request["method"].is_string() ? request["method"].get<std::string>() : "";
  Json params = request.value("params", Json::object());

  std::thread([id, method, params] {
    try {
      SendResult(id, Handle(method, params));
    } catch (const HelperError& error) {
      SendError(id, error.code, error.message);
    } catch (const Json::exception& error) {
      SendError(id, "invalidParams", error.what());
    } catch (const std::exception& error) {
      SendError(id, "internalError", error.what());
    }
  }).detach();
}

std::wstring DefaultHookPath() {
  wchar_t path[MAX_PATH * 2];
  DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH * 2);
  return DirectoryOf(std::wstring(path, length)) + L"\\InputSplitHook64.dll";
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  // Physical pixels everywhere (monitor and window rectangles).
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);

  std::wstring hookPath = DefaultHookPath();
  for (int i = 1; i + 1 < argc; ++i) {
    if (std::wstring(argv[i]) == L"--hook-dll") hookPath = argv[++i];
  }
  SessionManager::Instance().SetHookDllPath(hookPath);

  if (!ControllerMonitor::Instance().Start()) {
    LogEvent("error", "XInput is not available; controllers cannot be listed.");
  }
  if (!StartSystemWindow()) {
    LogEvent("warn", "System notification window could not be created.");
  }
  SendEvent("ready", Json{{"helperVersion", INPUTSPLIT_VERSION}, {"pid", GetCurrentProcessId()}});

  std::string line;
  bool shutdownRequested = false;
  while (!shutdownRequested && std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    Json request = Json::parse(line, nullptr, false);
    if (!request.is_discarded() && request.is_object() && request.value("method", "") == "shutdown") {
      shutdownRequested = true;
      SessionManager::Instance().StopAll("helperShutdown", 2000);
      SendResult(request.value("id", Json(nullptr)), Json::object());
      break;
    }
    Dispatch(line);
  }

  // stdin closed or shutdown requested: leave every game in its normal state.
  SessionManager::Instance().StopAll("helperShutdown", 2000);
  StopSystemWindow();
  ControllerMonitor::Instance().Stop();
  fflush(stdout);
  // Detached request threads may still be running; ExitProcess ends them cleanly.
  ExitProcess(0);
}
