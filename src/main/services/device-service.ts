/**
 * Controllers and displays: cached lists kept fresh by helper events (no polling here).
 */
import type { BridgedPad, Controller, ControllerState, Display, HidGamepad } from '@shared/domain'
import { resolveModels } from '@shared/gamepad-models'
import { INPUT_TOOL_EXES, toolsFromProcesses } from '@shared/input-tools'
import type { NativeBackend } from '../native/backend'
import { Emitter } from '../util/emitter'

function withModels(list: {
  controllers: Controller[]
  hidGamepads?: HidGamepad[]
  bridged?: BridgedPad[]
}): Controller[] {
  return resolveModels(list.controllers, list.hidGamepads ?? [], list.bridged ?? [])
}

export class DeviceService {
  private controllers: Controller[] = []
  private displays: Display[] = []
  readonly controllersChanged = new Emitter<Controller[]>()
  readonly displaysChanged = new Emitter<Display[]>()
  readonly controllerState = new Emitter<ControllerState>()

  constructor(private readonly backend: NativeBackend) {
    backend.onEvent((event) => {
      if (event.name === 'controllersChanged') {
        this.controllers = withModels(event.data)
        this.controllersChanged.emit(this.controllers)
      } else if (event.name === 'displaysChanged') {
        this.displays = event.data.displays
        this.displaysChanged.emit(this.displays)
      } else if (event.name === 'controllerState') {
        this.controllerState.emit(event.data)
      }
    })
    let previous = backend.getState().status
    backend.onState((state) => {
      if (state.status === 'ready' && previous !== 'ready') void this.refresh().catch(() => {})
      previous = state.status
    })
  }

  async refresh(): Promise<void> {
    if (this.backend.getState().status !== 'ready') return
    const [controllers, displays] = await Promise.all([
      this.backend.request('listControllers', {}),
      this.backend.request('listDisplays', {}),
    ])
    this.controllers = withModels(controllers)
    this.displays = displays.displays
    this.controllersChanged.emit(this.controllers)
    this.displaysChanged.emit(this.displays)
  }

  async listControllers(): Promise<Controller[]> {
    if (this.backend.getState().status !== 'ready') return []
    this.controllers = withModels(await this.backend.request('listControllers', {}))
    return this.controllers
  }

  /** Ids of the running programs from INPUT_TOOLS; empty with an older helper. */
  async listInputTools(): Promise<string[]> {
    if (this.backend.getState().status !== 'ready') return []
    try {
      const { running } = await this.backend.request('findProcesses', {
        names: [...INPUT_TOOL_EXES],
      })
      return toolsFromProcesses(running).map((tool) => tool.id)
    } catch {
      return []
    }
  }

  async listDisplays(): Promise<Display[]> {
    if (this.backend.getState().status !== 'ready') return []
    this.displays = (await this.backend.request('listDisplays', {})).displays
    return this.displays
  }

  connectedSlots(): number[] {
    return this.controllers.filter((c) => c.connected).map((c) => c.slot)
  }

  isSlotConnected(slot: number): boolean {
    return this.controllers.some((c) => c.slot === slot && c.connected)
  }
}
