#include "util.h"

#include <algorithm>
#include <cwctype>

namespace inputsplit::helper {

std::string ToUtf8(const std::wstring& text) {
  if (text.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr,
                                 0, nullptr, nullptr);
  std::string result(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size,
                      nullptr, nullptr);
  return result;
}

std::wstring FromUtf8(const std::string& text) {
  if (text.empty()) return {};
  int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
  std::wstring result(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), size);
  return result;
}

std::wstring ToLower(std::wstring text) {
  std::transform(text.begin(), text.end(), text.begin(),
                 [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
  return text;
}

std::string ToLowerAscii(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](char c) {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
  });
  return text;
}

std::wstring FileNameOf(const std::wstring& path) {
  size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

std::wstring DirectoryOf(const std::wstring& path) {
  size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? std::wstring() : path.substr(0, slash);
}

bool ReadWholeFile(const std::wstring& path, std::vector<char>& out) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  LARGE_INTEGER size{};
  bool ok = GetFileSizeEx(file, &size) && size.QuadPart > 0 && size.QuadPart < (64ll << 20);
  if (ok) {
    out.resize(static_cast<size_t>(size.QuadPart));
    DWORD read = 0;
    ok = ReadFile(file, out.data(), static_cast<DWORD>(out.size()), &read, nullptr) &&
         read == out.size();
  }
  CloseHandle(file);
  return ok;
}

bool PathExists(const std::wstring& path) {
  return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

}  // namespace inputsplit::helper
