/**
 * Dead zones and button remapping (Controllers page) in the form the hook DLL takes.
 */
import { XInputButton, type GamepadButton } from './defaults'
import type { GamepadTuning } from './domain'

/** What the helper's setTuning request carries (see TuningMessage in hook_protocol.h). */
export interface HelperTuning {
  leftDeadzone: number
  rightDeadzone: number
  triggerDeadzone: number
  /** For each XInput button bit: the bit the game sees instead, 255 = hidden. */
  buttonMap: number[]
  /** Physical slot behind the game's player 1..4 (games that read every controller). */
  playerSlots: number[]
}

const BUTTON_OFF = 255

const bitOf = (button: GamepadButton): number => Math.log2(XInputButton[button])

export function toHelperTuning(tuning: GamepadTuning): HelperTuning {
  const buttonMap = Array.from({ length: 16 }, (_, bit) => bit)
  for (const [from, to] of Object.entries(tuning.remap) as [
    GamepadButton,
    GamepadButton | 'off',
  ][]) {
    buttonMap[bitOf(from)] = to === 'off' ? BUTTON_OFF : bitOf(to)
  }
  return {
    leftDeadzone: Math.round((tuning.leftDeadzone / 100) * 32767),
    rightDeadzone: Math.round((tuning.rightDeadzone / 100) * 32767),
    triggerDeadzone: Math.round((tuning.triggerDeadzone / 100) * 255),
    buttonMap,
    playerSlots: [...tuning.playerOrder],
  }
}

export function isDefaultTuning(tuning: GamepadTuning): boolean {
  return (
    tuning.leftDeadzone === 0 &&
    tuning.rightDeadzone === 0 &&
    tuning.triggerDeadzone === 0 &&
    Object.entries(tuning.remap).every(([from, to]) => from === to) &&
    tuning.playerOrder.every((slot, player) => slot === player)
  )
}

/** Puts `slot` behind `player`; the player who had that slot gets the old one (a swap). */
export function withPlayerSlot(order: readonly number[], player: number, slot: number): number[] {
  const next = [...order]
  const other = next.indexOf(slot)
  if (other !== -1) next[other] = next[player]!
  next[player] = slot
  return next
}

/** How far a stick is pushed, in percent of the full range (for the drift readout). */
export function stickPercent(x: number, y: number): number {
  return Math.min(100, Math.round((Math.hypot(x, y) / 32767) * 100))
}
