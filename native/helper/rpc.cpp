#include "rpc.h"

#include <cstdio>
#include <mutex>

namespace inputsplit::helper {
namespace {

std::mutex g_outputMutex;

void WriteLine(const Json& message) {
  // Invalid UTF-8 (e.g. a broken window title) must not throw: replace bad bytes.
  std::string line = message.dump(-1, ' ', false, Json::error_handler_t::replace);
  line.push_back('\n');
  std::lock_guard<std::mutex> lock(g_outputMutex);
  fwrite(line.data(), 1, line.size(), stdout);
  fflush(stdout);
}

}  // namespace

void SendResult(const Json& id, const Json& result) {
  WriteLine(Json{{"id", id}, {"result", result}});
}

void SendError(const Json& id, const std::string& code, const std::string& message) {
  WriteLine(Json{{"id", id}, {"error", {{"code", code}, {"message", message}}}});
}

void SendEvent(const std::string& name, const Json& data) {
  WriteLine(Json{{"event", name}, {"data", data}});
}

void LogEvent(const std::string& level, const std::string& message) {
  SendEvent("log", Json{{"level", level}, {"source", "helper"}, {"message", message}});
}

}  // namespace inputsplit::helper
