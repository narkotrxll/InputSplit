#include "log.h"

#include <windows.h>

#include <cstdarg>
#include <cstdio>
#include <cstring>

namespace inputsplit::hook {
namespace {

constexpr int kCapacity = 32;

SRWLOCK g_lock = SRWLOCK_INIT;
LogEntry g_entries[kCapacity];
int g_head = 0;   // index of the oldest entry
int g_count = 0;  // number of stored entries

}  // namespace

void Log(LogLevel level, const char* format, ...) {
  LogEntry entry{};
  entry.level = level;

  va_list args;
  va_start(args, format);
  vsnprintf(entry.text, sizeof(entry.text), format, args);
  va_end(args);

  char debugLine[512];
  snprintf(debugLine, sizeof(debugLine), "[InputSplitHook] %s\n", entry.text);
  OutputDebugStringA(debugLine);

  AcquireSRWLockExclusive(&g_lock);
  int tail = (g_head + g_count) % kCapacity;
  g_entries[tail] = entry;
  if (g_count < kCapacity) {
    ++g_count;
  } else {
    g_head = (g_head + 1) % kCapacity;  // queue full: drop the oldest entry
  }
  ReleaseSRWLockExclusive(&g_lock);
}

bool PopLog(LogEntry& out) {
  AcquireSRWLockExclusive(&g_lock);
  bool hasEntry = g_count > 0;
  if (hasEntry) {
    out = g_entries[g_head];
    g_head = (g_head + 1) % kCapacity;
    --g_count;
  }
  ReleaseSRWLockExclusive(&g_lock);
  return hasEntry;
}

}  // namespace inputsplit::hook
