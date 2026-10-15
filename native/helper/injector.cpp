#include "injector.h"

#include <psapi.h>

#include <algorithm>
#include <cstring>
#include <vector>

namespace inputsplit::helper {
namespace {

constexpr DWORD kLoadTimeoutMs = 10000;
constexpr DWORD kAttachTimeoutMs = 5000;

// Converts an RVA (address relative to the loaded image) to an offset in the file.
std::optional<size_t> RvaToOffset(const std::vector<char>& file, const IMAGE_SECTION_HEADER* sections,
                                  WORD sectionCount, uint32_t rva) {
  for (WORD i = 0; i < sectionCount; ++i) {
    const IMAGE_SECTION_HEADER& s = sections[i];
    uint32_t size = std::max(s.Misc.VirtualSize, s.SizeOfRawData);
    if (rva >= s.VirtualAddress && rva < s.VirtualAddress + size) {
      size_t offset = static_cast<size_t>(rva - s.VirtualAddress) + s.PointerToRawData;
      if (offset < file.size()) return offset;
    }
  }
  return std::nullopt;
}

template <typename T>
const T* At(const std::vector<char>& file, size_t offset) {
  if (offset + sizeof(T) > file.size()) return nullptr;
  return reinterpret_cast<const T*>(file.data() + offset);
}

DWORD RunRemoteThread(HANDLE process, LPTHREAD_START_ROUTINE start, void* parameter,
                      DWORD timeoutMs, HelperError& error) {
  UniqueHandle thread(CreateRemoteThread(process, nullptr, 0, start, parameter, 0, nullptr));
  if (!thread.valid()) {
    error = {"injectionFailed", "CreateRemoteThread failed with error " +
                                    std::to_string(GetLastError())};
    return static_cast<DWORD>(-1);
  }
  if (WaitForSingleObject(thread.get(), timeoutMs) != WAIT_OBJECT_0) {
    error = {"injectionTimeout", "The game did not respond while loading InputSplit."};
    return static_cast<DWORD>(-1);
  }
  DWORD exitCode = 0;
  GetExitCodeThread(thread.get(), &exitCode);
  return exitCode;
}

}  // namespace

std::wstring HookDllForArchitecture(const std::wstring& hook64Path, Architecture arch) {
  if (arch != Architecture::X86) return hook64Path;
  const std::wstring suffix = L"64.dll";
  std::wstring path = hook64Path;
  if (path.size() >= suffix.size() &&
      ToLower(path.substr(path.size() - suffix.size())) == suffix) {
    path.replace(path.size() - suffix.size(), suffix.size(), L"32.dll");
  }
  return path;
}

std::optional<uint32_t> FindExportRva(const std::wstring& dllPath, const char* exportName) {
  std::vector<char> file;
  if (!ReadWholeFile(dllPath, file)) return std::nullopt;

  const auto* dos = At<IMAGE_DOS_HEADER>(file, 0);
  if (dos == nullptr || dos->e_magic != IMAGE_DOS_SIGNATURE) return std::nullopt;
  const size_t ntOffset = static_cast<size_t>(dos->e_lfanew);
  const auto* signature = At<DWORD>(file, ntOffset);
  const auto* fileHeader = At<IMAGE_FILE_HEADER>(file, ntOffset + sizeof(DWORD));
  if (signature == nullptr || *signature != IMAGE_NT_SIGNATURE || fileHeader == nullptr) {
    return std::nullopt;
  }
  const size_t optionalOffset = ntOffset + sizeof(DWORD) + sizeof(IMAGE_FILE_HEADER);
  const auto* magic = At<WORD>(file, optionalOffset);
  if (magic == nullptr) return std::nullopt;

  IMAGE_DATA_DIRECTORY exportDirectory{};
  if (*magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC) {
    const auto* optional = At<IMAGE_OPTIONAL_HEADER64>(file, optionalOffset);
    if (optional == nullptr) return std::nullopt;
    exportDirectory = optional->DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT];
  } else if (*magic == IMAGE_NT_OPTIONAL_HDR32_MAGIC) {
    const auto* optional = At<IMAGE_OPTIONAL_HEADER32>(file, optionalOffset);
    if (optional == nullptr) return std::nullopt;
    exportDirectory = optional->DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT];
  } else {
    return std::nullopt;
  }

  const size_t sectionsOffset = optionalOffset + fileHeader->SizeOfOptionalHeader;
  if (sectionsOffset + fileHeader->NumberOfSections * sizeof(IMAGE_SECTION_HEADER) > file.size()) {
    return std::nullopt;
  }
  const auto* sections = reinterpret_cast<const IMAGE_SECTION_HEADER*>(file.data() + sectionsOffset);
  const WORD sectionCount = fileHeader->NumberOfSections;

  auto exportsOffset = RvaToOffset(file, sections, sectionCount, exportDirectory.VirtualAddress);
  if (!exportsOffset) return std::nullopt;
  const auto* exports = At<IMAGE_EXPORT_DIRECTORY>(file, *exportsOffset);
  if (exports == nullptr) return std::nullopt;

  auto namesOffset = RvaToOffset(file, sections, sectionCount, exports->AddressOfNames);
  auto ordinalsOffset = RvaToOffset(file, sections, sectionCount, exports->AddressOfNameOrdinals);
  auto functionsOffset = RvaToOffset(file, sections, sectionCount, exports->AddressOfFunctions);
  if (!namesOffset || !ordinalsOffset || !functionsOffset) return std::nullopt;

  for (DWORD i = 0; i < exports->NumberOfNames; ++i) {
    const auto* nameRva = At<DWORD>(file, *namesOffset + i * sizeof(DWORD));
    if (nameRva == nullptr) return std::nullopt;
    auto nameOffset = RvaToOffset(file, sections, sectionCount, *nameRva);
    if (!nameOffset) continue;
    const char* name = file.data() + *nameOffset;
    size_t maxLength = file.size() - *nameOffset;
    if (strnlen(name, maxLength) == maxLength || strcmp(name, exportName) != 0) continue;

    const auto* ordinal = At<WORD>(file, *ordinalsOffset + i * sizeof(WORD));
    if (ordinal == nullptr || *ordinal >= exports->NumberOfFunctions) return std::nullopt;
    const auto* functionRva = At<DWORD>(file, *functionsOffset + *ordinal * sizeof(DWORD));
    if (functionRva == nullptr) return std::nullopt;
    // An RVA inside the export directory is a forwarder string ("DLL.Function"), not code.
    if (*functionRva >= exportDirectory.VirtualAddress &&
        *functionRva < exportDirectory.VirtualAddress + exportDirectory.Size) {
      return std::nullopt;
    }
    return *functionRva;
  }
  return std::nullopt;
}

std::optional<uintptr_t> FindRemoteModule(HANDLE process, const std::wstring& fileName) {
  // In a 32-bit game only its 32-bit modules matter (the 64-bit ntdll/wow64 layer is not
  // where LoadLibraryW or our DLL live).
  BOOL wow64 = FALSE;
  IsWow64Process(process, &wow64);
  std::vector<HMODULE> modules(1024);
  DWORD needed = 0;
  if (!EnumProcessModulesEx(process, modules.data(),
                            static_cast<DWORD>(modules.size() * sizeof(HMODULE)), &needed,
                            wow64 ? LIST_MODULES_32BIT : LIST_MODULES_ALL)) {
    return std::nullopt;
  }
  const std::wstring wanted = ToLower(fileName);
  size_t count = std::min<size_t>(needed / sizeof(HMODULE), modules.size());
  wchar_t name[MAX_PATH];
  for (size_t i = 0; i < count; ++i) {
    if (GetModuleBaseNameW(process, modules[i], name, MAX_PATH) > 0 && ToLower(name) == wanted) {
      return reinterpret_cast<uintptr_t>(modules[i]);
    }
  }
  return std::nullopt;
}

namespace {

// Address of LoadLibraryW inside `process`.
std::optional<uintptr_t> RemoteLoadLibraryW(HANDLE process) {
  BOOL wow64 = FALSE;
  IsWow64Process(process, &wow64);
  if (!wow64) {
    // kernel32 is mapped at the same address in every 64-bit process during a boot
    // session, so our own LoadLibraryW address is valid in the game too.
    return reinterpret_cast<uintptr_t>(
        GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
  }
  // 32-bit game: find its 32-bit kernel32 (or KernelBase) and read the export's RVA from
  // the matching file in SysWOW64.
  wchar_t systemWow64[MAX_PATH];
  UINT length = GetSystemWow64DirectoryW(systemWow64, MAX_PATH);
  if (length == 0 || length >= MAX_PATH) return std::nullopt;
  for (const wchar_t* module : {L"kernel32.dll", L"KernelBase.dll"}) {
    auto base = FindRemoteModule(process, module);
    auto rva = FindExportRva(std::wstring(systemWow64) + L"\\" + module, "LoadLibraryW");
    if (base && rva) return *base + *rva;
  }
  return std::nullopt;
}

}  // namespace

bool InjectAndAttach(HANDLE process, const std::wstring& dllPath, HelperError& error) {
  const std::wstring dllName = FileNameOf(dllPath);
  auto attachRva = FindExportRva(dllPath, "InputSplitAttach");
  if (!attachRva) {
    error = {"hookInvalid", ToUtf8(dllName) + " has no InputSplitAttach export."};
    return false;
  }
  auto base = FindRemoteModule(process, dllName);

  if (!base) {
    // Step 1: LoadLibraryW in the game.
    auto loadLibraryAddress = RemoteLoadLibraryW(process);
    if (!loadLibraryAddress) {
      error = {"injectionFailed", "LoadLibraryW was not found in the game."};
      return false;
    }
    auto loadLibrary = reinterpret_cast<LPTHREAD_START_ROUTINE>(*loadLibraryAddress);
    const size_t bytes = (dllPath.size() + 1) * sizeof(wchar_t);
    void* remotePath = VirtualAllocEx(process, nullptr, bytes, MEM_COMMIT | MEM_RESERVE,
                                      PAGE_READWRITE);
    if (remotePath == nullptr) {
      error = {"injectionFailed", "VirtualAllocEx failed with error " + std::to_string(GetLastError())};
      return false;
    }
    if (!WriteProcessMemory(process, remotePath, dllPath.c_str(), bytes, nullptr)) {
      error = {"injectionFailed", "WriteProcessMemory failed with error " + std::to_string(GetLastError())};
      VirtualFreeEx(process, remotePath, 0, MEM_RELEASE);
      return false;
    }
    DWORD result = RunRemoteThread(process, loadLibrary, remotePath, kLoadTimeoutMs, error);
    if (result == static_cast<DWORD>(-1)) {
      // If the thread timed out it may still read the path: only free it if it never ran.
      if (error.code == "injectionFailed") VirtualFreeEx(process, remotePath, 0, MEM_RELEASE);
      return false;
    }
    VirtualFreeEx(process, remotePath, 0, MEM_RELEASE);
    // The thread's exit code is a truncated HMODULE on 64-bit, so look the module up.
    base = FindRemoteModule(process, dllName);
    if (!base) {
      error = {"injectionFailed", "The game refused to load " + ToUtf8(dllName) + "."};
      return false;
    }
  }

  // Step 2: start the hook's worker outside of the loader lock.
  auto attach = reinterpret_cast<LPTHREAD_START_ROUTINE>(*base + *attachRva);
  DWORD result = RunRemoteThread(process, attach, nullptr, kAttachTimeoutMs, error);
  if (result == static_cast<DWORD>(-1)) return false;
  if (result != 0) {
    error = {"attachFailed", "InputSplitAttach failed inside the game."};
    return false;
  }
  return true;
}

}  // namespace inputsplit::helper
