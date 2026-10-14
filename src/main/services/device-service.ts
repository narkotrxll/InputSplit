/**
 * Controllers and displays: cached lists kept fresh by helper events (no polling here).
 */
import type { Controller, ControllerState, Display } from '@shared/domain'
import type { NativeBackend } from '../native/backend'
import { Emitter } from '../util/emitter'

export class DeviceService {
  private controllers: Controller[] = []
  private displays: Display[] = []
  readonly controllersChanged = new Emitter<Controller[]>()
  readonly displaysChanged = new Emitter<Display[]>()
  readonly controllerState = new Emitter<ControllerState>()

  constructor(private readonly backend: NativeBackend) {
    backend.onEvent((event) => {
      if (event.name === 'controllersChanged') {
        this.controllers = event.data.controllers
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
    this.controllers = controllers.controllers
    this.displays = displays.displays
    this.controllersChanged.emit(this.controllers)
    this.displaysChanged.emit(this.displays)
  }

  async listControllers(): Promise<Controller[]> {
    if (this.backend.getState().status !== 'ready') return []
    this.controllers = (await this.backend.request('listControllers', {})).controllers
    return this.controllers
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
