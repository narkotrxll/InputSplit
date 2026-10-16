import { describe, expect, it } from 'vitest'
import type { Controller } from './domain'
import { modelFromIds, resolveModels } from './gamepad-models'

const pad = (slot: number, vendorId: number | null, productId: number | null): Controller => ({
  slot,
  connected: true,
  kind: 'gamepad',
  wireless: false,
  battery: null,
  vendorId,
  productId,
})

describe('modelFromIds', () => {
  it('knows the common controllers', () => {
    expect(modelFromIds(0x045e, 0x0b12)).toBe('xbox')
    expect(modelFromIds(0x054c, 0x09cc)).toBe('dualshock4')
    expect(modelFromIds(0x054c, 0x0ce6)).toBe('dualsense')
    expect(modelFromIds(0x054c, 0x0df2)).toBe('dualsense')
    expect(modelFromIds(0x057e, 0x2009)).toBe('switchPro')
    expect(modelFromIds(0x046d, 0xc21d)).toBeNull()
  })
})

describe('resolveModels', () => {
  it('uses the ids XInput reports', () => {
    const [xbox, logitech] = resolveModels([pad(0, 0x045e, 0x0b12), pad(1, 0x046d, 0xc21d)], [])
    expect(xbox!.model).toBe('xbox')
    expect(logitech!.model).toBe('generic')
  })

  it('matches virtual pads to the PlayStation and Nintendo pads behind them, in order', () => {
    const result = resolveModels(
      [pad(0, 0x28de, 0x11ff), pad(1, 0x045e, 0x0b12), pad(2, 0x045e, 0x028e)],
      [
        { vendorId: 0x054c, productId: 0x0ce6 },
        { vendorId: 0x057e, productId: 0x2009 },
      ],
    )
    expect(result.map((c) => c.model)).toEqual(['dualsense', 'xbox', 'switchPro'])
    expect(result.map((c) => c.doubled ?? false)).toEqual([true, false, true])
  })

  it('treats a lone Xbox 360 id as an Xbox controller and a lone Steam pad as generic', () => {
    const result = resolveModels(
      [pad(0, 0x045e, 0x028e), pad(1, 0x28de, 0x11ff), pad(2, null, null)],
      [],
    )
    expect(result.map((c) => c.model)).toEqual(['xbox', 'generic', 'generic'])
  })

  it('leaves empty slots and non-gamepads alone', () => {
    const wheel = { ...pad(0, 0x046d, 0xc24f), kind: 'wheel' }
    const empty = { ...pad(1, null, null), connected: false }
    const result = resolveModels([wheel, empty], [{ vendorId: 0x054c, productId: 0x09cc }])
    expect(result.map((c) => c.model)).toEqual([undefined, undefined])
  })
})

describe('resolveModels with the pad bridge', () => {
  it('shows a bridged pad in its slot and keeps it out of translator matching', () => {
    const empty = { ...pad(1, null, null), connected: false }
    const result = resolveModels(
      [pad(0, 0x28de, 0x11ff), empty],
      [{ vendorId: 0x054c, productId: 0x0ce6 }],
      [{ slot: 1, vendorId: 0x054c, productId: 0x0ce6 }],
    )
    expect(result[1]).toMatchObject({ connected: true, model: 'dualsense', bridged: true })
    expect(result[0]!.model).toBe('generic')
    expect(result[0]!.doubled).toBeUndefined()
  })
})
