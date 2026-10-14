import { Crosshair, EyeOff, Focus, Gamepad2, Keyboard, Lock, MousePointer2 } from '@lucide/vue'
import type { Component } from 'vue'
import type { FeatureName } from '@shared/domain'

/** Display order and icons of the protections. Texts live in i18n (`features.<name>`). */
export const FEATURE_META: { name: FeatureName; icon: Component }[] = [
  { name: 'activationShield', icon: EyeOff },
  { name: 'focusSpoof', icon: Focus },
  { name: 'xinputBackground', icon: Gamepad2 },
  { name: 'xinputSlotLock', icon: Lock },
  { name: 'blockKeyboard', icon: Keyboard },
  { name: 'blockMouse', icon: MousePointer2 },
  { name: 'cursorGuard', icon: Crosshair },
]
