/**
 * Domain model shared by the main process and the renderer.
 *
 * Every shape is a Zod schema first and a TypeScript type second (`z.infer`). The main
 * process uses the schemas to validate everything that crosses a trust boundary: data from
 * the native helper and requests from the renderer.
 *
 * This file must not import Electron or Node modules: the renderer bundles it too.
 */
import { z } from 'zod'
import { FEATURE_NAMES } from './defaults'
import { LANGUAGE_SETTINGS } from './locales'
import { SEAT_COUNT } from './seats'

// Zod-free constants live in ./defaults so the renderer can use them without bundling Zod.
export * from './defaults'

// ---------------------------------------------------------------------------------------
// Geometry

export const RectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
})
export type Rect = z.infer<typeof RectSchema>

// ---------------------------------------------------------------------------------------
// Windows and processes (from the helper's `listWindows`)

export const ArchitectureSchema = z.enum(['x86', 'x64', 'arm64', 'unknown'])

/** Hints computed by the helper; translated in the UI (`apps.hints.*`). */
export const GameHintSchema = z.string()

export const WindowInfoSchema = z.object({
  hwnd: z.number().int().nonnegative(),
  title: z.string(),
  className: z.string(),
  pid: z.number().int().positive(),
  exePath: z.string().nullable(),
  exeName: z.string(),
  architecture: ArchitectureSchema,
  accessible: z.boolean(),
  elevated: z.boolean(),
  isMinimized: z.boolean(),
  isForeground: z.boolean(),
  rect: RectSchema,
  monitor: z.string(),
  gameScore: z.number().int(),
  isLikelyGame: z.boolean(),
  hints: z.array(GameHintSchema),
})
export type WindowInfo = z.infer<typeof WindowInfoSchema>

/** What the UI needs to remember about the chosen game window. */
export const TargetRefSchema = z.object({
  pid: z.number().int().positive(),
  hwnd: z.number().int().nonnegative(),
  title: z.string(),
  exeName: z.string(),
  exePath: z.string().nullable(),
})
export type TargetRef = z.infer<typeof TargetRefSchema>

export const FindingSchema = z.object({ code: z.string(), message: z.string() })
export type Finding = z.infer<typeof FindingSchema>

export const TargetCheckSchema = z.object({
  pid: z.number().int(),
  exePath: z.string().nullable(),
  architecture: ArchitectureSchema,
  blockers: z.array(FindingSchema),
  warnings: z.array(FindingSchema),
  antiCheat: z.string().nullable(),
})
export type TargetCheck = z.infer<typeof TargetCheckSchema>

// ---------------------------------------------------------------------------------------
// Controllers

export const BatterySchema = z.object({
  type: z.enum(['wired', 'alkaline', 'nimh', 'disconnected', 'unknown']),
  level: z.enum(['empty', 'low', 'medium', 'full']),
})

/** Which controller the test view draws. */
export const GamepadModelSchema = z.enum([
  'xbox',
  'dualshock4',
  'dualsense',
  'switchPro',
  'generic',
])
export type GamepadModel = z.infer<typeof GamepadModelSchema>

export const ControllerSchema = z.object({
  slot: z.number().int().min(0).max(3),
  connected: z.boolean(),
  kind: z.string(),
  wireless: z.boolean().nullable(),
  battery: BatterySchema.nullable(),
  /** USB ids from XInputGetCapabilitiesEx; null where XInput does not report them. */
  vendorId: z.number().int().nullable().optional(),
  productId: z.number().int().nullable().optional(),
  /** Filled in by the main process from the ids above (see gamepad-models.ts). */
  model: GamepadModelSchema.optional(),
})
export type Controller = z.infer<typeof ControllerSchema>

/** A HID game controller that is not an XInput device (PlayStation, Nintendo, …). */
export const HidGamepadSchema = z.object({
  vendorId: z.number().int(),
  productId: z.number().int(),
})
export type HidGamepad = z.infer<typeof HidGamepadSchema>

export const ControllerStateSchema = z.object({
  slot: z.number().int().min(0).max(3),
  connected: z.boolean(),
  packet: z.number().int().optional(),
  buttons: z.number().int().optional(),
  guide: z.boolean().optional(),
  leftTrigger: z.number().int().optional(),
  rightTrigger: z.number().int().optional(),
  thumbLX: z.number().int().optional(),
  thumbLY: z.number().int().optional(),
  thumbRX: z.number().int().optional(),
  thumbRY: z.number().int().optional(),
})
export type ControllerState = z.infer<typeof ControllerStateSchema>

// ---------------------------------------------------------------------------------------
// Displays

export const DisplaySchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrimary: z.boolean(),
  bounds: RectSchema,
  workArea: RectSchema,
  dpi: z.number().int(),
  scale: z.number(),
  refreshRate: z.number().int(),
  connection: z.string(),
  isLikelyTv: z.boolean(),
})
export type Display = z.infer<typeof DisplaySchema>

// ---------------------------------------------------------------------------------------
// Isolation features

export const FeatureNameSchema = z.enum(FEATURE_NAMES)
export type FeatureName = z.infer<typeof FeatureNameSchema>

export const FeatureFlagsSchema = z.object({
  activationShield: z.boolean(),
  focusSpoof: z.boolean(),
  xinputBackground: z.boolean(),
  xinputSlotLock: z.boolean(),
  blockKeyboard: z.boolean(),
  blockMouse: z.boolean(),
  cursorGuard: z.boolean(),
})
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>

export const DetectedApiSchema = z.enum([
  'xinput',
  'directInput8',
  'windowsGamingInput',
  'gameInput',
  'sdl2',
  'sdl3',
  'unity',
  'steamApi',
])
export type DetectedApi = z.infer<typeof DetectedApiSchema>

export const SessionCountersSchema = z.object({
  xinputReads: z.number().nonnegative(),
  blockedKeyboard: z.number().nonnegative(),
  blockedMouse: z.number().nonnegative(),
  swallowedFocusEvents: z.number().nonnegative(),
  blockedCursorCalls: z.number().nonnegative(),
  xinputEnableBlocked: z.number().nonnegative(),
  /** Reads of DirectInput controllers (GetDeviceState / GetDeviceData). */
  directInputReads: z.number().nonnegative().default(0),
  /** Raw Input records from HID controllers that the game read. */
  rawGamepadReads: z.number().nonnegative().default(0),
})
export type SessionCounters = z.infer<typeof SessionCountersSchema>

/** Status of one isolated game as reported by the hook DLL (via the helper). */
export const SessionStatusSchema = z.object({
  sessionId: z.number().int(),
  pid: z.number().int(),
  architectureBits: z.number().int(),
  requested: z.array(FeatureNameSchema),
  active: z.array(FeatureNameSchema),
  failed: z.array(FeatureNameSchema),
  detectedApis: z.array(DetectedApiSchema),
  gameWindow: z.number().int().nonnegative(),
  subclassedWindows: z.number().int().nonnegative(),
  xinputSlot: z.number().int().nullable(),
  counters: SessionCountersSchema,
  updatedAt: z.number(),
})
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionEndReasonSchema = z.enum([
  'stopped',
  'processExited',
  'hookDisconnected',
  'emergencyStop',
  'helperShutdown',
  'helperCrashed',
  'error',
])
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>

// ---------------------------------------------------------------------------------------
// What the UI shows about the isolation (computed in the main process)

/**
 * `active`      confirmed by the hook DLL
 * `pending`     requested, not confirmed yet (e.g. waiting for the game to read the pad)
 * `failed`      the DLL could not apply it
 * `unsupported` applied, but the game evidently does not use the mechanism we cover
 * `off`         not requested
 */
export const FeatureStateSchema = z.enum(['active', 'pending', 'failed', 'unsupported', 'off'])
export type FeatureState = z.infer<typeof FeatureStateSchema>

export const FeatureReportSchema = z.object({
  name: FeatureNameSchema,
  state: FeatureStateSchema,
  /** i18n key suffix explaining the state, e.g. `usesWindowsGamingInput`. */
  reason: z.string().nullable(),
})
export type FeatureReport = z.infer<typeof FeatureReportSchema>

export const UiStatusSchema = z.enum([
  'notConfigured',
  'ready',
  'isolating',
  'active',
  'limited',
  'error',
  'disconnected',
])
export type UiStatus = z.infer<typeof UiStatusSchema>

export const IsolationPhaseSchema = z.enum([
  'idle',
  'checking',
  'starting',
  'running',
  'stopping',
  'failed',
  'ended',
])
export type IsolationPhase = z.infer<typeof IsolationPhaseSchema>

export const AppErrorSchema = z.object({ code: z.string(), message: z.string() })
export type AppError = z.infer<typeof AppErrorSchema>

export const IsolationViewSchema = z.object({
  phase: IsolationPhaseSchema,
  sessionId: z.number().int().nullable(),
  target: TargetRefSchema.nullable(),
  controllerSlot: z.number().int().min(0).max(3).nullable(),
  displayId: z.string().nullable(),
  startedAt: z.number().nullable(),
  features: z.array(FeatureReportSchema),
  /** i18n keys (`limitations.*`) describing known limits for this game. */
  limitations: z.array(z.string()),
  warnings: z.array(FindingSchema),
  error: AppErrorSchema.nullable(),
  endedReason: SessionEndReasonSchema.nullable(),
  counters: SessionCountersSchema.nullable(),
  detectedApis: z.array(DetectedApiSchema),
  windowMoved: z.boolean(),
  /** The screen's speakers the game's sound plays on, or null when it was left alone. */
  audioDevice: z.string().nullable(),
})
export type IsolationView = z.infer<typeof IsolationViewSchema>

/** Two players, two games: each seat runs its own session (0 = player 1). */
export const SeatSchema = z
  .number()
  .int()
  .min(0)
  .max(SEAT_COUNT - 1)
export type Seat = z.infer<typeof SeatSchema>

export const StartIsolationInputSchema = z.object({
  seat: SeatSchema.default(0),
  target: TargetRefSchema,
  controllerSlot: z.number().int().min(0).max(3).nullable(),
  displayId: z.string().max(64).nullable(),
  moveWindow: z.boolean(),
  restoreOnExit: z.boolean(),
  features: FeatureFlagsSchema,
})
export type StartIsolationInput = z.infer<typeof StartIsolationInputSchema>

// ---------------------------------------------------------------------------------------
// Backend (native helper) state

export const BackendStatusSchema = z.enum([
  'starting',
  'ready',
  'restarting',
  'crashed',
  'unavailable',
])
export type BackendStatus = z.infer<typeof BackendStatusSchema>

export const BackendStateSchema = z.object({
  status: BackendStatusSchema,
  /** i18n key for `unavailable`/`crashed`: unsupportedPlatform, helperMissing, … */
  reason: z.string().nullable(),
  simulated: z.boolean(),
  helperVersion: z.string().nullable(),
  windowsBuild: z.number().int().nullable(),
  isElevated: z.boolean(),
  hookDllFound: z.boolean(),
  emergencyHotkey: z.string().nullable(),
  emergencyHotkeyRegistered: z.boolean(),
})
export type BackendState = z.infer<typeof BackendStateSchema>

// ---------------------------------------------------------------------------------------
// Profiles and settings

export const ProfileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  exeName: z.string().trim().min(1).max(260),
  exePath: z.string().max(1024).nullable(),
  controllerSlot: z.number().int().min(0).max(3).nullable(),
  displayId: z.string().max(64).nullable(),
  displayName: z.string().max(120).nullable(),
  moveWindow: z.boolean(),
  restoreOnExit: z.boolean(),
  features: FeatureFlagsSchema,
  /** Start isolation automatically as soon as this game's window appears. */
  autoStart: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().nullable(),
})
export type Profile = z.infer<typeof ProfileSchema>

export const ProfileInputSchema = ProfileSchema.omit({
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
}).extend({ id: z.string().min(1).max(64).nullable() })
export type ProfileInput = z.infer<typeof ProfileInputSchema>

const SETTINGS_FIELDS = {
  version: z.literal(1),
  onboardingCompleted: z.boolean(),
  riskAcknowledgedAt: z.string().nullable(),
  closeToTray: z.boolean(),
  startMinimized: z.boolean(),
  emergencyHotkeyEnabled: z.boolean(),
  defaultFeatures: FeatureFlagsSchema,
  moveWindowByDefault: z.boolean(),
  restoreOnExit: z.boolean(),
  lastControllerSlot: z.number().int().min(0).max(3).nullable(),
  lastDisplayId: z.string().max(64).nullable(),
  showAllWindows: z.boolean(),
  verboseLogging: z.boolean(),
  theme: z.enum(['dark', 'light', 'system']),
  language: z.enum(LANGUAGE_SETTINGS),
}

/** Settings added after 0.1.0. They get defaults below so older settings files stay valid. */
const ADDED_SETTINGS_FIELDS = {
  launchAtLogin: z.boolean(),
  notifications: z.boolean(),
  gamepadHotkeyEnabled: z.boolean(),
  rumbleFeedback: z.boolean(),
  checkForUpdates: z.boolean(),
  twoPlayers: z.boolean(),
  /** True once the language was picked in Settings (see SettingsService.load). */
  languageChosen: z.boolean(),
  /**
   * Refuse games with anti-cheat and the built-in blocked titles. The user may turn it off
   * and accept the ban risk; risky games then need a confirmation on every start.
   */
  antiCheatProtection: z.boolean(),
  /** Play the game's sound on the chosen screen's speakers (TV, monitor) while isolated. */
  gameAudioToDisplay: z.boolean(),
}

export const SettingsSchema = z.object({
  ...SETTINGS_FIELDS,
  launchAtLogin: ADDED_SETTINGS_FIELDS.launchAtLogin.default(false),
  notifications: ADDED_SETTINGS_FIELDS.notifications.default(true),
  gamepadHotkeyEnabled: ADDED_SETTINGS_FIELDS.gamepadHotkeyEnabled.default(true),
  rumbleFeedback: ADDED_SETTINGS_FIELDS.rumbleFeedback.default(true),
  checkForUpdates: ADDED_SETTINGS_FIELDS.checkForUpdates.default(true),
  twoPlayers: ADDED_SETTINGS_FIELDS.twoPlayers.default(false),
  languageChosen: ADDED_SETTINGS_FIELDS.languageChosen.default(false),
  antiCheatProtection: ADDED_SETTINGS_FIELDS.antiCheatProtection.default(true),
  gameAudioToDisplay: ADDED_SETTINGS_FIELDS.gameAudioToDisplay.default(true),
})
export type Settings = z.infer<typeof SettingsSchema>

// Built without the defaults: Zod applies `.default()` even inside `.partial()`, so a patch
// that omits `launchAtLogin` would otherwise silently reset it.
export const SettingsPatchSchema = z
  .object({ ...SETTINGS_FIELDS, ...ADDED_SETTINGS_FIELDS })
  .omit({ version: true })
  .partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

// ---------------------------------------------------------------------------------------
// Compatibility memory: how each game behaved the last time it was isolated on this PC

export const CompatRecordSchema = z.object({
  outcome: z.enum(['works', 'limited', 'failed']),
  at: z.string(),
})
export type CompatRecord = z.infer<typeof CompatRecordSchema>

/** Keyed by lower-case executable name. */
export const CompatHistorySchema = z.record(z.string().max(260), CompatRecordSchema)
export type CompatHistory = z.infer<typeof CompatHistorySchema>

// ---------------------------------------------------------------------------------------
// Automation (profiles started by InputSplit itself) and updates

export const AutomationStateSchema = z.object({
  /** `launching`: the game is being started; `waiting`: waiting for its window. */
  phase: z.enum(['idle', 'launching', 'waiting']),
  profileId: z.string().nullable(),
  profileName: z.string().nullable(),
  /** Why the last "Play" (tray, profile card) failed before isolation could start. */
  error: AppErrorSchema.nullable(),
})
export type AutomationState = z.infer<typeof AutomationStateSchema>

export const UpdateStateSchema = z.object({
  status: z.enum([
    'idle',
    'checking',
    'upToDate',
    'available',
    'downloading',
    /** Downloaded and verified; installs when InputSplit restarts or quits. */
    'ready',
    'installing',
    'error',
  ]),
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  releaseUrl: z.string().nullable(),
  /** 0–100 while downloading. */
  progress: z.number().min(0).max(100).nullable(),
  /** Installing needs the packaged app (the installer replaces it). */
  canInstall: z.boolean(),
  checkedAt: z.number().nullable(),
  /**
   * Why the last check failed: `unreachable` when GitHub has no public release to show
   * (the repository is private or has no releases), `rateLimited` when GitHub refused for a
   * while, `network` otherwise.
   */
  errorReason: z.enum(['unreachable', 'rateLimited', 'network']).nullable(),
})
export type UpdateState = z.infer<typeof UpdateStateSchema>

// ---------------------------------------------------------------------------------------
// Installed games found in the Steam, Epic Games and GOG Galaxy libraries

export const LibraryStoreSchema = z.enum(['steam', 'epic', 'gog'])
export type LibraryStore = z.infer<typeof LibraryStoreSchema>

export const LibraryGameSchema = z.object({
  /** `<store>:<store's own id>`; the cover is fetched by this id. */
  id: z.string(),
  store: LibraryStoreSchema,
  name: z.string(),
  exeName: z.string(),
  exePath: z.string(),
  hasCover: z.boolean(),
})
export type LibraryGame = z.infer<typeof LibraryGameSchema>

// ---------------------------------------------------------------------------------------
// Play time: how long each game was isolated, keyed by lower-case executable name

export const PlaytimeRecordSchema = z.object({
  totalMs: z.number().nonnegative(),
  sessions: z.number().int().nonnegative(),
  lastPlayedAt: z.string(),
})
export type PlaytimeRecord = z.infer<typeof PlaytimeRecordSchema>

export const PlaytimeSchema = z.record(z.string().max(260), PlaytimeRecordSchema)
export type Playtime = z.infer<typeof PlaytimeSchema>

// ---------------------------------------------------------------------------------------
// Backup file: profiles, settings and play time, to move to another PC

/** Settings that belong to the person, not to this PC (no onboarding, last controller…). */
export const BACKUP_SETTINGS_KEYS = [
  'closeToTray',
  'startMinimized',
  'launchAtLogin',
  'notifications',
  'emergencyHotkeyEnabled',
  'gamepadHotkeyEnabled',
  'rumbleFeedback',
  'checkForUpdates',
  'twoPlayers',
  'defaultFeatures',
  'moveWindowByDefault',
  'restoreOnExit',
  'gameAudioToDisplay',
  'showAllWindows',
  'verboseLogging',
  'theme',
  'language',
  'languageChosen',
] as const satisfies readonly (keyof SettingsPatch)[]

export const BackupSchema = z.object({
  format: z.literal('inputsplit-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  appVersion: z.string(),
  profiles: z.array(ProfileSchema).max(1000),
  settings: SettingsPatchSchema.optional(),
  playtime: PlaytimeSchema.optional(),
})
export type Backup = z.infer<typeof BackupSchema>

export const BackupImportResultSchema = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
})
export type BackupImportResult = z.infer<typeof BackupImportResultSchema>

// ---------------------------------------------------------------------------------------
// Logs and app info

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
export type LogLevel = z.infer<typeof LogLevelSchema>

export const LogEntrySchema = z.object({
  time: z.number(),
  level: LogLevelSchema,
  source: z.enum(['app', 'helper', 'hook']),
  message: z.string(),
})
export type LogEntry = z.infer<typeof LogEntrySchema>

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  electron: z.string(),
  chrome: z.string(),
  platform: z.string(),
  arch: z.string(),
  isPackaged: z.boolean(),
  userDataPath: z.string(),
  /** Windows' preferred languages, most preferred first ("Same as Windows" follows them). */
  systemLanguages: z.array(z.string()),
})
export type AppInfo = z.infer<typeof AppInfoSchema>
