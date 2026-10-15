/**
 * The FPS and input-latency overlay, shown on the screen of an isolated game.
 *
 * LB + RB + Menu on a controller turns it on or off for that player's game. While it is on,
 * the hook DLL counts the game's frames (it hooks the Present calls the first time) and
 * every status message turns into one refresh of the overlay. The overlay window itself
 * (OverlayScreen) is a click-through, never-focused window on the game's monitor.
 */
import type { FrameStats, IsolationView, Rect, Seat, SessionStatus } from '@shared/domain'
import { frameReadout, type FrameReadout } from '@shared/frame-stats'
import type { MainTexts } from '../i18n'
import type { NativeBackend } from '../native/backend'
import type { Logger } from './logger'
import type { SeatsService } from './seats-service'

export interface OverlayLine {
  label: string
  value: string
  /** `warn`: clearly below the screen's refresh rate; `bad`: below half of it. */
  tone: 'good' | 'warn' | 'bad' | null
}

export interface OverlayContent {
  lines: OverlayLine[]
  note: string
}

export interface OverlayScreen {
  /**
   * Shows (or moves) the overlay of `seat` on the monitor at `monitor` (physical pixels,
   * null: the primary monitor). Returns that monitor's refresh rate in Hz, if known.
   */
  show(seat: Seat, monitor: Rect | null): number | null
  update(seat: Seat, content: OverlayContent): void
  hide(seat: Seat): void
}

interface SeatOverlay {
  sessionId: number
  previous: FrameStats | null
  /** The last measured latency; kept while nothing is pressed. */
  latencyMs: number | null
  worstLatencyMs: number | null
  refreshHz: number | null
  /** Status messages since the overlay was last placed (it follows a moved game window). */
  sincePlaced: number
}

/** About every five seconds: the game window may have moved to another monitor. */
const REPLACE_EVERY = 5

export class OverlayService {
  private readonly active = new Map<Seat, SeatOverlay>()
  private readonly gameWindows = new Map<number, number>()
  private busy = false

  constructor(
    private readonly options: {
      backend: NativeBackend
      seats: SeatsService
      screen: OverlayScreen
      texts: () => MainTexts
      logger: Logger
    },
  ) {
    options.backend.onEvent((event) => {
      if (event.name === 'sessionStatus') this.onStatus(event.data)
      if (event.name === 'sessionEnded') this.gameWindows.delete(event.data.sessionId)
    })
    options.seats.changes.on(({ seat, view }) => {
      const overlay = this.active.get(seat)
      if (
        overlay !== undefined &&
        (view.phase !== 'running' || view.sessionId !== overlay.sessionId)
      ) {
        this.close(seat)
      }
    })
  }

  isOn(seat: Seat): boolean {
    return this.active.has(seat)
  }

  /** The overlay shortcut, pressed on `slot`: on or off for that player's running game. */
  async toggle(slot: number | null): Promise<'on' | 'off' | 'nothing'> {
    if (this.busy) return 'nothing'
    const seat = this.seatFor(slot)
    if (seat === null) return 'nothing'
    this.busy = true
    try {
      if (this.active.has(seat)) {
        await this.turnOff(seat)
        return 'off'
      }
      return (await this.turnOn(seat)) ? 'on' : 'nothing'
    } finally {
      this.busy = false
    }
  }

  /** Hides every overlay at once and stops the frame counters. */
  closeAll(): void {
    for (const seat of [...this.active.keys()]) void this.turnOff(seat)
  }

  private async turnOn(seat: Seat): Promise<boolean> {
    const { backend, logger, screen } = this.options
    const view = this.options.seats.get(seat)
    if (view.phase !== 'running' || view.sessionId === null) return false
    const sessionId = view.sessionId
    try {
      await backend.request('setFrameStats', { sessionId, enabled: true })
    } catch (error) {
      logger.warn(`FPS overlay: could not start the frame counter: ${String(error)}`)
      return false
    }
    // The session may have ended while the helper was answering.
    const now = this.options.seats.get(seat)
    if (now.phase !== 'running' || now.sessionId !== sessionId) return false
    const overlay: SeatOverlay = {
      sessionId,
      previous: null,
      latencyMs: null,
      worstLatencyMs: null,
      refreshHz: null,
      sincePlaced: 0,
    }
    this.active.set(seat, overlay)
    overlay.refreshHz = screen.show(seat, await this.monitorOf(sessionId))
    screen.update(seat, this.content(overlay, null))
    logger.info(`FPS overlay on for player ${seat + 1}`)
    return true
  }

  private async turnOff(seat: Seat): Promise<void> {
    const overlay = this.active.get(seat)
    if (overlay === undefined) return
    this.close(seat)
    try {
      await this.options.backend.request('setFrameStats', {
        sessionId: overlay.sessionId,
        enabled: false,
      })
    } catch {
      // The session ended: the hook is not counting any more anyway.
    }
    this.options.logger.info(`FPS overlay off for player ${seat + 1}`)
  }

  private close(seat: Seat): void {
    if (!this.active.delete(seat)) return
    this.options.screen.hide(seat)
  }

  private onStatus(status: SessionStatus): void {
    if (status.gameWindow > 0) this.gameWindows.set(status.sessionId, status.gameWindow)
    for (const [seat, overlay] of this.active) {
      if (overlay.sessionId !== status.sessionId || status.frameStats === undefined) continue
      const readout = frameReadout(overlay.previous, status.frameStats)
      overlay.previous = status.frameStats
      if (readout.latencyMs !== null) {
        overlay.latencyMs = readout.latencyMs
        overlay.worstLatencyMs = readout.worstLatencyMs
      }
      this.options.screen.update(seat, this.content(overlay, readout))
      if (++overlay.sincePlaced >= REPLACE_EVERY) {
        overlay.sincePlaced = 0
        void this.monitorOf(overlay.sessionId).then((monitor) => {
          if (this.active.get(seat) === overlay) {
            overlay.refreshHz = this.options.screen.show(seat, monitor)
          }
        })
      }
    }
  }

  private async monitorOf(sessionId: number): Promise<Rect | null> {
    const hwnd = this.gameWindows.get(sessionId)
    if (hwnd === undefined) return null
    try {
      return (await this.options.backend.request('windowMonitor', { hwnd })).bounds
    } catch {
      return null
    }
  }

  private content(overlay: SeatOverlay, readout: FrameReadout | null): OverlayContent {
    return overlayContent(
      readout ?? {
        state: 'measuring',
        fps: null,
        frameMs: null,
        worstFrameMs: null,
        latencyMs: null,
        worstLatencyMs: null,
      },
      overlay.latencyMs,
      overlay.worstLatencyMs,
      overlay.refreshHz,
      this.options.texts(),
    )
  }

  /** The player's running game: their own seat, a game reading every controller, or the only one. */
  private seatFor(slot: number | null): Seat | null {
    const { seats } = this.options
    const views = seats.all()
    const running = (view: IsolationView) => view.phase === 'running' && view.sessionId !== null
    if (slot !== null) {
      const own = views.findIndex((v) => running(v) && v.controllerSlot === slot)
      if (own >= 0) return own as Seat
    }
    const shared = views.findIndex((v) => running(v) && v.controllerSlot === null)
    if (shared >= 0) return shared as Seat
    const all = views.flatMap((v, i) => (running(v) ? [i as Seat] : []))
    return all.length === 1 ? all[0]! : null
  }
}

function formatMs(ms: number): string {
  return ms < 20 ? ms.toFixed(1) : Math.round(ms).toString()
}

function withWorst(t: MainTexts, value: number, worst: number | null): string {
  const main = t.overlayMs.replace('{value}', formatMs(value))
  return worst !== null && worst > value
    ? `${main} · ${t.overlayWorst.replace('{value}', formatMs(worst))}`
    : main
}

function fpsTone(fps: number, refreshHz: number | null): OverlayLine['tone'] {
  if (refreshHz === null || refreshHz <= 0) return null
  if (fps < refreshHz * 0.5) return 'bad'
  if (fps < refreshHz * 0.9) return 'warn'
  return 'good'
}

export function overlayContent(
  readout: FrameReadout,
  latencyMs: number | null,
  worstLatencyMs: number | null,
  refreshHz: number | null,
  t: MainTexts,
): OverlayContent {
  const lines: OverlayLine[] = []
  if (readout.state === 'noRenderer') {
    lines.push({ label: t.overlayFps, value: t.overlayNoRenderer, tone: null })
  } else if (readout.state === 'measuring' || readout.fps === null) {
    lines.push({ label: t.overlayFps, value: t.overlayMeasuring, tone: null })
  } else {
    const fps = readout.fps < 10 ? readout.fps.toFixed(1) : Math.round(readout.fps).toString()
    lines.push({ label: t.overlayFps, value: fps, tone: fpsTone(readout.fps, refreshHz) })
    lines.push({
      label: t.overlayFrame,
      value: readout.frameMs === null ? '—' : withWorst(t, readout.frameMs, readout.worstFrameMs),
      tone: null,
    })
  }
  if (readout.state !== 'noRenderer') {
    lines.push({
      label: t.overlayLatency,
      value: latencyMs === null ? t.overlayPressButton : withWorst(t, latencyMs, worstLatencyMs),
      tone: null,
    })
  }
  if (refreshHz !== null && refreshHz > 0) {
    lines.push({
      label: t.overlayScreen,
      value: t.overlayHz.replace('{value}', Math.round(refreshHz).toString()),
      tone: null,
    })
  }
  return { lines, note: t.overlayNote }
}
