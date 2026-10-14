// version.h — version information shared by all native binaries.
// INPUTSPLIT_VERSION is injected by CMake from the root package.json version.
#pragma once

#ifndef INPUTSPLIT_VERSION
#define INPUTSPLIT_VERSION "0.0.0-dev"
#endif

// Changes whenever helper and DLL must be rebuilt together (bump with hook_protocol.h).
#define INPUTSPLIT_BUILD_ID 0x0001000000000001ull
