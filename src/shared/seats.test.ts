import { describe, expect, it } from 'vitest'
import { IDLE_VIEW } from './defaults'
import type { IsolationView } from './domain'
import { seatConflict } from './seats'

function running(
  pid: number,
  controllerSlot: number | null,
  readsController = true,
): IsolationView {
  return {
    ...IDLE_VIEW,
    phase: 'running',
    target: { pid, hwnd: 1, title: 'Game', exeName: 'game.exe', exePath: null },
    controllerSlot,
    features: [
      { name: 'xinputBackground', state: readsController ? 'active' : 'off', reason: null },
    ],
  }
}

describe('seatConflict', () => {
  const candidate = { pid: 2, controllerSlot: 1, readsController: true }

  it('allows anything next to a free seat', () => {
    expect(seatConflict(candidate, IDLE_VIEW)).toBeNull()
    expect(seatConflict(candidate, { ...running(2, 1), phase: 'ended' })).toBeNull()
  })

  it('allows two games on two different controllers', () => {
    expect(seatConflict(candidate, running(1, 0))).toBeNull()
  })

  it('refuses the same game, a shared controller, or "any controller"', () => {
    expect(seatConflict(candidate, running(2, 0))).toBe('sameGame')
    expect(seatConflict(candidate, running(1, 1))).toBe('controllerInUse')
    expect(seatConflict(candidate, running(1, null))).toBe('controllerShared')
    expect(seatConflict({ ...candidate, controllerSlot: null }, running(1, 0))).toBe(
      'controllerShared',
    )
  })

  it('ignores controllers when one game does not read them in the background', () => {
    expect(seatConflict(candidate, running(1, 1, false))).toBeNull()
    expect(seatConflict({ ...candidate, readsController: false }, running(1, 1))).toBeNull()
  })
})
