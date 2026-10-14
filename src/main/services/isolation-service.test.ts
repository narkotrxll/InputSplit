import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURES, type StartIsolationInput } from '@shared/domain'
import { AppException } from '@shared/errors'
import { FakeBackend, sessionStatus } from '../native/__fixtures__/fake-backend'
import { IsolationService } from './isolation-service'
import { Logger } from './logger'

const input: StartIsolationInput = {
  target: { pid: 42, hwnd: 1, title: 'Game', exeName: 'game.exe', exePath: 'C:\\Games\\game.exe' },
  controllerSlot: 0,
  displayId: '\\\\.\\DISPLAY3',
  moveWindow: true,
  restoreOnExit: true,
  features: DEFAULT_FEATURES,
}

function setup() {
  const backend = new FakeBackend()
  backend.handlers.checkTarget = () => ({
    pid: 42,
    exePath: 'C:\\Games\\game.exe',
    architecture: 'x64',
    blockers: [],
    warnings: [],
    antiCheat: null,
  })
  backend.handlers.startIsolation = () => sessionStatus()
  backend.handlers.moveWindow = () => ({
    previous: { x: 0, y: 0, width: 800, height: 600 },
    current: { x: 3840, y: 0, width: 3840, height: 2160 },
  })
  backend.handlers.stopIsolation = () => ({})
  backend.handlers.restoreWindowRect = () => ({ restored: true })
  const service = new IsolationService(backend, new Logger(null), () => 100_000)
  return { backend, service }
}

describe('IsolationService', () => {
  it('runs the happy path and only reports confirmed features', async () => {
    const { backend, service } = setup()
    const view = await service.start(input)
    expect(view.phase).toBe('running')
    expect(view.sessionId).toBe(7)
    expect(view.windowMoved).toBe(true)
    expect(view.features.every((f) => f.state === 'active')).toBe(true)
    expect(backend.calls.map((c) => c.method)).toEqual([
      'checkTarget',
      'startIsolation',
      'moveWindow',
    ])
  })

  it('refuses a blocked target without injecting', async () => {
    const { backend, service } = setup()
    backend.handlers.checkTarget = () => ({
      pid: 42,
      exePath: null,
      architecture: 'x64',
      blockers: [{ code: 'antiCheat', message: 'Protected by BattlEye.' }],
      warnings: [],
      antiCheat: 'BattlEye',
    })
    const view = await service.start(input)
    expect(view.phase).toBe('failed')
    expect(view.error?.code).toBe('antiCheat')
    expect(backend.calls.map((c) => c.method)).toEqual(['checkTarget'])
  })

  it('detects a replaced process (PID reuse)', async () => {
    const { backend, service } = setup()
    backend.handlers.checkTarget = () => ({
      pid: 42,
      exePath: 'C:\\Other\\other.exe',
      architecture: 'x64',
      blockers: [],
      warnings: [],
      antiCheat: null,
    })
    expect((await service.start(input)).error?.code).toBe('targetChanged')
  })

  it('surfaces helper errors with their code', async () => {
    const { backend, service } = setup()
    backend.handlers.startIsolation = () => {
      throw new AppException('elevated', 'The game runs as administrator')
    }
    const view = await service.start(input)
    expect(view.phase).toBe('failed')
    expect(view.error).toEqual({ code: 'elevated', message: 'The game runs as administrator' })
  })

  it('marks failed features from the DLL as failed', async () => {
    const { backend, service } = setup()
    backend.handlers.startIsolation = () =>
      sessionStatus({ active: ['activationShield'], failed: ['focusSpoof'] })
    const view = await service.start({ ...input, moveWindow: false })
    expect(view.features.find((f) => f.name === 'focusSpoof')?.state).toBe('failed')
  })

  it('updates counters from status events and ends when the game exits', async () => {
    const { backend, service } = setup()
    await service.start(input)
    backend.events.emit({
      name: 'sessionStatus',
      data: sessionStatus({ counters: { ...sessionStatus().counters, blockedKeyboard: 5 } }),
    })
    expect(service.get().counters?.blockedKeyboard).toBe(5)

    backend.events.emit({
      name: 'sessionEnded',
      data: { sessionId: 7, pid: 42, reason: 'processExited' },
    })
    await vi.waitFor(() => expect(service.get().phase).toBe('ended'))
    expect(service.get().endedReason).toBe('processExited')
    // The game is gone, so its window position is not restored.
    expect(backend.calls.some((c) => c.method === 'restoreWindowRect')).toBe(false)
  })

  it('restores the window position on a normal stop', async () => {
    const { backend, service } = setup()
    await service.start(input)
    const view = await service.stop()
    expect(view.phase).toBe('ended')
    expect(view.endedReason).toBe('stopped')
    expect(backend.calls.find((c) => c.method === 'restoreWindowRect')?.params).toEqual({
      hwnd: 1,
      rect: { x: 0, y: 0, width: 800, height: 600 },
    })
    expect(service.dismiss().phase).toBe('idle')
  })

  it('reports a helper crash as an ended session (fail-safe engaged)', async () => {
    const { backend, service } = setup()
    await service.start(input)
    backend.state = { ...backend.state, status: 'restarting' }
    backend.states.emit(backend.state)
    await vi.waitFor(() => expect(service.get().phase).toBe('ended'))
    expect(service.get().error?.code).toBe('helperCrashed')
  })

  it('does not start twice', async () => {
    const { service } = setup()
    await service.start(input)
    await expect(service.start(input)).rejects.toMatchObject({ code: 'alreadyRunning' })
  })

  it('refuses games on the built-in blocked list without asking the helper', async () => {
    const { backend, service } = setup()
    const view = await service.start({
      ...input,
      target: { ...input.target, exeName: 'cs2.exe', exePath: 'C:\\Games\\cs2.exe' },
    })
    expect(view.phase).toBe('failed')
    expect(view.error?.code).toBe('antiCheat')
    expect(backend.calls).toEqual([])
  })

  it('remembers how a session went', async () => {
    const { backend, service } = setup()
    const outcomes: unknown[] = []
    service.outcomes.on((o) => outcomes.push(o))
    await service.start(input)
    await service.stop()
    expect(outcomes).toEqual([{ exeName: 'game.exe', outcome: 'works' }])

    backend.handlers.startIsolation = () =>
      sessionStatus({ counters: { ...sessionStatus().counters, xinputReads: 0 } })
    service.dismiss()
    await service.start(input)
    await service.stop()
    expect(outcomes[1]).toEqual({ exeName: 'game.exe', outcome: 'limited' })
  })

  it('remembers a game that could not be injected, but not a refusal', async () => {
    const { backend, service } = setup()
    const outcomes: unknown[] = []
    service.outcomes.on((o) => outcomes.push(o))
    backend.handlers.startIsolation = () => {
      throw new AppException('injectionFailed', 'blocked')
    }
    await service.start(input)
    expect(outcomes).toEqual([{ exeName: 'game.exe', outcome: 'failed' }])
    expect(service.lastStart()).toEqual(input)
  })
})
