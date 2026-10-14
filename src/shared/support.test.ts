import { describe, expect, it } from 'vitest'
import { IDLE_VIEW, type IsolationView, type SessionStatus } from './domain'
import { deriveUiStatus, evaluateSession, XINPUT_GRACE_MS } from './support'

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: 1,
    pid: 100,
    architectureBits: 64,
    requested: ['activationShield', 'focusSpoof', 'xinputBackground', 'blockKeyboard'],
    active: ['activationShield', 'focusSpoof', 'xinputBackground', 'blockKeyboard'],
    failed: [],
    detectedApis: ['xinput'],
    gameWindow: 1,
    subclassedWindows: 1,
    xinputSlot: 0,
    counters: {
      xinputReads: 120,
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

const stateOf = (s: SessionStatus, name: string, now = 10_000) =>
  evaluateSession(s, 0, now).features.find((f) => f.name === name)?.state

describe('evaluateSession', () => {
  it('reports confirmed features as active and unrequested ones as off', () => {
    const result = evaluateSession(status(), 0, 10_000)
    expect(stateOf(status(), 'activationShield')).toBe('active')
    expect(stateOf(status(), 'cursorGuard')).toBe('off')
    expect(result.limitations).toEqual([])
  })

  it('never reports a feature the DLL marked as failed as active', () => {
    const s = status({ active: ['activationShield'], failed: ['focusSpoof'] })
    expect(stateOf(s, 'focusSpoof')).toBe('failed')
  })

  it('keeps a requested but unconfirmed feature pending', () => {
    const s = status({ active: ['activationShield'] })
    expect(stateOf(s, 'blockKeyboard')).toBe('pending')
  })

  it('waits for the first XInput read during the grace period', () => {
    const s = status({ counters: { ...status().counters, xinputReads: 0 } })
    expect(stateOf(s, 'xinputBackground', XINPUT_GRACE_MS - 1)).toBe('pending')
  })

  it('explains a game that never reads XInput', () => {
    const s = status({
      detectedApis: ['windowsGamingInput'],
      counters: { ...status().counters, xinputReads: 0 },
    })
    const result = evaluateSession(s, 0, XINPUT_GRACE_MS + 1)
    const controller = result.features.find((f) => f.name === 'xinputBackground')
    expect(controller).toEqual({
      name: 'xinputBackground',
      state: 'unsupported',
      reason: 'usesWindowsGamingInput',
    })
    expect(result.limitations).toContain('windowsGamingInput')
  })

  it('flags a shield that protects no window', () => {
    expect(evaluateSession(status({ subclassedWindows: 0 }), 0, 1).limitations).toContain(
      'noWindowProtected',
    )
  })
})

describe('deriveUiStatus', () => {
  const running = (overrides: Partial<IsolationView> = {}): IsolationView => ({
    ...IDLE_VIEW,
    phase: 'running',
    sessionId: 1,
    controllerSlot: 0,
    features: evaluateSession(status(), 0, 10_000).features,
    ...overrides,
  })

  it('is notConfigured without a target and ready with one', () => {
    const base = { backend: 'ready' as const, view: IDLE_VIEW, controllerConnected: true }
    expect(deriveUiStatus({ ...base, hasTarget: false })).toBe('notConfigured')
    expect(deriveUiStatus({ ...base, hasTarget: true })).toBe('ready')
  })

  it('is error when the backend is unavailable', () => {
    expect(
      deriveUiStatus({
        backend: 'unavailable',
        view: IDLE_VIEW,
        hasTarget: true,
        controllerConnected: true,
      }),
    ).toBe('error')
  })

  it('is isolating while checking, starting or stopping', () => {
    for (const phase of ['checking', 'starting', 'stopping'] as const) {
      expect(
        deriveUiStatus({
          backend: 'ready',
          view: { ...IDLE_VIEW, phase },
          hasTarget: true,
          controllerConnected: true,
        }),
      ).toBe('isolating')
    }
  })

  it('is active only when every requested feature is confirmed', () => {
    expect(
      deriveUiStatus({
        backend: 'ready',
        view: running(),
        hasTarget: true,
        controllerConnected: true,
      }),
    ).toBe('active')
  })

  it('is limited when a feature failed', () => {
    const features = evaluateSession(status({ failed: ['blockKeyboard'] }), 0, 10_000).features
    expect(
      deriveUiStatus({
        backend: 'ready',
        view: running({ features }),
        hasTarget: true,
        controllerConnected: true,
      }),
    ).toBe('limited')
  })

  it('is disconnected when the session controller is unplugged', () => {
    expect(
      deriveUiStatus({
        backend: 'ready',
        view: running(),
        hasTarget: true,
        controllerConnected: false,
      }),
    ).toBe('disconnected')
  })

  it('is error after a failed start', () => {
    expect(
      deriveUiStatus({
        backend: 'ready',
        view: { ...IDLE_VIEW, phase: 'failed', error: { code: 'antiCheat', message: '' } },
        hasTarget: true,
        controllerConnected: true,
      }),
    ).toBe('error')
  })
})
