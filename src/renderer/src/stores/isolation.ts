/**
 * The user's current setup (game, controller, screen, protections) and the live session.
 * The session view itself is owned by the main process; this store only mirrors it.
 *
 * Two players: each seat has its own setup and session. Everything below acts on the seat
 * shown on the dashboard (`activeSeat`); with "Two players" off that is always player 1.
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { lookupCompat } from '@shared/compatibility'
import { DEFAULT_FEATURES, IDLE_VIEW } from '@shared/defaults'
import type {
  FeatureFlags,
  FeatureName,
  IsolationView,
  Profile,
  Seat,
  Settings,
  TargetCheck,
  TargetRef,
  WindowInfo,
} from '@shared/domain'
import { SEAT_COUNT, isSeatTaken, seatConflict, type SeatConflict } from '@shared/seats'
import { deriveUiStatus, isSessionLive } from '@shared/support'
import { call, errorCode, subscribe } from '../api'
import { useBackendStore } from './backend'
import { useDevicesStore } from './devices'
import { useSettingsStore } from './settings'

export interface Selection {
  target: TargetRef | null
  controllerSlot: number | null
  displayId: string | null
  moveWindow: boolean
  restoreOnExit: boolean
  features: FeatureFlags
}

export type CannotStartReason =
  'backend' | 'noTarget' | 'checking' | 'blocked' | 'noFeatures' | SeatConflict

interface SeatState {
  view: IsolationView
  selection: Selection
  check: TargetCheck | null
  checking: boolean
  busy: boolean
  actionError: string | null
}

export function targetFromWindow(window: WindowInfo): TargetRef {
  return {
    pid: window.pid,
    hwnd: window.hwnd,
    title: window.title,
    exeName: window.exeName,
    exePath: window.exePath,
  }
}

export const useIsolationStore = defineStore('isolation', () => {
  const backend = useBackendStore()
  const devices = useDevicesStore()
  const settingsStore = useSettingsStore()

  const seats = ref<SeatState[]>(
    Array.from({ length: SEAT_COUNT }, () => ({
      view: IDLE_VIEW,
      selection: {
        target: null,
        controllerSlot: null,
        displayId: null,
        moveWindow: true,
        restoreOnExit: true,
        features: { ...DEFAULT_FEATURES },
      },
      check: null,
      checking: false,
      busy: false,
      actionError: null,
    })),
  )
  const activeSeat = ref<Seat>(0)
  const current = computed(() => seats.value[activeSeat.value]!)

  /** Read and write the shown seat as if there were only one. */
  function field<K extends keyof SeatState>(key: K) {
    return computed<SeatState[K]>({
      get: () => current.value[key],
      set: (value) => {
        current.value[key] = value
      },
    })
  }
  const view = field('view')
  const selection = field('selection')
  const check = field('check')
  const checking = field('checking')
  const busy = field('busy')
  const actionError = field('actionError')

  const views = computed(() => seats.value.map((s) => s.view))
  /** The second seat is shown while "Two players" is on, or while it still holds a game. */
  const twoPlayers = computed(
    () => settingsStore.settings.twoPlayers || seats.value[1]!.view.phase !== 'idle',
  )
  watch(twoPlayers, (on) => {
    if (!on) activeSeat.value = 0
  })
  /** The seat "Play" uses next, or null when every player is busy. */
  const freeSeat = computed<Seat | null>(() => {
    const usable = settingsStore.settings.twoPlayers ? SEAT_COUNT : 1
    for (let seat = 0; seat < usable; seat++) {
      if (!isSeatTaken(seats.value[seat]!.view)) return seat as Seat
    }
    return null
  })

  async function init(): Promise<void> {
    subscribe('isolation:changed', ({ seat, view: next }) => {
      const state = seats.value[seat]!
      // Started outside the dashboard (profile, tray, controller shortcut): show that setup.
      if (
        next.phase === 'checking' &&
        next.target &&
        next.target.pid !== state.selection.target?.pid
      ) {
        adoptSession(state, next)
        activeSeat.value = seat
      }
      state.view = next
    })
    const all = await call('isolation:get')
    all.forEach((v, seat) => {
      if (seats.value[seat]) seats.value[seat].view = v
    })
  }

  function adoptSession(state: SeatState, next: IsolationView): void {
    const requested = Object.fromEntries(
      next.features.map((f) => [f.name, f.state !== 'off']),
    ) as FeatureFlags
    state.selection = {
      ...state.selection,
      target: next.target,
      controllerSlot: next.controllerSlot ?? state.selection.controllerSlot,
      displayId: next.displayId,
      moveWindow: next.displayId !== null,
      features: next.features.length > 0 ? requested : state.selection.features,
    }
    state.check = null
  }

  function applyDefaults(settings: Settings): void {
    seats.value.forEach((state, seat) => {
      // Player 2 starts on another controller than player 1.
      const slot =
        seat === 0 ? settings.lastControllerSlot : settings.lastControllerSlot === 1 ? 0 : 1
      state.selection = {
        ...state.selection,
        controllerSlot: slot,
        displayId: seat === 0 ? settings.lastDisplayId : null,
        moveWindow: settings.moveWindowByDefault,
        restoreOnExit: settings.restoreOnExit,
        features: { ...settings.defaultFeatures },
      }
    })
  }

  function setActiveSeat(seat: Seat): void {
    activeSeat.value = seat
  }

  const live = computed(() => isSessionLive(view.value))
  const busyPhase = computed(() => ['checking', 'starting', 'stopping'].includes(view.value.phase))

  const uiStatus = computed(() =>
    deriveUiStatus({
      backend: backend.state?.status ?? 'starting',
      view: view.value,
      hasTarget: selection.value.target !== null,
      controllerConnected: devices.isConnected(view.value.controllerSlot),
    }),
  )

  const effectiveFeatures = computed<FeatureFlags>(() => ({
    ...selection.value.features,
    // "Any controller" means there is no slot to lock to.
    xinputSlotLock:
      selection.value.features.xinputSlotLock && selection.value.controllerSlot !== null,
  }))

  /** Why the shown seat's game cannot run next to the other player's game. */
  const seatClash = computed<SeatConflict | null>(() => {
    const target = selection.value.target
    if (target === null) return null
    const candidate = {
      pid: target.pid,
      controllerSlot: effectiveFeatures.value.xinputSlotLock
        ? selection.value.controllerSlot
        : null,
      readsController: effectiveFeatures.value.xinputBackground,
    }
    for (let seat = 0; seat < SEAT_COUNT; seat++) {
      if (seat === activeSeat.value) continue
      const clash = seatConflict(candidate, seats.value[seat]!.view)
      if (clash) return clash
    }
    return null
  })

  const cannotStartReason = computed<CannotStartReason | null>(() => {
    if (backend.state?.status !== 'ready') return 'backend'
    if (selection.value.target === null) return 'noTarget'
    if (checking.value) return 'checking'
    if (check.value !== null && check.value.blockers.length > 0) return 'blocked'
    if (lookupCompat(selection.value.target.exeName)?.kind === 'blocked') return 'blocked'
    if (!Object.values(effectiveFeatures.value).some(Boolean)) return 'noFeatures'
    return seatClash.value
  })

  async function runCheck(state: SeatState = current.value): Promise<void> {
    const target = state.selection.target
    if (target === null) return
    state.checking = true
    state.check = null
    try {
      state.check = await call('windows:checkTarget', target.pid)
    } catch (error) {
      state.check = {
        pid: target.pid,
        exePath: target.exePath,
        architecture: 'unknown',
        blockers: [{ code: errorCode(error), message: String(error) }],
        warnings: [],
        antiCheat: null,
      }
    } finally {
      state.checking = false
    }
  }

  async function selectTarget(window: WindowInfo): Promise<void> {
    const state = current.value
    const seat = activeSeat.value
    state.selection = { ...state.selection, target: targetFromWindow(window) }
    if (state.view.phase === 'ended' || state.view.phase === 'failed') await dismissSeat(seat)
    await runCheck(state)
  }

  function clearTarget(): void {
    selection.value = { ...selection.value, target: null }
    check.value = null
  }

  async function selectController(slot: number | null): Promise<void> {
    selection.value = { ...selection.value, controllerSlot: slot }
    if (activeSeat.value === 0) {
      await settingsStore.update({ lastControllerSlot: slot }).catch(() => {})
    }
  }

  async function selectDisplay(displayId: string | null): Promise<void> {
    selection.value = { ...selection.value, displayId }
    if (activeSeat.value === 0) {
      await settingsStore.update({ lastDisplayId: displayId }).catch(() => {})
    }
  }

  function setFeature(name: FeatureName, value: boolean): void {
    selection.value = {
      ...selection.value,
      features: { ...selection.value.features, [name]: value },
    }
  }

  function setMoveWindow(value: boolean): void {
    selection.value = { ...selection.value, moveWindow: value }
  }

  async function start(): Promise<void> {
    const state = current.value
    const seat = activeSeat.value
    const target = state.selection.target
    if (target === null || cannotStartReason.value !== null) return
    state.busy = true
    state.actionError = null
    try {
      state.view = await call('isolation:start', {
        seat,
        target,
        controllerSlot: state.selection.controllerSlot,
        displayId: state.selection.displayId,
        moveWindow: state.selection.moveWindow && state.selection.displayId !== null,
        restoreOnExit: state.selection.restoreOnExit,
        features: effectiveFeatures.value,
      })
    } catch (error) {
      state.actionError = errorCode(error)
    } finally {
      state.busy = false
    }
  }

  async function stop(): Promise<void> {
    const state = current.value
    state.busy = true
    try {
      state.view = await call('isolation:stop', activeSeat.value)
    } finally {
      state.busy = false
    }
  }

  async function dismissSeat(seat: Seat): Promise<void> {
    const state = seats.value[seat]!
    state.actionError = null
    state.view = await call('isolation:dismiss', seat)
  }

  async function dismiss(): Promise<void> {
    await dismissSeat(activeSeat.value)
  }

  /** Applies a profile. Returns false if its game is not running. */
  async function applyProfile(profile: Profile, windows: WindowInfo[]): Promise<boolean> {
    selection.value = {
      ...selection.value,
      controllerSlot: profile.controllerSlot,
      displayId: profile.displayId,
      moveWindow: profile.moveWindow,
      restoreOnExit: profile.restoreOnExit,
      features: { ...profile.features },
    }
    const exe = profile.exeName.toLowerCase()
    const candidates = windows
      .filter((w) => w.exeName.toLowerCase() === exe)
      .sort((a, b) => Number(b.isLikelyGame) - Number(a.isLikelyGame) || b.gameScore - a.gameScore)
    void call('profiles:markUsed', profile.id).catch(() => {})
    const match = candidates[0]
    if (match === undefined) {
      clearTarget()
      return false
    }
    await selectTarget(match)
    return true
  }

  return {
    seats,
    activeSeat,
    views,
    twoPlayers,
    freeSeat,
    view,
    selection,
    check,
    checking,
    busy,
    actionError,
    live,
    busyPhase,
    uiStatus,
    effectiveFeatures,
    cannotStartReason,
    init,
    applyDefaults,
    setActiveSeat,
    runCheck,
    selectTarget,
    clearTarget,
    selectController,
    selectDisplay,
    setFeature,
    setMoveWindow,
    start,
    stop,
    dismiss,
    applyProfile,
  }
})
