import { describe, expect, it } from 'vitest'
import { controllerAlerts } from './controller-alerts'
import type { Controller } from './domain'

const pad = (slot: number, patch: Partial<Controller> = {}): Controller => ({
  slot,
  connected: true,
  kind: 'gamepad',
  wireless: true,
  battery: { type: 'nimh', level: 'full' },
  ...patch,
})
const off = (slot: number) => pad(slot, { connected: false, wireless: null, battery: null })

describe('controllerAlerts', () => {
  const watched = new Set([0])

  it('reports a watched controller going away and coming back', () => {
    expect(controllerAlerts([pad(0)], [off(0)], watched)).toEqual([
      { slot: 0, kind: 'disconnected' },
    ])
    expect(controllerAlerts([off(0)], [pad(0)], watched)).toEqual([
      { slot: 0, kind: 'reconnected' },
    ])
    expect(controllerAlerts([pad(1)], [off(1)], watched)).toEqual([])
  })

  it('reports a low battery once', () => {
    const low = pad(0, { battery: { type: 'nimh', level: 'low' } })
    const empty = pad(0, { battery: { type: 'nimh', level: 'empty' } })
    expect(controllerAlerts([pad(0)], [low], watched)).toEqual([{ slot: 0, kind: 'lowBattery' }])
    expect(controllerAlerts([low], [empty], watched)).toEqual([])
    const wired = pad(0, { wireless: false, battery: { type: 'wired', level: 'low' } })
    expect(controllerAlerts([pad(0)], [wired], watched)).toEqual([])
  })
})
