/**
 * The isolation session state machine.
 *
 *   idle ─start─▶ checking ─ok─▶ starting ─confirmed─▶ running ─stop─▶ stopping ─▶ ended
 *                    │                │                    │
 *                    └──blocked──▶ failed ◀──error─────────┘ (game exit, helper crash,
 *                                                              emergency stop → ended)
 *
 * Everything shown as "active" comes from the hook DLL's own status messages
 * (evaluateSession). This service never assumes success.
 */
import {
  FEATURE_NAMES,
  IDLE_VIEW,
  type AppError,
  type BackendState,
  type IsolationView,
  type Rect,
  type SessionEndReason,
  type SessionStatus,
  type StartIsolationInput,
} from '@shared/domain'
import { lookupCompat, type CompatOutcome } from '@shared/compatibility'
import { AppException, toAppError } from '@shared/errors'
import { controllerReads, evaluateSession, isSessionLive } from '@shared/support'
import type { NativeBackend } from '../native/backend'
import type { HelperEvent } from '../native/protocol'
import { Emitter } from '../util/emitter'
import type { Logger } from './logger'

/** What the ban-risk warning names when anti-cheat protection is off. */
export interface RiskInfo {
  game: string
  /** The detected or known anti-cheat, if any. */
  antiCheat: string | null
}

export interface AntiCheatSafety {
  /** Settings → anti-cheat protection (on by default). */
  protection: () => boolean
  /** Shows the ban-risk warning; resolves true only when the user chooses to go ahead. */
  confirmRisk: (risk: RiskInfo) => Promise<boolean>
}

const PROTECTED: AntiCheatSafety = { protection: () => true, confirmRisk: async () => false }

interface MovedWindow {
  hwnd: number
  previous: Rect
}

export class IsolationService {
  private view: IsolationView = IDLE_VIEW
  private readonly changes = new Emitter<IsolationView>()
  /** How a session went, for the compatibility memory (one event per started session). */
  readonly outcomes = new Emitter<{ exeName: string; outcome: CompatOutcome }>()
  private lastInput: StartIsolationInput | null = null
  private lastStatus: SessionStatus | null = null
  private moved: MovedWindow | null = null
  private restoreOnExit = true
  private moveFailed = false

  constructor(
    private readonly backend: NativeBackend,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
    /** Refuses a start that clashes with another seat's session (two players). */
    private readonly conflict: (input: StartIsolationInput) => AppError | null = () => null,
    private readonly safety: AntiCheatSafety = PROTECTED,
  ) {
    backend.onEvent((event) => this.onHelperEvent(event))
    backend.onState((state) => this.onBackendState(state))
  }

  get(): IsolationView {
    return this.view
  }

  onChange(listener: (view: IsolationView) => void): () => void {
    return this.changes.on(listener)
  }

  /** The most recent start request (used to restart it from the controller shortcut). */
  lastStart(): StartIsolationInput | null {
    return this.lastInput
  }

  async start(input: StartIsolationInput): Promise<IsolationView> {
    if (isSessionLive(this.view) || this.view.phase === 'checking') {
      throw new AppException('alreadyRunning', 'Isolation is already running.')
    }
    if (this.backend.getState().status !== 'ready') {
      throw new AppException('backendUnavailable', 'The native helper is not running.')
    }
    const requested = FEATURE_NAMES.filter((name) => input.features[name])
    if (requested.length === 0)
      throw new AppException('noFeatures', 'Select at least one protection.')

    this.lastInput = input
    this.lastStatus = null
    this.moved = null
    this.moveFailed = false
    this.restoreOnExit = input.restoreOnExit
    this.set({
      ...IDLE_VIEW,
      phase: 'checking',
      target: input.target,
      controllerSlot: input.features.xinputSlotLock ? input.controllerSlot : null,
      displayId: input.displayId,
      features: FEATURE_NAMES.map((name) => ({
        name,
        state: input.features[name] ? 'pending' : 'off',
        reason: null,
      })),
    })
    this.logger.info(`Starting isolation for ${input.target.exeName} (pid ${input.target.pid})`)

    const compat = lookupCompat(input.target.exeName)
    const protection = this.safety.protection()
    if (compat?.kind === 'blocked' && protection) {
      return this.fail({
        code: 'antiCheat',
        message: `Protected by ${compat.antiCheat ?? 'an anti-cheat system'}.`,
      })
    }

    const clash = this.conflict(input)
    if (clash !== null) return this.fail(clash)

    try {
      const check = await this.backend.request('checkTarget', {
        pid: input.target.pid,
        allowAntiCheat: !protection,
      })
      const blocker = check.blockers[0]
      if (blocker) return this.fail({ code: blocker.code, message: blocker.message })
      if (
        check.exePath !== null &&
        input.target.exePath !== null &&
        check.exePath.toLowerCase() !== input.target.exePath.toLowerCase()
      ) {
        return this.fail({ code: 'targetChanged', message: 'The selected process was replaced.' })
      }
      // Protection off: online and anti-cheat games need the user's go-ahead on every start.
      const antiCheat = check.antiCheat ?? (compat?.kind === 'blocked' ? compat.antiCheat : null)
      if (
        !protection &&
        (antiCheat != null || compat?.kind === 'blocked' || compat?.kind === 'online')
      ) {
        const accepted = await this.safety.confirmRisk({
          game: input.target.title || input.target.exeName,
          antiCheat: antiCheat ?? null,
        })
        if (!accepted) {
          return this.fail({ code: 'riskDeclined', message: 'The ban risk was not accepted.' })
        }
        this.logger.warn(
          `Anti-cheat protection is off: the user accepted the ban risk for ${input.target.exeName}` +
            (antiCheat ? ` (${antiCheat})` : ''),
        )
      }
      this.set({ ...this.view, phase: 'starting', warnings: check.warnings })

      const status = await this.backend.request(
        'startIsolation',
        {
          pid: input.target.pid,
          hwnd: input.target.hwnd,
          features: { ...input.features },
          xinputSlot: input.features.xinputSlotLock ? input.controllerSlot : null,
          allowAntiCheat: !protection,
        },
        30_000,
      )
      this.lastStatus = status
      this.set({
        ...this.view,
        phase: 'running',
        sessionId: status.sessionId,
        startedAt: this.now(),
      })
      this.applyStatus(status)
      this.logger.info(`Isolation running: ${status.active.join(', ') || 'no features'}`)
      if (status.failed.length > 0) this.logger.warn(`Features failed: ${status.failed.join(', ')}`)
    } catch (error) {
      const appError = toAppError(error)
      if (this.view.phase === 'starting') {
        this.outcomes.emit({ exeName: input.target.exeName, outcome: 'failed' })
      }
      return this.fail(appError)
    }

    if (input.moveWindow && input.displayId !== null) await this.moveWindow(input)
    return this.view
  }

  async stop(): Promise<IsolationView> {
    const sessionId = this.view.sessionId
    if (!isSessionLive(this.view) || sessionId === null) return this.view
    this.set({ ...this.view, phase: 'stopping' })
    try {
      await this.backend.request('stopIsolation', { sessionId }, 10_000)
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code !== 'sessionNotFound') this.logger.warn(`Stop failed: ${appError.message}`)
    }
    // Usually `sessionEnded` already arrived; finish here otherwise.
    if (this.view.phase === 'stopping') await this.finish('stopped')
    return this.view
  }

  /** Clears an ended/failed session so the dashboard shows "Ready" again. */
  dismiss(): IsolationView {
    if (this.view.phase === 'ended' || this.view.phase === 'failed') this.set(IDLE_VIEW)
    return this.view
  }

  // -------------------------------------------------------------------------------------

  private async moveWindow(input: StartIsolationInput): Promise<void> {
    if (input.displayId === null) return
    try {
      const result = await this.backend.request('moveWindow', {
        hwnd: input.target.hwnd,
        displayId: input.displayId,
        mode: 'auto',
      })
      this.moved = { hwnd: input.target.hwnd, previous: result.previous }
      this.set({ ...this.view, windowMoved: true })
    } catch (error) {
      this.moveFailed = true
      this.logger.warn(`Could not move the game window: ${toAppError(error).message}`)
      if (this.lastStatus) this.applyStatus(this.lastStatus)
    }
  }

  private onHelperEvent(event: HelperEvent): void {
    if (event.name === 'sessionStatus') {
      if (event.data.sessionId !== this.view.sessionId || this.view.phase !== 'running') return
      this.lastStatus = event.data
      this.applyStatus(event.data)
    } else if (event.name === 'sessionEnded') {
      if (event.data.sessionId !== this.view.sessionId) return
      this.logger.info(`Session ended: ${event.data.reason}`)
      void this.finish(event.data.reason, event.data.message)
    } else if (event.name === 'emergencyStop') {
      this.logger.warn('Emergency stop hotkey pressed')
    }
  }

  private onBackendState(state: BackendState): void {
    if (state.status === 'ready' || !isSessionLive(this.view)) return
    // The helper died. Its pipe to the game is gone, so the hook DLL has already switched
    // itself off (fail-safe). Reflect that honestly.
    this.logger.error('Native helper stopped during isolation; the game is back to normal')
    void this.finish('helperCrashed')
  }

  private applyStatus(status: SessionStatus): void {
    const startedAt = this.view.startedAt ?? this.now()
    const evaluation = evaluateSession(status, startedAt, this.now())
    const limitations = this.moveFailed
      ? [...evaluation.limitations, 'windowMoveFailed']
      : evaluation.limitations
    this.set({
      ...this.view,
      features: evaluation.features,
      limitations,
      counters: status.counters,
      detectedApis: status.detectedApis,
    })
  }

  private async finish(reason: SessionEndReason, message?: string): Promise<void> {
    if (this.view.phase === 'ended' || this.view.phase === 'failed' || this.view.phase === 'idle') {
      return
    }
    const moved = this.moved
    this.moved = null
    if (
      moved !== null &&
      this.restoreOnExit &&
      reason !== 'processExited' &&
      this.backend.getState().status === 'ready'
    ) {
      await this.backend
        .request('restoreWindowRect', { hwnd: moved.hwnd, rect: moved.previous })
        .catch((error: unknown) =>
          this.logger.warn(`Window restore failed: ${toAppError(error).message}`),
        )
    }
    const unexpected =
      reason === 'hookDisconnected' || reason === 'error' || reason === 'helperCrashed'
    if (this.view.target !== null && this.view.startedAt !== null) {
      this.outcomes.emit({ exeName: this.view.target.exeName, outcome: this.outcome() })
    }
    this.set({
      ...this.view,
      phase: 'ended',
      sessionId: null,
      endedReason: reason,
      error: unexpected ? { code: reason, message: message ?? reason } : null,
      features: this.view.features.map((f) => ({ ...f, state: 'off', reason: null })),
    })
  }

  /** Judged from what the game did while it ran, not from how the session ended. */
  private outcome(): CompatOutcome {
    const controller = this.view.features.find((f) => f.name === 'xinputBackground')
    const readPad = controllerReads(this.view.counters) > 0
    if (controller && controller.state !== 'off' && !readPad) return 'limited'
    const degraded = this.view.features.some(
      (f) => f.state === 'failed' || f.state === 'unsupported',
    )
    // A window that could not be moved says nothing about the game itself.
    const limited = this.view.limitations.some((l) => l !== 'windowMoveFailed')
    return degraded || limited ? 'limited' : 'works'
  }

  private fail(error: AppError): IsolationView {
    this.logger.warn(`Isolation refused or failed: ${error.code} — ${error.message}`)
    this.set({ ...this.view, phase: 'failed', sessionId: null, error })
    return this.view
  }

  private set(view: IsolationView): void {
    this.view = view
    this.changes.emit(view)
  }
}
