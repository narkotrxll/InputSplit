// rpc.h — newline-delimited JSON over stdin/stdout.
//
//   request : {"id": 7, "method": "listWindows", "params": {...}}
//   response: {"id": 7, "result": {...}}   or   {"id": 7, "error": {"code": "...", "message": "..."}}
//   event   : {"event": "sessionStatus", "data": {...}}
//
// stdout is shared by many threads (requests run in parallel, sessions emit events), so
// every write goes through one mutex and is flushed immediately.
#pragma once

#include <nlohmann/json.hpp>

#include <string>

namespace inputsplit::helper {

using Json = nlohmann::json;

void SendResult(const Json& id, const Json& result);
void SendError(const Json& id, const std::string& code, const std::string& message);
void SendEvent(const std::string& name, const Json& data);

// Convenience: event "log" with source "helper".
void LogEvent(const std::string& level, const std::string& message);

}  // namespace inputsplit::helper
