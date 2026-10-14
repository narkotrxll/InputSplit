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

export const ControllerSchema = z.object({
  slot: z.number().int().min(0).max(3),
  connected: z.boolean(),
  kind: z.string(),
  wireless: z.boolean().nullable(),
  battery: BatterySchema.nullable(),
})
export type Controller = z.infer<typeof ControllerSchema>

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
})
export type IsolationView = z.infer<typeof IsolationViewSchema>

export const StartIsolationInputSchema = z.object({
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

export const SettingsSchema = z.object({
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
})
export type Settings = z.infer<typeof SettingsSchema>

export const SettingsPatchSchema = SettingsSchema.omit({ version: true }).partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

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
})
export type AppInfo = z.infer<typeof AppInfoSchema>
