#pragma once

#include <cstdint>

#include "../common/hook_protocol.h"

namespace inputsplit::hook {

void SnapshotApisAtAttach();
uint32_t ApisAtAttach();
proto::StatusMessage BuildStatus();

}  // namespace inputsplit::hook
