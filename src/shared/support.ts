/**
 * Turns raw facts from the hook DLL into what the user sees.
 *
 * Rules (see docs/ARCHITECTURE.md §6):
 *  - a feature is "active" only if the DLL lists it in `active`;
 *  - the controller feature additionally needs proof that the game reads its controller
 *    (XInput, DirectInput or Raw Input); until then
 *    it is "pending", and after a grace period without a single read it is "unsupported";
 *  - anything failed or unsupported makes the session "limited".
 */
import type {
  BackendStatus,
  SessionCounters,
  DetectedApi,
  FeatureFlags,
  FeatureName,
  FeatureReport,
  IsolationView,
  SessionStatus,
  UiStatus,
} from './domain'
import { FEATURE_NAMES } from './defaults'

/** Every controller read the hook DLL saw: XInput, DirectInput and Raw Input HID records. */
export function controllerReads(counters: SessionCounters | null | undefined): number {
  if (!counters) return 0
  return counters.xinputReads + counters.directInputReads + counters.rawGamepadReads
}

/** How long a game may take before its first controller read counts as "never". */
export const XINPUT_GRACE_MS = 6000

export function featureFlagsToList(flags: FeatureFlags): FeatureName[] {
  return FEATURE_NAMES.filter((name) => flags[name])
}

function controllerReason(apis: readonly DetectedApi[]): string {
  if (apis.includes('windowsGamingInput')) return 'usesWindowsGamingInput'
  if (apis.includes('gameInput')) return 'usesGameInput'
  if (apis.includes('directInput8')) return 'usesDirectInput'
  return 'noControllerReads'
}

export interface Evaluation {
  features: FeatureReport[]
  limitations: string[]
}

export function evaluateSession(status: SessionStatus, startedAt: number, now: number): Evaluation {
  const requested = new Set(status.requested)
  const active = new Set(status.active)
  const failed = new Set(status.failed)
  const reads = controllerReads(status.counters)
  const graceOver = now - startedAt >= XINPUT_GRACE_MS

  const features: FeatureReport[] = FEATURE_NAMES.map((name) => {
    if (!requested.has(name)) return { name, state: 'off', reason: null }
    if (failed.has(name)) return { name, state: 'failed', reason: 'hookFailed' }
    if (!active.has(name)) return { name, state: 'pending', reason: null }
    if (name === 'xinputBackground' && reads === 0) {
      return graceOver
        ? { name, state: 'unsupported', reason: controllerReason(status.detectedApis) }
        : { name, state: 'pending', reason: 'waitingForReads' }
    }
    return { name, state: 'active', reason: null }
  })

  const limitations: string[] = []
  const apis = status.detectedApis
  if (apis.includes('windowsGamingInput')) limitations.push('windowsGamingInput')
  if (apis.includes('gameInput')) limitations.push('gameInput')
  if (apis.includes('directInput8') && reads === 0 && graceOver) limitations.push('directInput')
  if (status.subclassedWindows === 0 && requested.has('activationShield')) {
    limitations.push('noWindowProtected')
  }
  return { features, limitations }
}

export interface UiStatusInput {
  backend: BackendStatus
  view: IsolationView
  hasTarget: boolean
  /** Is the controller slot used by the running session connected? */
  controllerConnected: boolean
}

export function deriveUiStatus({
  backend,
  view,
  hasTarget,
  controllerConnected,
}: UiStatusInput): UiStatus {
  switch (view.phase) {
    case 'checking':
    case 'starting':
    case 'stopping':
      return 'isolating'
    case 'failed':
      return 'error'
    case 'running': {
      if (view.controllerSlot !== null && !controllerConnected) return 'disconnected'
      const degraded = view.features.some((f) => f.state === 'failed' || f.state === 'unsupported')
      return degraded || view.limitations.length > 0 ? 'limited' : 'active'
    }
    case 'idle':
    case 'ended':
      if (backend !== 'ready') return backend === 'starting' ? 'isolating' : 'error'
      return hasTarget ? 'ready' : 'notConfigured'
  }
}

/** True while a session exists in the helper (used to enable "Stop"). */
export function isSessionLive(view: IsolationView): boolean {
  return view.phase === 'running' || view.phase === 'starting' || view.phase === 'stopping'
}
