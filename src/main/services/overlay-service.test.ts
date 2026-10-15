import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURES, type FrameStats, type Rect, type Seat } from '@shared/domain'
import { FakeBackend, sessionStatus } from '../native/__fixtures__/fake-backend'
import { mainTexts } from '../i18n'
import { Logger } from './logger'
import {
  OverlayService,
  overlayContent,
  type OverlayContent,
  type OverlayScreen,
} from './overlay-service'
import { SeatsService } from './seats-service'

class FakeScreen implements OverlayScreen {
  shown = new Map<Seat, Rect | null>()
  contents = new Map<Seat, OverlayContent>()
  show(seat: Seat, monitor: Rect | null): number | null {
    this.shown.set(seat, monitor)
    return 60
  }
  update(seat: Seat, content: OverlayContent): void {
    this.contents.set(seat, content)
  }
  hide(seat: Seat): void {
    this.shown.delete(seat)
    this.contents.delete(seat)
  }
}

const frames = (patch: Partial<FrameStats>): FrameStats => ({
  enabled: true,
  timeUs: 0,
  frames: 0,
  inputLatencySumUs: 0,
  inputLatencySamples: 0,
  worstFrameUs: 0,
  worstInputLatencyUs: 0,
  apis: ['dxgi'],
  ...patch,
})

async function setup() {
  const backend = new FakeBackend()
  backend.handlers.checkTarget = (p) => ({
    pid: (p as { pid: number }).pid,
    exePath: null,
    architecture: 'x64',
    blockers: [],
    warnings: [],
    antiCheat: null,
  })
  backend.handlers.startIsolation = (p) =>
    sessionStatus({ pid: (p as { pid: number }).pid, gameWindow: 99 })
  backend.handlers.stopIsolation = () => ({})
  backend.handlers.setFrameStats = () => ({})
  backend.handlers.windowMonitor = () => ({ bounds: { x: 1920, y: 0, width: 3840, height: 2160 } })
  const logger = new Logger(null)
  const seats = new SeatsService(backend, logger, () => false)
  const screen = new FakeScreen()
  const overlay = new OverlayService({
    backend,
    seats,
    screen,
    texts: () => mainTexts('en'),
    logger,
  })
  const start = () =>
    seats.start({
      seat: 0,
      target: { pid: 42, hwnd: 99, exeName: 'game.exe', exePath: null, title: 'Game' },
      controllerSlot: 0,
      displayId: null,
      moveWindow: false,
      restoreOnExit: false,
      features: DEFAULT_FEATURES,
    })
  return { backend, seats, screen, overlay, start }
}

describe('OverlayService', () => {
  it('does nothing without a running game', async () => {
    const { overlay, backend } = await setup()
    expect(await overlay.toggle(0)).toBe('nothing')
    expect(backend.calls).toHaveLength(0)
  })

  it('turns the frame counter and the overlay on and off for the running game', async () => {
    const { overlay, backend, screen, start } = await setup()
    await start()
    // The helper reports the game window with each status.
    backend.events.emit({ name: 'sessionStatus', data: sessionStatus({ gameWindow: 99 }) })

    expect(await overlay.toggle(0)).toBe('on')
    expect(backend.calls.at(-2)).toEqual({
      method: 'setFrameStats',
      params: { sessionId: 7, enabled: true },
    })
    expect(backend.calls.at(-1)).toEqual({ method: 'windowMonitor', params: { hwnd: 99 } })
    expect(screen.shown.get(0)).toEqual({ x: 1920, y: 0, width: 3840, height: 2160 })
    expect(screen.contents.get(0)?.lines[0]?.value).toBe('Measuring…')

    backend.events.emit({
      name: 'sessionStatus',
      data: sessionStatus({ frameStats: frames({ timeUs: 1_000_000, frames: 100 }) }),
    })
    backend.events.emit({
      name: 'sessionStatus',
      data: sessionStatus({
        frameStats: frames({
          timeUs: 2_000_000,
          frames: 160,
          inputLatencySumUs: 24_000,
          inputLatencySamples: 1,
        }),
      }),
    })
    const lines = screen.contents.get(0)?.lines ?? []
    expect(lines.map((l) => [l.label, l.value])).toEqual([
      ['FPS', '60'],
      ['Frame', '16.7 ms'],
      ['Input → frame', '24 ms'],
      ['Screen', '60 Hz'],
    ])
    expect(lines[0]?.tone).toBe('good')

    expect(await overlay.toggle(0)).toBe('off')
    expect(backend.calls.at(-1)).toEqual({
      method: 'setFrameStats',
      params: { sessionId: 7, enabled: false },
    })
    expect(screen.shown.has(0)).toBe(false)
  })

  it('hides the overlay when the game stops', async () => {
    const { overlay, seats, screen, start } = await setup()
    await start()
    await overlay.toggle(null)
    expect(overlay.isOn(0)).toBe(true)
    await seats.stop(0)
    expect(overlay.isOn(0)).toBe(false)
    expect(screen.shown.has(0)).toBe(false)
  })
})

describe('overlayContent', () => {
  const t = mainTexts('en')
  const ok = {
    state: 'ok' as const,
    fps: 41.6,
    frameMs: 24,
    worstFrameMs: 48,
    latencyMs: null,
    worstLatencyMs: null,
  }

  it('keeps the last latency while nothing is pressed and marks a low frame rate', () => {
    const content = overlayContent(ok, 31.2, 40, 60, t)
    expect(content.lines.map((l) => l.value)).toEqual([
      '42',
      '24 ms · worst 48',
      '31 ms · worst 40',
      '60 Hz',
    ])
    expect(content.lines[0]?.tone).toBe('warn')
    expect(content.note).toContain('not included')
  })

  it('asks for a button press before the first latency', () => {
    expect(overlayContent(ok, null, null, null, t).lines.at(-1)?.value).toBe('Press a button')
  })

  it('says when a game cannot be measured', () => {
    const content = overlayContent(
      { ...ok, state: 'noRenderer', fps: null, frameMs: null, worstFrameMs: null },
      null,
      null,
      60,
      t,
    )
    expect(content.lines.map((l) => l.value)).toEqual(['Not available in this game', '60 Hz'])
  })
})
