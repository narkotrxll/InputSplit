# InputSplit native layer.
#
#   InputSplitHook64.dll   injected into 64-bit games (hook/)
#   InputSplitHook32.dll   injected into 32-bit games (hook/, built by the 32-bit configuration)
#   inputsplit-helper.exe  control process started by the Electron app (helper/, 64-bit only)
#   InputSplitProbe.exe    test "game" used to measure isolation (probe/; InputSplitProbe32.exe)
#
# Windows (MSVC):  cmake -S native -B native/build -A x64 && cmake --build native/build --config Release
#        32-bit:   cmake -S native -B native/build32 -A Win32 && cmake --build native/build32 --config Release
# Linux (MinGW):   cmake -S native -B native/build-mingw -DCMAKE_TOOLCHAIN_FILE=native/cmake/mingw-w64-x86_64.cmake
#        32-bit:   cmake -S native -B native/build-mingw32 -DCMAKE_TOOLCHAIN_FILE=native/cmake/mingw-w64-i686.cmake
cmake_minimum_required(VERSION 3.21)
project(InputSplitNative LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT WIN32)
  message(FATAL_ERROR "The native layer targets Windows. On Linux use the MinGW toolchain file.")
endif()

# The 64-bit helper injects into both 64-bit and 32-bit (WOW64) games, so a 32-bit
# configuration only builds the hook DLL and the test game.
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set(INPUTSPLIT_BITS 64)
else()
  set(INPUTSPLIT_BITS 32)
endif()

# Version from package.json so the UI, helper and DLL always agree.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../package.json" INPUTSPLIT_PACKAGE_JSON)
string(JSON INPUTSPLIT_VERSION GET "${INPUTSPLIT_PACKAGE_JSON}" version)
message(STATUS "InputSplit version ${INPUTSPLIT_VERSION}")

# Static runtime: the DLL must not depend on a VC++ redistributable inside the game.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# All binaries in one folder (the helper expects the DLL next to it). "$<0:>" stops
# multi-config generators (Visual Studio) from adding a Release/Debug sub-folder.
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin/$<0:>")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin/$<0:>")

include(FetchContent)
FetchContent_Declare(minhook
  GIT_REPOSITORY https://github.com/TsudaKageyu/minhook.git
  GIT_TAG c3fcafdc10146beb5919319d0683e44e3c30d537  # v1.3.4
  GIT_SHALLOW FALSE)
FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(minhook nlohmann_json)

function(inputsplit_common_options target)
  target_compile_definitions(${target} PRIVATE
    UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00
    INPUTSPLIT_VERSION="${INPUTSPLIT_VERSION}")
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wno-cast-function-type)
    target_link_options(${target} PRIVATE -static -static-libgcc -static-libstdc++)
    if(INPUTSPLIT_BITS EQUAL 32)
      # Undecorated stdcall exports (InputSplitAttach, not InputSplitAttach@4).
      target_link_options(${target} PRIVATE -Wl,--enable-stdcall-fixup -Wl,--kill-at)
    endif()
  endif()
endfunction()

add_subdirectory(hook)
if(INPUTSPLIT_BITS EQUAL 64)
  add_subdirectory(helper)
endif()
add_subdirectory(probe)
