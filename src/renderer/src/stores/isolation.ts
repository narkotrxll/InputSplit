/**
 * The user's current setup (game, controller, screen, protections) and the live session.
 * The session view itself is owned by the main process; this store only mirrors it.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_FEATURES, IDLE_VIEW } from '@shared/defaults'
import type {
  FeatureFlags,
  FeatureName,
  IsolationView,
  Profile,
  Settings,
  TargetCheck,
  TargetRef,
  WindowInfo,
} from '@shared/domain'
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

export type CannotStartReason = 'backend' | 'noTarget' | 'checking' | 'blocked' | 'noFeatures'

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

  const view = ref<IsolationView>(IDLE_VIEW)
  const selection = ref<Selection>({
    target: null,
    controllerSlot: null,
    displayId: null,
    moveWindow: true,
    restoreOnExit: true,
    features: { ...DEFAULT_FEATURES },
  })
  const check = ref<TargetCheck | null>(null)
  const checking = ref(false)
  const busy = ref(false)
  const actionError = ref<string | null>(null)

  async function init(): Promise<void> {
    subscribe('isolation:changed', (next) => {
      view.value = next
    })
    view.value = await call('isolation:get')
  }

  function applyDefaults(settings: Settings): void {
    selection.value = {
      ...selection.value,
      controllerSlot: settings.lastControllerSlot,
      displayId: settings.lastDisplayId,
      moveWindow: settings.moveWindowByDefault,
      restoreOnExit: settings.restoreOnExit,
      features: { ...settings.defaultFeatures },
    }
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

  const cannotStartReason = computed<CannotStartReason | null>(() => {
    if (backend.state?.status !== 'ready') return 'backend'
    if (selection.value.target === null) return 'noTarget'
    if (checking.value) return 'checking'
    if (check.value !== null && check.value.blockers.length > 0) return 'blocked'
    if (!Object.values(effectiveFeatures.value).some(Boolean)) return 'noFeatures'
    return null
  })

  async function runCheck(): Promise<void> {
    const target = selection.value.target
    if (target === null) return
    checking.value = true
    check.value = null
    try {
      check.value = await call('windows:checkTarget', target.pid)
    } catch (error) {
      check.value = {
        pid: target.pid,
        exePath: target.exePath,
        architecture: 'unknown',
        blockers: [{ code: errorCode(error), message: String(error) }],
        warnings: [],
        antiCheat: null,
      }
    } finally {
      checking.value = false
    }
  }

  async function selectTarget(window: WindowInfo): Promise<void> {
    selection.value = { ...selection.value, target: targetFromWindow(window) }
    if (view.value.phase === 'ended' || view.value.phase === 'failed') await dismiss()
    await runCheck()
  }

  function clearTarget(): void {
    selection.value = { ...selection.value, target: null }
    check.value = null
  }

  async function selectController(slot: number | null): Promise<void> {
    selection.value = { ...selection.value, controllerSlot: slot }
    await settingsStore.update({ lastControllerSlot: slot }).catch(() => {})
  }

  async function selectDisplay(displayId: string | null): Promise<void> {
    selection.value = { ...selection.value, displayId }
    await settingsStore.update({ lastDisplayId: displayId }).catch(() => {})
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
    const target = selection.value.target
    if (target === null || cannotStartReason.value !== null) return
    busy.value = true
    actionError.value = null
    try {
      view.value = await call('isolation:start', {
        target,
        controllerSlot: selection.value.controllerSlot,
        displayId: selection.value.displayId,
        moveWindow: selection.value.moveWindow && selection.value.displayId !== null,
        restoreOnExit: selection.value.restoreOnExit,
        features: effectiveFeatures.value,
      })
    } catch (error) {
      actionError.value = errorCode(error)
    } finally {
      busy.value = false
    }
  }

  async function stop(): Promise<void> {
    busy.value = true
    try {
      view.value = await call('isolation:stop')
    } finally {
      busy.value = false
    }
  }

  async function dismiss(): Promise<void> {
    actionError.value = null
    view.value = await call('isolation:dismiss')
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
