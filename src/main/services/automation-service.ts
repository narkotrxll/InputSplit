/**
 * Profiles started by InputSplit itself instead of the dashboard's Start button:
 *
 *  - "Play" on a profile (or in the tray): start the game if needed, wait for its window,
 *    then isolate it;
 *  - profiles with `autoStart`: isolate the game as soon as its window appears;
 *  - the controller shortcut: stop the pressing player's isolation, or start the most recent
 *    profile whose game is open.
 *
 * With "Two players" on, each of these takes the first free seat. "Play" on a profile whose
 * game the other player already plays starts a second copy, with a free controller and screen.
 *
 * Each game process is started automatically at most once: after the user stops it, the
 * same process is left alone until it exits.
 */
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type {
  AutomationState,
  IsolationView,
  Profile,
  Seat,
  StartIsolationInput,
  WindowInfo,
} from '@shared/domain'
import { AppException, toAppError } from '@shared/errors'
import { isSeatTaken } from '@shared/seats'
import type { NativeBackend } from '../native/backend'
import { Emitter } from '../util/emitter'
import type { Logger } from './logger'
import type { ProfilesService } from './profiles-service'
import type { SeatsService } from './seats-service'

/** How often windows are listed while a profile has automatic start (cheap in the helper). */
const WATCH_INTERVAL_MS = 3000
/** A new window must exist this long first: games often show a splash or launcher window. */
const SETTLE_MS = 4000
/** Big games can take a while to show their first window after launch. */
const LAUNCH_TIMEOUT_MS = 180_000

export interface AutomationOptions {
  backend: NativeBackend
  seats: SeatsService
  profiles: ProfilesService
  logger: Logger
  /** InputSplit's own processes, never offered as targets. */
  ownPids: () => number[]
  /** Starts the game (replaceable in tests). */
  launch?: (exePath: string) => Promise<void>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** The game window to isolate among several windows of the same executable. */
export function bestWindow(windows: readonly WindowInfo[], exeName: string): WindowInfo | null {
  const exe = exeName.toLowerCase()
  const candidates = windows
    .filter((w) => w.exeName.toLowerCase() === exe)
    .sort(
      (a, b) =>
        Number(b.isLikelyGame) - Number(a.isLikelyGame) ||
        b.gameScore - a.gameScore ||
        b.rect.width * b.rect.height - a.rect.width * a.rect.height,
    )
  return candidates[0] ?? null
}

export function startInputFor(
  profile: Profile,
  window: WindowInfo,
  seat: Seat = 0,
  controllerSlot: number | null = profile.controllerSlot,
): StartIsolationInput {
  return {
    seat,
    target: {
      pid: window.pid,
      hwnd: window.hwnd,
      title: window.title,
      exeName: window.exeName,
      exePath: window.exePath,
    },
    controllerSlot,
    displayId: profile.displayId,
    moveWindow: profile.moveWindow && profile.displayId !== null,
    restoreOnExit: profile.restoreOnExit,
    // "Any controller" means there is no slot to lock to (same rule as the dashboard).
    features: {
      ...profile.features,
      xinputSlotLock: profile.features.xinputSlotLock && controllerSlot !== null,
    },
  }
}

/** Starts a game the way Explorer would, plus SDL's background-controller switch. */
async function launchExecutable(exePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exePath, [], {
      cwd: dirname(exePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      // SDL games (many indies and ports) then keep reading controllers in background.
      env: { ...process.env, SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS: '1' },
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export class AutomationService {
  private state: AutomationState = {
    phase: 'idle',
    profileId: null,
    profileName: null,
    error: null,
  }
  readonly changes = new Emitter<AutomationState>()
  /** Processes that were already isolated once (by anyone); not started automatically again. */
  private readonly handledPids = new Set<number>()
  private readonly firstSeen = new Map<number, number>()
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private run = 0
  private readonly launch: (exePath: string) => Promise<void>
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: AutomationOptions) {
    this.launch = options.launch ?? launchExecutable
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    options.seats.changes.on(({ view }) => {
      if (view.target !== null && view.phase !== 'idle') this.handledPids.add(view.target.pid)
    })
  }

  get(): AutomationState {
    return this.state
  }

  startWatching(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.checkAutomaticStart(), WATCH_INTERVAL_MS)
  }

  stopWatching(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Isolates the profile's game; with `launch`, starts the game first if it is not open.
   * A failure is also kept in the state, for callers that cannot show it (the tray).
   */
  async play(profileId: string, launch: boolean): Promise<void> {
    if (this.state.error !== null) this.setState({ ...this.state, error: null })
    try {
      await this.playProfile(profileId, launch)
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code !== 'alreadyRunning') {
        this.setState({
          phase: 'idle',
          profileId,
          profileName: this.options.profiles.get(profileId)?.name ?? null,
          error: appError,
        })
      }
      throw error
    }
  }

  private async playProfile(profileId: string, launch: boolean): Promise<void> {
    const { profiles, seats, backend } = this.options
    const profile = profiles.get(profileId)
    if (profile === null) throw new AppException('profileNotFound', 'The profile no longer exists.')
    if (seats.freeSeat() === null) {
      throw new AppException('alreadyRunning', 'Isolation is already running.')
    }
    if (this.state.phase !== 'idle') {
      throw new AppException('alreadyRunning', 'Another profile is being started.')
    }
    if (backend.getState().status !== 'ready') {
      throw new AppException('backendUnavailable', 'The native helper is not running.')
    }

    const run = ++this.run
    const others = seats.all().filter(isSeatTaken)
    const exe = profile.exeName.toLowerCase()
    const secondCopy = others.some((v) => v.target?.exeName.toLowerCase() === exe)
    const placed = secondCopy ? await this.placeSecondCopy(profile, others) : profile
    let window = await this.findWindow(profile.exeName)
    if (window === null) {
      if (!launch) {
        throw new AppException('gameNotRunning', `${profile.exeName} is not running.`)
      }
      if (profile.exePath === null) {
        throw new AppException('noExePath', 'The profile does not know where the game is.')
      }
      this.setState({
        phase: 'launching',
        profileId: profile.id,
        profileName: profile.name,
        error: null,
      })
      try {
        this.options.logger.info(`Launching ${profile.exeName} from a profile`)
        await this.launch(profile.exePath)
      } catch (error) {
        this.setIdle()
        throw new AppException('launchFailed', `Could not start the game: ${String(error)}`)
      }
      if (run !== this.run) return
      this.setState({ ...this.state, phase: 'waiting' })
      window = await this.waitForWindow(profile.exeName, run)
      if (run !== this.run) return // cancelled
      if (window === null) {
        this.setIdle()
        if (secondCopy) {
          throw new AppException('secondCopyTimeout', 'The game did not open a second copy.')
        }
        throw new AppException('launchTimeout', 'The game window did not appear in time.')
      }
    }
    await this.startFor(placed, window)
  }

  /**
   * The second copy of a game gets the profile's controller and screen unless the other
   * player already has them; then a free connected controller and a free secondary screen.
   */
  private async placeSecondCopy(profile: Profile, others: IsolationView[]): Promise<Profile> {
    const { backend } = this.options
    const usedSlots = new Set(others.map((v) => v.controllerSlot))
    const usedDisplays = new Set(others.map((v) => v.displayId))
    let controllerSlot = profile.controllerSlot
    if (controllerSlot === null || usedSlots.has(controllerSlot)) {
      const { controllers } = await backend.request('listControllers', {})
      controllerSlot = controllers.find((c) => c.connected && !usedSlots.has(c.slot))?.slot ?? null
      if (controllerSlot === null) {
        throw new AppException('noFreeController', 'Connect a controller for the second player.')
      }
    }
    let displayId = profile.displayId
    if (displayId !== null && usedDisplays.has(displayId)) {
      const { displays } = await backend.request('listDisplays', {})
      displayId = displays.find((d) => !d.isPrimary && !usedDisplays.has(d.id))?.id ?? null
    }
    return { ...profile, controllerSlot, displayId }
  }

  /** Stops waiting for a launched game (the game itself keeps running); clears an error. */
  cancel(): void {
    this.run++
    if (this.state.phase !== 'idle' || this.state.error !== null) {
      this.setState({ phase: 'idle', profileId: null, profileName: null, error: null })
    }
  }

  /**
   * The controller shortcut, pressed on `slot`. Returns what happened, so the caller can
   * give feedback (vibration, notification).
   */
  async toggle(slot: number | null = null): Promise<'started' | 'stopped' | 'failed' | 'nothing'> {
    const { seats, profiles, backend } = this.options
    const own = this.seatToStop(slot)
    if (own !== null) {
      await seats.stop(own)
      return 'stopped'
    }
    if (this.state.phase !== 'idle') {
      this.cancel()
      return 'stopped'
    }
    const busy = seats.all().some((v) => v.phase === 'checking' || v.phase === 'starting')
    if (backend.getState().status !== 'ready' || busy) return 'nothing'
    const seat = seats.freeSeat()
    if (seat === null) return 'nothing'
    // Next to another player, a profile for "any controller" takes the pressing controller.
    const otherTaken = seats.all().some(isSeatTaken)
    const slotFor = (profile: Profile) =>
      profile.controllerSlot === null && otherTaken ? slot : profile.controllerSlot
    const windows = await this.listWindows()
    const taken = new Set(
      seats
        .all()
        .filter(isSeatTaken)
        .map((v) => v.target?.pid),
    )
    const candidates = profiles
      .recent()
      // The pressing player's own profiles first.
      .sort((a, b) => Number(b.controllerSlot === slot) - Number(a.controllerSlot === slot))
    for (const profile of candidates) {
      const window = bestWindow(windows, profile.exeName)
      if (window === null || taken.has(window.pid)) continue
      await this.startFor(profile, window, slotFor(profile))
      return seats.get(seat).phase === 'failed' ? 'failed' : 'started'
    }
    // No profile matches: repeat the last manual setup if that game is still open.
    const last = seats.lastStart()
    if (last !== null && !taken.has(last.target.pid)) {
      if (windows.some((w) => w.pid === last.target.pid)) {
        await seats.start({ ...last, seat })
        return seats.get(seat).phase === 'failed' ? 'failed' : 'started'
      }
    }
    return 'nothing'
  }

  /** The seat the shortcut on `slot` stops: that player's game, or the only one running. */
  private seatToStop(slot: number | null): Seat | null {
    const { seats } = this.options
    const views = seats.all()
    if (slot !== null) {
      const own = seats.seatForSlot(slot)
      if (own !== null) return own
    }
    // A game reading every controller belongs to whoever presses.
    const shared = views.findIndex((v) => isSeatTaken(v) && v.controllerSlot === null)
    if (shared >= 0) return shared as Seat
    // A single player: the shortcut always stops the running game.
    const taken = views.flatMap((v, i) => (isSeatTaken(v) ? [i as Seat] : []))
    return seats.freeSeat() === null && taken.length === 1 ? taken[0]! : null
  }

  // -------------------------------------------------------------------------------------

  /** One pass of the automatic start (runs every few seconds while watching). */
  async checkAutomaticStart(): Promise<void> {
    const { seats, profiles, backend, logger } = this.options
    if (this.ticking) return
    const automatic = profiles.list().filter((p) => p.autoStart)
    if (automatic.length === 0) {
      this.firstSeen.clear()
      return
    }
    const starting = seats.all().some((v) => v.phase === 'checking' || v.phase === 'starting')
    if (
      backend.getState().status !== 'ready' ||
      this.state.phase !== 'idle' ||
      starting ||
      seats.freeSeat() === null
    ) {
      return
    }
    this.ticking = true
    try {
      const windows = await this.listWindows()
      const alive = new Set(windows.map((w) => w.pid))
      for (const pid of [...this.handledPids]) if (!alive.has(pid)) this.handledPids.delete(pid)
      for (const pid of [...this.firstSeen.keys()]) if (!alive.has(pid)) this.firstSeen.delete(pid)

      for (const profile of automatic) {
        const window = bestWindow(windows, profile.exeName)
        if (window === null || this.handledPids.has(window.pid)) continue
        const seen = this.firstSeen.get(window.pid) ?? this.now()
        this.firstSeen.set(window.pid, seen)
        if (this.now() - seen < SETTLE_MS) continue
        logger.info(`Automatic start for profile ${profile.exeName} (pid ${window.pid})`)
        await this.startFor(profile, window)
        return // one game at a time
      }
    } catch (error) {
      logger.warn(`Automatic start check failed: ${String(error)}`)
    } finally {
      this.ticking = false
    }
  }

  private async startFor(
    profile: Profile,
    window: WindowInfo,
    controllerSlot: number | null = profile.controllerSlot,
  ): Promise<void> {
    const seat = this.options.seats.freeSeat()
    this.setIdle()
    if (seat === null) throw new AppException('alreadyRunning', 'Every player is already playing.')
    this.handledPids.add(window.pid)
    await this.options.profiles.markUsed(profile.id).catch(() => {})
    await this.options.seats.start(startInputFor(profile, window, seat, controllerSlot))
  }

  private async waitForWindow(exeName: string, run: number): Promise<WindowInfo | null> {
    const deadline = this.now() + LAUNCH_TIMEOUT_MS
    let candidate: { pid: number; since: number } | null = null
    while (this.now() < deadline && run === this.run) {
      await this.sleep(1000)
      if (run !== this.run) return null
      const window = await this.findWindow(exeName).catch(() => null)
      if (window === null) {
        candidate = null
        continue
      }
      if (candidate === null || candidate.pid !== window.pid) {
        candidate = { pid: window.pid, since: this.now() }
      }
      // Pick the best window again once the game had time to replace its splash screen.
      if (this.now() - candidate.since >= SETTLE_MS) return window
    }
    return null
  }

  /** The game's window, skipping copies another player already plays. */
  private async findWindow(exeName: string): Promise<WindowInfo | null> {
    const taken = new Set(
      this.options.seats
        .all()
        .filter(isSeatTaken)
        .map((v) => v.target?.pid),
    )
    return bestWindow(
      (await this.listWindows()).filter((w) => !taken.has(w.pid)),
      exeName,
    )
  }

  private async listWindows(): Promise<WindowInfo[]> {
    const excludePids = this.options.ownPids()
    return (await this.options.backend.request('listWindows', { excludePids })).windows
  }

  private setIdle(): void {
    if (this.state.phase !== 'idle') {
      this.setState({ ...this.state, phase: 'idle', profileId: null, profileName: null })
    }
  }

  private setState(state: AutomationState): void {
    this.state = state
    this.changes.emit(state)
  }
}
