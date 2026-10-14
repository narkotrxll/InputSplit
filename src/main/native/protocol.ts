/**
 * Schemas for the helper's NDJSON protocol (see native/helper/main.cpp).
 *
 * The helper is our own code, but it is a different program that may be a different
 * version (e.g. a stale build). Validating every message turns version skew into a clear
 * error instead of `undefined` deep inside the UI.
 */
import { z } from 'zod'
import {
  ControllerSchema,
  ControllerStateSchema,
  DisplaySchema,
  HidGamepadSchema,
  LogLevelSchema,
  RectSchema,
  SessionEndReasonSchema,
  SessionStatusSchema,
  TargetCheckSchema,
  WindowInfoSchema,
} from '@shared/domain'

export const HELPER_PROTOCOL_VERSION = 1

const empty = z.object({}).passthrough()

/** `hidGamepads` came later; an older helper leaves it out. */
const ControllerListSchema = z.object({
  controllers: z.array(ControllerSchema),
  hidGamepads: z.array(HidGamepadSchema).optional(),
})

export const helperMethods = {
  hello: {
    params: empty,
    result: z.object({
      helperVersion: z.string(),
      protocolVersion: z.number().int(),
      hookProtocolVersion: z.number().int(),
      architecture: z.string(),
      windowsBuild: z.number().int(),
      isElevated: z.boolean(),
      pid: z.number().int(),
      hookDllFound: z.boolean(),
      emergencyHotkey: z.string(),
    }),
  },
  ping: { params: empty, result: z.object({ uptimeMs: z.number() }) },
  listWindows: {
    params: z.object({ excludePids: z.array(z.number().int()) }),
    result: z.object({ windows: z.array(WindowInfoSchema) }),
  },
  listControllers: { params: empty, result: ControllerListSchema },
  listDisplays: { params: empty, result: z.object({ displays: z.array(DisplaySchema) }) },
  startControllerTest: { params: z.object({ slot: z.number().int() }), result: empty },
  stopControllerTest: { params: empty, result: empty },
  checkTarget: {
    params: z.object({ pid: z.number().int(), allowAntiCheat: z.boolean().optional() }),
    result: TargetCheckSchema,
  },
  startIsolation: {
    params: z.object({
      pid: z.number().int(),
      hwnd: z.number().int().nullable(),
      features: z.record(z.string(), z.boolean()),
      xinputSlot: z.number().int().nullable(),
      allowAntiCheat: z.boolean().optional(),
    }),
    result: SessionStatusSchema,
  },
  updateIsolation: {
    params: z.object({
      sessionId: z.number().int(),
      features: z.record(z.string(), z.boolean()),
      xinputSlot: z.number().int().nullable(),
    }),
    result: empty,
  },
  stopIsolation: { params: z.object({ sessionId: z.number().int() }), result: empty },
  moveWindow: {
    params: z.object({
      hwnd: z.number().int(),
      displayId: z.string(),
      mode: z.enum(['auto', 'fill', 'center']),
    }),
    result: z.object({ previous: RectSchema, current: RectSchema }),
  },
  restoreWindowRect: {
    params: z.object({ hwnd: z.number().int(), rect: RectSchema }),
    result: z.object({ restored: z.boolean() }),
  },
  setEmergencyHotkey: {
    params: z.object({ enabled: z.boolean() }),
    result: z.object({ registered: z.boolean(), accelerator: z.string() }),
  },
  /** Watch every connected controller for the LB + RB + View hold (`gamepadHotkey`). */
  setGamepadHotkey: { params: z.object({ enabled: z.boolean() }), result: empty },
  /** Short vibration as feedback: `on` one pulse, `off` two pulses, `error` three. */
  rumble: {
    params: z.object({ slot: z.number().int().min(0).max(3), pattern: z.enum(['on', 'off', 'error']) }),
    result: empty,
  },
} as const

export type HelperMethod = keyof typeof helperMethods
export type HelperParams<M extends HelperMethod> = z.input<(typeof helperMethods)[M]['params']>
export type HelperResult<M extends HelperMethod> = z.output<(typeof helperMethods)[M]['result']>

export const helperEvents = {
  ready: z.object({ helperVersion: z.string(), pid: z.number().int() }),
  log: z.object({
    level: LogLevelSchema,
    source: z.enum(['helper', 'hook']),
    message: z.string(),
    pid: z.number().int().optional(),
  }),
  controllersChanged: ControllerListSchema,
  controllerState: ControllerStateSchema,
  displaysChanged: z.object({ displays: z.array(DisplaySchema) }),
  sessionStatus: SessionStatusSchema,
  sessionEnded: z.object({
    sessionId: z.number().int(),
    pid: z.number().int(),
    reason: SessionEndReasonSchema,
    message: z.string().optional(),
  }),
  emergencyStop: z.object({ stoppedSessions: z.number().int() }),
  gamepadHotkey: z.object({ slot: z.number().int().min(0).max(3) }),
} as const

export type HelperEventName = keyof typeof helperEvents
export type HelperEvent = {
  [K in HelperEventName]: { name: K; data: z.output<(typeof helperEvents)[K]> }
}[HelperEventName]

/** One line from the helper's stdout, before validation of `result`/`data`. */
export const helperLineSchema = z.union([
  z.object({ id: z.number().int(), result: z.unknown() }),
  z.object({
    id: z.number().int().nullable(),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({ event: z.string(), data: z.unknown() }),
])

export type HelperLine = z.infer<typeof helperLineSchema>

/** Parses one stdout line; returns null for anything that is not valid protocol JSON. */
export function parseHelperLine(line: string): HelperLine | null {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return null
  }
  const parsed = helperLineSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/** Validates an event's payload. Unknown events and invalid payloads return null. */
export function parseHelperEvent(name: string, data: unknown): HelperEvent | null {
  if (!(name in helperEvents)) return null
  const schema = helperEvents[name as HelperEventName]
  const parsed = schema.safeParse(data)
  return parsed.success ? ({ name, data: parsed.data } as HelperEvent) : null
}

/** Splits a stream of chunks into complete lines (the helper flushes whole lines). */
export class LineSplitter {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    return lines.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0)
  }
}
