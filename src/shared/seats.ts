/**
 * Two players, two games. Each seat isolates its own game; the hook DLL in each game only
 * sees the controller slot it is locked to, so two seats must never share a controller.
 */
import type { IsolationView } from './domain'

/** Player 1 and player 2. */
export const SEAT_COUNT = 2

export type SeatConflict = 'sameGame' | 'controllerShared' | 'controllerInUse'

export interface SeatCandidate {
  pid: number
  /** The slot the game will be locked to; null when it reads every controller. */
  controllerSlot: number | null
  /** The game keeps reading controllers in the background (xinputBackground). */
  readsController: boolean
}

/** A seat that holds (or is about to hold) a game. */
export function isSeatTaken(view: IsolationView): boolean {
  return ['checking', 'starting', 'running', 'stopping'].includes(view.phase)
}

/** Why `candidate` cannot run next to the session in `other`, or null if it can. */
export function seatConflict(candidate: SeatCandidate, other: IsolationView): SeatConflict | null {
  if (!isSeatTaken(other)) return null
  if (other.target?.pid === candidate.pid) return 'sameGame'
  const otherReads = other.features.some((f) => f.name === 'xinputBackground' && f.state !== 'off')
  if (!candidate.readsController || !otherReads) return null
  // Without a slot lock a game reads every controller, including the other player's.
  if (candidate.controllerSlot === null || other.controllerSlot === null) return 'controllerShared'
  if (candidate.controllerSlot === other.controllerSlot) return 'controllerInUse'
  return null
}
