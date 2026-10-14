import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURES, type ProfileInput, type WindowInfo } from '@shared/domain'
import { FakeBackend, sessionStatus } from '../native/__fixtures__/fake-backend'
import { AutomationService, bestWindow, startInputFor } from './automation-service'
import { IsolationService } from './isolation-service'
import { Logger } from './logger'
import { ProfilesService } from './profiles-service'

function win(pid: number, exeName: string, overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    hwnd: pid * 16,
    title: exeName,
    className: 'Window',
    pid,
    exePath: `C:\\Games\\${exeName}`,
    exeName,
    architecture: 'x64',
    accessible: true,
    elevated: false,
    isMinimized: false,
    isForeground: false,
    rect: { x: 0, y: 0, width: 1920, height: 1080 },
    monitor: '\\\\.\\DISPLAY1',
    gameScore: 5,
    isLikelyGame: true,
    hints: [],
    ...overrides,
  }
}

const profileInput: ProfileInput = {
  id: null,
  name: 'Hollow Knight',
  exeName: 'hollow_knight.exe',
  exePath: 'C:\\Games\\hollow_knight.exe',
  controllerSlot: 1,
  displayId: '\\\\.\\DISPLAY3',
  displayName: 'TV',
  moveWindow: true,
  restoreOnExit: true,
  autoStart: false,
  features: DEFAULT_FEATURES,
}

async function setup(windows: WindowInfo[] = []) {
  const backend = new FakeBackend()
  const state = { windows }
  backend.handlers.listWindows = () => ({ windows: state.windows })
  backend.handlers.checkTarget = (p) => ({
    pid: (p as { pid: number }).pid,
    exePath: null,
    architecture: 'x64',
    blockers: [],
    warnings: [],
    antiCheat: null,
  })
  backend.handlers.startIsolation = (p) => sessionStatus({ pid: (p as { pid: number }).pid })
  backend.handlers.moveWindow = () => ({
    previous: { x: 0, y: 0, width: 800, height: 600 },
    current: { x: 0, y: 0, width: 800, height: 600 },
  })
  backend.handlers.stopIsolation = () => ({})
  backend.handlers.restoreWindowRect = () => ({ restored: true })

  const logger = new Logger(null)
  const dir = await mkdtemp(join(tmpdir(), 'inputsplit-test-'))
  const profiles = new ProfilesService(join(dir, 'profiles.json'), () => {})
  await profiles.load()
  const isolation = new IsolationService(backend, logger)
  let now = 1_000_000
  const launch = vi.fn(async () => {})
  const automation = new AutomationService({
    backend,
    isolation,
    profiles,
    logger,
    ownPids: () => [],
    launch,
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
  })
  return {
    backend,
    state,
    profiles,
    isolation,
    automation,
    launch,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('bestWindow', () => {
  it('prefers likely games, then the higher score, then the bigger window', () => {
    const splash = win(1, 'game.exe', { isLikelyGame: false, gameScore: 1 })
    const small = win(2, 'game.exe', { rect: { x: 0, y: 0, width: 640, height: 480 } })
    const main = win(3, 'Game.EXE')
    expect(bestWindow([splash, small, main, win(4, 'other.exe')], 'GAME.exe')?.pid).toBe(3)
    expect(bestWindow([win(4, 'other.exe')], 'game.exe')).toBeNull()
  })

  it('never locks to a slot for "any controller"', () => {
    const profile = { ...profileInput, id: 'p', controllerSlot: null } as never
    const input = startInputFor(profile, win(5, 'hollow_knight.exe'))
    expect(input.features.xinputSlotLock).toBe(false)
    expect(input.target.pid).toBe(5)
  })
})

describe('AutomationService', () => {
  it('isolates a running game with the profile settings', async () => {
    const t = await setup([win(10, 'hollow_knight.exe')])
    const profile = await t.profiles.save(profileInput)
    await t.automation.play(profile.id, true)
    expect(t.launch).not.toHaveBeenCalled()
    expect(t.isolation.get().phase).toBe('running')
    const start = t.backend.calls.find((c) => c.method === 'startIsolation')
    expect(start?.params).toMatchObject({ pid: 10, xinputSlot: 1 })
    expect(t.profiles.get(profile.id)?.lastUsedAt).not.toBeNull()
  })

  it('launches the game and waits for its window to settle', async () => {
    const t = await setup([])
    const profile = await t.profiles.save(profileInput)
    t.launch.mockImplementation(async () => {
      t.state.windows = [win(20, 'hollow_knight.exe')]
    })
    const phases: string[] = []
    t.automation.changes.on((s) => phases.push(s.phase))
    await t.automation.play(profile.id, true)
    expect(t.launch).toHaveBeenCalledWith('C:\\Games\\hollow_knight.exe')
    expect(phases).toEqual(['launching', 'waiting', 'idle'])
    expect(t.isolation.get().target?.pid).toBe(20)
  })

  it('keeps the reason when a profile cannot be played', async () => {
    const t = await setup([])
    const profile = await t.profiles.save({ ...profileInput, exePath: null })
    await expect(t.automation.play(profile.id, true)).rejects.toMatchObject({ code: 'noExePath' })
    expect(t.automation.get()).toMatchObject({
      phase: 'idle',
      profileName: 'Hollow Knight',
      error: { code: 'noExePath' },
    })
    t.automation.cancel()
    expect(t.automation.get().error).toBeNull()
  })

  it('starts automatic profiles once per game process', async () => {
    const t = await setup([win(30, 'hollow_knight.exe')])
    await t.profiles.save({ ...profileInput, autoStart: true })

    await t.automation.checkAutomaticStart()
    expect(t.isolation.get().phase).toBe('idle') // window too new: may be a splash screen
    t.advance(5000)
    await t.automation.checkAutomaticStart()
    expect(t.isolation.get().phase).toBe('running')

    await t.isolation.stop()
    t.isolation.dismiss()
    t.advance(5000)
    await t.automation.checkAutomaticStart()
    expect(t.isolation.get().phase).toBe('idle') // stopped by the user: leave it alone

    // The game restarts as a new process: automatic start applies again.
    t.state.windows = [win(31, 'hollow_knight.exe')]
    await t.automation.checkAutomaticStart()
    t.advance(5000)
    await t.automation.checkAutomaticStart()
    expect(t.isolation.get().target?.pid).toBe(31)
  })

  it('toggles from the controller shortcut', async () => {
    const t = await setup([win(40, 'hollow_knight.exe')])
    expect(await t.automation.toggle()).toBe('nothing')
    await t.profiles.save(profileInput)
    expect(await t.automation.toggle()).toBe('started')
    expect(t.isolation.get().phase).toBe('running')
    expect(await t.automation.toggle()).toBe('stopped')
    expect(t.isolation.get().phase).toBe('ended')
  })
})
