/** Test doubles shared by the service tests. */
import { vi } from 'vitest'
import type { BackendState, SessionStatus } from '@shared/domain'
import { Emitter } from '../../util/emitter'
import { initialBackendState, type NativeBackend } from '../backend'
import type { HelperEvent, HelperMethod } from '../protocol'

type Handler = (params: unknown) => unknown

export class FakeBackend implements NativeBackend {
  readonly simulated = true
  state: BackendState = { ...initialBackendState(true), status: 'ready' }
  events = new Emitter<HelperEvent>()
  states = new Emitter<BackendState>()
  calls: { method: HelperMethod; params: unknown }[] = []
  handlers: Partial<Record<HelperMethod, Handler>> = {}

  start = vi.fn(async () => {})
  stop = vi.fn(async () => {})
  restart = vi.fn(async () => {})
  setEmergencyHotkey = vi.fn(async () => {})
  getState = () => this.state
  onEvent = (l: (e: HelperEvent) => void) => this.events.on(l)
  onState = (l: (s: BackendState) => void) => this.states.on(l)

  async request(method: HelperMethod, params: unknown): Promise<never> {
    this.calls.push({ method, params })
    const handler = this.handlers[method]
    if (!handler) throw new Error(`unexpected ${method}`)
    return handler(params) as never
  }
}

export function sessionStatus(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: 7,
    pid: 42,
    architectureBits: 64,
    requested: [
      'activationShield',
      'focusSpoof',
      'xinputBackground',
      'xinputSlotLock',
      'blockKeyboard',
      'blockMouse',
      'cursorGuard',
    ],
    active: [
      'activationShield',
      'focusSpoof',
      'xinputBackground',
      'xinputSlotLock',
      'blockKeyboard',
      'blockMouse',
      'cursorGuard',
    ],
    failed: [],
    detectedApis: ['xinput'],
    gameWindow: 1,
    subclassedWindows: 1,
    xinputSlot: 0,
    counters: {
      xinputReads: 10,
      blockedKeyboard: 0,
      blockedMouse: 0,
      swallowedFocusEvents: 0,
      blockedCursorCalls: 0,
      xinputEnableBlocked: 0,
    },
    updatedAt: 0,
    ...overrides,
  }
}

