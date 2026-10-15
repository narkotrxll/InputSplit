# Cross-compiling the 32-bit hook DLL and test game from Linux with MinGW-w64 (compile checks).
# Release builds for users are produced with MSVC in GitHub Actions.
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR i686)
set(CMAKE_C_COMPILER i686-w64-mingw32-gcc-posix)
set(CMAKE_CXX_COMPILER i686-w64-mingw32-g++-posix)
set(CMAKE_RC_COMPILER i686-w64-mingw32-windres)
set(CMAKE_FIND_ROOT_PATH /usr/i686-w64-mingw32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
