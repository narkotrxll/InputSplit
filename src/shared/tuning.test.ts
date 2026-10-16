import { describe, expect, it } from 'vitest'
import { isDefaultTuning, stickPercent, toHelperTuning, withPlayerSlot } from './tuning'

describe('toHelperTuning', () => {
  it('turns percents into XInput units and buttons into bit indexes', () => {
    const tuning = toHelperTuning({
      leftDeadzone: 10,
      rightDeadzone: 0,
      triggerDeadzone: 20,
      remap: { a: 'b', b: 'a', back: 'off' },
      playerOrder: [1, 0, 2, 3],
    })
    expect(tuning.playerSlots).toEqual([1, 0, 2, 3])
    expect(tuning.leftDeadzone).toBe(3277)
    expect(tuning.triggerDeadzone).toBe(51)
    expect(tuning.buttonMap[12]).toBe(13) // A (0x1000) acts as B (0x2000)
    expect(tuning.buttonMap[13]).toBe(12)
    expect(tuning.buttonMap[5]).toBe(255) // Back hidden
    expect(tuning.buttonMap[0]).toBe(0)
    expect(tuning.buttonMap).toHaveLength(16)
  })
})

describe('isDefaultTuning', () => {
  it('ignores buttons mapped to themselves', () => {
    const base = {
      leftDeadzone: 0,
      rightDeadzone: 0,
      triggerDeadzone: 0,
      remap: {},
      playerOrder: [0, 1, 2, 3],
    }
    expect(isDefaultTuning(base)).toBe(true)
    expect(isDefaultTuning({ ...base, remap: { a: 'a' } })).toBe(true)
    expect(isDefaultTuning({ ...base, remap: { a: 'b' } })).toBe(false)
    expect(isDefaultTuning({ ...base, rightDeadzone: 5 })).toBe(false)
    expect(isDefaultTuning({ ...base, playerOrder: [1, 0, 2, 3] })).toBe(false)
  })
})

describe('stickPercent', () => {
  it('measures the deflection', () => {
    expect(stickPercent(0, 0)).toBe(0)
    expect(stickPercent(32767, 0)).toBe(100)
    expect(stickPercent(-32768, -32768)).toBe(100)
  })
})

describe('withPlayerSlot', () => {
  it('swaps slots between players', () => {
    expect(withPlayerSlot([0, 1, 2, 3], 0, 2)).toEqual([2, 1, 0, 3])
    expect(withPlayerSlot([2, 1, 0, 3], 0, 2)).toEqual([2, 1, 0, 3])
  })
})
