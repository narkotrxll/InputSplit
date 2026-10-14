// util.h — small helpers used across the helper process.
#pragma once

#include <windows.h>

#include <string>
#include <vector>

namespace inputsplit::helper {

std::string ToUtf8(const std::wstring& text);
std::wstring FromUtf8(const std::string& text);
std::wstring ToLower(std::wstring text);
std::string ToLowerAscii(std::string text);
std::wstring FileNameOf(const std::wstring& path);
std::wstring DirectoryOf(const std::wstring& path);
bool PathExists(const std::wstring& path);
bool ReadWholeFile(const std::wstring& path, std::vector<char>& out);

// RAII wrapper for kernel handles (CloseHandle on destruction).
class UniqueHandle {
 public:
  UniqueHandle() = default;
  explicit UniqueHandle(HANDLE handle) : handle_(handle) {}
  ~UniqueHandle() { reset(); }
  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;
  UniqueHandle(UniqueHandle&& other) noexcept : handle_(other.release()) {}
  UniqueHandle& operator=(UniqueHandle&& other) noexcept {
    if (this != &other) reset(other.release());
    return *this;
  }

  HANDLE get() const { return handle_; }
  bool valid() const { return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE; }
  HANDLE release() {
    HANDLE h = handle_;
    handle_ = nullptr;
    return h;
  }
  void reset(HANDLE handle = nullptr) {
    if (valid()) CloseHandle(handle_);
    handle_ = handle;
  }

 private:
  HANDLE handle_ = nullptr;
};

// An error with a stable machine-readable code (shown to the user through the UI's
// translations) and a technical message (shown in diagnostics).
struct HelperError {
  std::string code;
  std::string message;
};

}  // namespace inputsplit::helper
