// log.h — tiny, allocation-free log queue inside the game process.
//
// Messages are kept in a fixed ring buffer and sent to the helper by the pipe worker.
// They are also written with OutputDebugString so they can be watched with DebugView.
// Never log anything typed by the user: only feature names, counts and API results.
#pragma once

#include <cstdint>

namespace inputsplit::hook {

enum class LogLevel : uint32_t { Debug = 0, Info = 1, Warn = 2, Error = 3 };

struct LogEntry {
  LogLevel level;
  char text[480];
};

void Log(LogLevel level, const char* format, ...);

// Removes the oldest entry. Returns false when the queue is empty.
bool PopLog(LogEntry& out);

}  // namespace inputsplit::hook
