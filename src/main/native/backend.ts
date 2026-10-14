/**
 * The native backend as seen by the rest of the main process.
 *
 * Two implementations:
 *  - HelperClient      — the real one: talks to inputsplit-helper.exe.
 *  - SimulatedBackend  — development only (non-Windows UI work), never in packaged builds.
 *
 * Services depend on this interface only, so the native layer can be replaced or improved
 * without touching the UI or the session logic.
 */
import type { BackendState } from '@shared/domain'
import type { HelperEvent, HelperMethod, HelperParams, HelperResult } from './protocol'

export interface NativeBackend {
  readonly simulated: boolean
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  getState(): BackendState
  request<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    timeoutMs?: number,
  ): Promise<HelperResult<M>>
  /** Registers or releases the emergency hotkey and records the result in the state. */
  setEmergencyHotkey(enabled: boolean): Promise<void>
  onEvent(listener: (event: HelperEvent) => void): () => void
  onState(listener: (state: BackendState) => void): () => void
}

export function initialBackendState(simulated: boolean): BackendState {
  return {
    status: 'starting',
    reason: null,
    simulated,
    helperVersion: null,
    windowsBuild: null,
    isElevated: false,
    hookDllFound: false,
    emergencyHotkey: null,
    emergencyHotkeyRegistered: false,
  }
}
