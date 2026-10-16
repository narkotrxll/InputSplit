/**
 * Constants and defaults that do not need Zod. The renderer imports values from here
 * (types come from ./domain with `import type`, which costs nothing at runtime).
 */
import type { FeatureFlags, IsolationView, Settings } from './domain'

/** Shows the "Support the author" button (Donatello donation page) in the sidebar. */
export const SHOW_DONATE_BUTTON = true

export const FEATURE_NAMES = [
  'activationShield',
  'focusSpoof',
  'xinputBackground',
  'xinputSlotLock',
  'blockKeyboard',
  'blockMouse',
  'cursorGuard',
] as const

export const DEFAULT_FEATURES: FeatureFlags = {
  activationShield: true,
  focusSpoof: true,
  xinputBackground: true,
  xinputSlotLock: true,
  blockKeyboard: true,
  blockMouse: true,
  cursorGuard: true,
}

export const IDLE_VIEW: IsolationView = {
  phase: 'idle',
  sessionId: null,
  target: null,
  controllerSlot: null,
  displayId: null,
  startedAt: null,
  features: [],
  limitations: [],
  warnings: [],
  error: null,
  endedReason: null,
  counters: null,
  detectedApis: [],
  windowMoved: false,
  audioDevice: null,
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  onboardingCompleted: false,
  riskAcknowledgedAt: null,
  closeToTray: true,
  startMinimized: false,
  emergencyHotkeyEnabled: true,
  defaultFeatures: DEFAULT_FEATURES,
  moveWindowByDefault: true,
  restoreOnExit: true,
  lastControllerSlot: null,
  lastDisplayId: null,
  showAllWindows: false,
  verboseLogging: false,
  theme: 'dark',
  language: 'system',
  launchAtLogin: false,
  notifications: true,
  gamepadHotkeyEnabled: true,
  rumbleFeedback: true,
  checkForUpdates: true,
  twoPlayers: false,
  languageChosen: false,
  antiCheatProtection: true,
  gameAudioToDisplay: true,
  overlayHotkeyEnabled: true,
  gamepadTuning: {
    leftDeadzone: 0,
    rightDeadzone: 0,
    triggerDeadzone: 0,
    remap: {},
    playerOrder: [0, 1, 2, 3],
  },
  blockGameBarButton: true,
  controllerAlerts: true,
  padBridge: false,
}

/** XInput button bit masks (XINPUT_GAMEPAD_*). */
export const XInputButton = {
  dpadUp: 0x0001,
  dpadDown: 0x0002,
  dpadLeft: 0x0004,
  dpadRight: 0x0008,
  start: 0x0010,
  back: 0x0020,
  leftThumb: 0x0040,
  rightThumb: 0x0080,
  leftShoulder: 0x0100,
  rightShoulder: 0x0200,
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
} as const

export type GamepadButton = keyof typeof XInputButton
/** Buttons in the order the remapping table shows them. */
export const GAMEPAD_BUTTONS = [
  'a',
  'b',
  'x',
  'y',
  'leftShoulder',
  'rightShoulder',
  'back',
  'start',
  'leftThumb',
  'rightThumb',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
] as const satisfies readonly GamepadButton[]
