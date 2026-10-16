add_executable(inputsplit-helper
  main.cpp
  rpc.cpp
  util.cpp
  process_info.cpp
  windows_enum.cpp
  safety.cpp
  controllers.cpp
  pad_bridge.cpp
  displays.cpp
  audio.cpp
  injector.cpp
  session.cpp
  system_window.cpp)
inputsplit_common_options(inputsplit-helper)
target_link_libraries(inputsplit-helper PRIVATE nlohmann_json::nlohmann_json
  user32 advapi32 psapi dwmapi setupapi hid cfgmgr32 ole32)
if(MINGW)
  target_link_options(inputsplit-helper PRIVATE -municode)
endif()
