/**
 * The complete list of messages between the renderer and the main process.
 *
 * - `invoke` channels: request → response. Each declares a Zod schema for its input and
 *   its output. The main process parses the input before running any handler.
 * - `events`: main → renderer notifications.
 *
 * The preload script exposes exactly these channels and nothing else.
 */
import { z } from 'zod'
import {
  AppInfoSchema,
  AutomationStateSchema,
  CompatHistorySchema,
  UpdateStateSchema,
  BackendStateSchema,
  ControllerSchema,
  ControllerStateSchema,
  DisplaySchema,
  IsolationViewSchema,
  SeatSchema,
  LogEntrySchema,
  ProfileInputSchema,
  ProfileSchema,
  SettingsPatchSchema,
  SettingsSchema,
  StartIsolationInputSchema,
  TargetCheckSchema,
  WindowInfoSchema,
} from './domain'

const none = z.undefined()
const ok = z.object({ ok: z.literal(true) })

export const invokeContract = {
  'app:getInfo': { input: none, output: AppInfoSchema },
  'app:openExternal': {
    input: z.enum(['repository', 'issues', 'license', 'docs', 'coffee']),
    output: ok,
  },

  'backend:getState': { input: none, output: BackendStateSchema },
  'backend:restart': { input: none, output: ok },

  'windows:list': { input: none, output: z.array(WindowInfoSchema) },
  'windows:icon': { input: z.string().min(1).max(1024), output: z.string().nullable() },
  'windows:checkTarget': { input: z.number().int().positive(), output: TargetCheckSchema },

  'controllers:list': { input: none, output: z.array(ControllerSchema) },
  'controllers:startTest': { input: z.number().int().min(0).max(3), output: ok },
  'controllers:stopTest': { input: none, output: ok },

  'displays:list': { input: none, output: z.array(DisplaySchema) },

  /** One view per seat (player 1, player 2). */
  'isolation:get': { input: none, output: z.array(IsolationViewSchema) },
  'isolation:start': { input: StartIsolationInputSchema, output: IsolationViewSchema },
  'isolation:stop': { input: SeatSchema, output: IsolationViewSchema },
  'isolation:dismiss': { input: SeatSchema, output: IsolationViewSchema },

  'profiles:list': { input: none, output: z.array(ProfileSchema) },
  'profiles:save': { input: ProfileInputSchema, output: ProfileSchema },
  'profiles:delete': { input: z.string().min(1).max(64), output: ok },
  'profiles:markUsed': { input: z.string().min(1).max(64), output: ok },
  /** Isolate the profile's game; with `launch`, start the game first if it is not open. */
  'profiles:play': {
    input: z.object({ id: z.string().min(1).max(64), launch: z.boolean() }),
    output: ok,
  },
  'profiles:pickExecutable': {
    input: none,
    output: z.object({ exePath: z.string(), exeName: z.string() }).nullable(),
  },

  'automation:get': { input: none, output: AutomationStateSchema },
  'automation:cancel': { input: none, output: ok },

  'compat:history': { input: none, output: CompatHistorySchema },

  'updates:get': { input: none, output: UpdateStateSchema },
  'updates:check': { input: none, output: UpdateStateSchema },
  'updates:install': { input: none, output: ok },
  'updates:openRelease': { input: none, output: ok },

  'settings:get': { input: none, output: SettingsSchema },
  'settings:update': { input: SettingsPatchSchema, output: SettingsSchema },

  'diagnostics:getLogs': { input: none, output: z.array(LogEntrySchema) },
  'diagnostics:openLogFolder': { input: none, output: ok },
  'diagnostics:export': { input: none, output: z.object({ saved: z.boolean() }) },
} as const

export const eventContract = {
  'backend:state': BackendStateSchema,
  'isolation:changed': z.object({ seat: SeatSchema, view: IsolationViewSchema }),
  'controllers:changed': z.array(ControllerSchema),
  'controllers:state': ControllerStateSchema,
  'displays:changed': z.array(DisplaySchema),
  'log:entry': LogEntrySchema,
  'automation:changed': AutomationStateSchema,
  'compat:changed': CompatHistorySchema,
  'updates:changed': UpdateStateSchema,
  'profiles:changed': z.array(ProfileSchema),
  'app:navigate': z.enum(['dashboard', 'applications', 'controllers', 'profiles', 'settings']),
} as const

export type InvokeChannel = keyof typeof invokeContract
export type InvokeInput<C extends InvokeChannel> = z.input<(typeof invokeContract)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['output']>

export type EventChannel = keyof typeof eventContract
export type EventPayload<E extends EventChannel> = z.output<(typeof eventContract)[E]>

/** Every invoke response is wrapped so errors keep their machine-readable code. */
export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

export const INVOKE_CHANNELS = Object.keys(invokeContract) as InvokeChannel[]
export const EVENT_CHANNELS = Object.keys(eventContract) as EventChannel[]

/** Shape of `window.inputsplit`, implemented in src/preload/index.ts. */
export interface InputSplitApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...input: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
  ): Promise<IpcResult<InvokeOutput<C>>>
  on<E extends EventChannel>(event: E, listener: (payload: EventPayload<E>) => void): () => void
}
