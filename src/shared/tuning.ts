/**
 * Dead zones and button remapping (Controllers page) in the form the hook DLL takes.
 */
import { XInputButton, type GamepadButton, type KeyBinding } from './defaults'
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
  /** Virtual-key code per input (see KeyBinding in hook_protocol.h), 0 = none. */
  keyMap: number[]
}

/** Index of each non-button input in keyMap; buttons use their XInput bit. */
const KEY_SLOTS: Record<Exclude<KeyBinding, GamepadButton>, number> = {
  leftTrigger: 16,
  rightTrigger: 17,
  stickUp: 18,
  stickDown: 19,
  stickLeft: 20,
  stickRight: 21,
}

function keySlot(binding: KeyBinding): number {
  return binding in KEY_SLOTS
    ? KEY_SLOTS[binding as keyof typeof KEY_SLOTS]
    : bitOf(binding as GamepadButton)
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
    keyMap: toKeyMap(tuning.keys),
  }
}

export function toKeyMap(keys: GamepadTuning['keys']): number[] {
  const keyMap = Array.from({ length: 22 }, () => 0)
  for (const [binding, vk] of Object.entries(keys) as [KeyBinding, number][]) {
    keyMap[keySlot(binding)] = vk
  }
  return keyMap
}

export function isDefaultTuning(tuning: GamepadTuning): boolean {
  return (
    tuning.leftDeadzone === 0 &&
    tuning.rightDeadzone === 0 &&
    tuning.triggerDeadzone === 0 &&
    Object.entries(tuning.remap).every(([from, to]) => from === to) &&
    tuning.playerOrder.every((slot, player) => slot === player) &&
    Object.keys(tuning.keys).length === 0
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
