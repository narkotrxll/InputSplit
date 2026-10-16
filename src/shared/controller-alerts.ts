/**
 * What to tell the player on the TV about their controller: it went away, came back, or its
 * battery is running out. Computed from two consecutive controller lists.
 */
import type { Controller } from './domain'

export type ControllerAlertKind = 'disconnected' | 'reconnected' | 'lowBattery'

export interface ControllerAlert {
  slot: number
  kind: ControllerAlertKind
}

const isLow = (c: Controller | undefined): boolean =>
  c !== undefined &&
  c.connected &&
  c.wireless === true &&
  (c.battery?.level === 'low' || c.battery?.level === 'empty') &&
  c.battery.type !== 'wired' &&
  c.battery.type !== 'disconnected'

/** Alerts for the `watched` slots between two controller lists. */
export function controllerAlerts(
  previous: readonly Controller[],
  next: readonly Controller[],
  watched: ReadonlySet<number>,
): ControllerAlert[] {
  const alerts: ControllerAlert[] = []
  for (const slot of watched) {
    const before = previous.find((c) => c.slot === slot)
    const after = next.find((c) => c.slot === slot)
    const was = before?.connected === true
    const is = after?.connected === true
    if (was && !is) alerts.push({ slot, kind: 'disconnected' })
    else if (!was && is && before !== undefined) alerts.push({ slot, kind: 'reconnected' })
    if (is && isLow(after) && !(was && isLow(before))) alerts.push({ slot, kind: 'lowBattery' })
  }
  return alerts
}
