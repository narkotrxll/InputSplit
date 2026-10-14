/**
 * Two players, two games: one IsolationService per seat. The helper already keys
 * everything by session id, so each seat simply ignores the other seat's events.
 *
 * Seat 0 is always available; seat 1 only while "Two players" is on.
 */
import type { IsolationView, Seat, StartIsolationInput } from '@shared/domain'
import type { CompatOutcome } from '@shared/compatibility'
import { SEAT_COUNT, isSeatTaken, seatConflict } from '@shared/seats'
import type { NativeBackend } from '../native/backend'
import { Emitter } from '../util/emitter'
import { IsolationService } from './isolation-service'
import type { Logger } from './logger'

export interface SeatChange {
  seat: Seat
  view: IsolationView
}

const CONFLICT_MESSAGES = {
  sameGame: 'This game is already isolated for the other player.',
  controllerShared: 'Both games would read every controller: choose a controller for each.',
  controllerInUse: 'The other player already uses this controller.',
} as const

export class SeatsService {
  readonly seats: IsolationService[]
  readonly changes = new Emitter<SeatChange>()
  readonly outcomes = new Emitter<{ exeName: string; outcome: CompatOutcome }>()
  private lastSeat: Seat = 0

  constructor(
    backend: NativeBackend,
    logger: Logger,
    private readonly twoPlayers: () => boolean,
    now: () => number = Date.now,
  ) {
    this.seats = Array.from({ length: SEAT_COUNT }, (_, index) => {
      const seat = index as Seat
      const service = new IsolationService(backend, logger, now, (input) =>
        this.conflictFor(seat, input),
      )
      service.onChange((view) => this.changes.emit({ seat, view }))
      service.outcomes.on((outcome) => this.outcomes.emit(outcome))
      return service
    })
  }

  seat(seat: Seat): IsolationService {
    return this.seats[seat]!
  }

  get(seat: Seat): IsolationView {
    return this.seat(seat).get()
  }

  all(): IsolationView[] {
    return this.seats.map((s) => s.get())
  }

  /** True while any seat holds a game. */
  anyTaken(): boolean {
    return this.all().some(isSeatTaken)
  }

  /** The first seat that can take a new game, or null when every usable seat is busy. */
  freeSeat(): Seat | null {
    const usable = this.twoPlayers() ? SEAT_COUNT : 1
    for (let seat = 0; seat < usable; seat++) {
      if (!isSeatTaken(this.get(seat as Seat))) return seat as Seat
    }
    return null
  }

  /** The seat whose game is (or would be) locked to `slot`. */
  seatForSlot(slot: number): Seat | null {
    const index = this.seats.findIndex((s) => {
      const view = s.get()
      return isSeatTaken(view) && view.controllerSlot === slot
    })
    return index < 0 ? null : (index as Seat)
  }

  async start(input: StartIsolationInput): Promise<IsolationView> {
    this.lastSeat = input.seat
    return this.seat(input.seat).start(input)
  }

  async stop(seat: Seat): Promise<IsolationView> {
    return this.seat(seat).stop()
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.seats.map((s) => s.stop()))
  }

  dismiss(seat: Seat): IsolationView {
    return this.seat(seat).dismiss()
  }

  /** The most recent start request on any seat (the controller shortcut repeats it). */
  lastStart(): StartIsolationInput | null {
    return this.seat(this.lastSeat).lastStart()
  }

  private conflictFor(seat: Seat, input: StartIsolationInput) {
    for (let other = 0; other < SEAT_COUNT; other++) {
      if (other === seat) continue
      const code = seatConflict(
        {
          pid: input.target.pid,
          controllerSlot: input.features.xinputSlotLock ? input.controllerSlot : null,
          readsController: input.features.xinputBackground,
        },
        this.get(other as Seat),
      )
      if (code !== null) return { code, message: CONFLICT_MESSAGES[code] }
    }
    return null
  }
}
