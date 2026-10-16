add_library(InputSplitHook SHARED
  dllmain.cpp
  pipe_client.cpp
  controller.cpp
  activation_shield.cpp
  focus_spoof.cpp
  cursor_guard.cpp
  input_block.cpp
  xinput_bridge.cpp
  directinput_bridge.cpp
  rawinput_bridge.cpp
  detection.cpp
  frame_stats.cpp
  tuning.cpp
  minhook_util.cpp
  log.cpp
  hook.def)
set_target_properties(InputSplitHook PROPERTIES OUTPUT_NAME "InputSplitHook${INPUTSPLIT_BITS}" PREFIX "")
inputsplit_common_options(InputSplitHook)
target_link_libraries(InputSplitHook PRIVATE minhook user32)
