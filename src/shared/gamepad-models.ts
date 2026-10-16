/**
 * Which controller is behind an XInput slot, so the test view can draw the right one.
 *
 * XInput reports a vendor and product id per slot (XInputGetCapabilitiesEx). PlayStation
 * and Nintendo controllers only reach XInput through a translator (Steam Input, DS4Windows),
 * which shows up as a virtual Xbox controller; for those slots the helper also lists the
 * physical HID game controllers that are not XInput devices, and they are matched in order.
 */
import {
  GamepadModelSchema,
  type BridgedPad,
  type Controller,
  type GamepadModel,
  type HidGamepad,
} from './domain'

export const GAMEPAD_MODELS = GamepadModelSchema.options
export type { GamepadModel }

const MICROSOFT = 0x045e
const SONY = 0x054c
const NINTENDO = 0x057e
const VALVE = 0x28de

const DUALSENSE = new Set([0x0ce6, 0x0df2]) // DualSense, DualSense Edge
const XBOX_360 = 0x028e // also what ViGEm (DS4Windows) presents

/** The model a vendor and product id belong to, or null when the id says nothing. */
export function modelFromIds(vendorId: number, productId: number): GamepadModel | null {
  switch (vendorId) {
    case MICROSOFT:
      return 'xbox'
    case SONY:
      return DUALSENSE.has(productId) ? 'dualsense' : 'dualshock4'
    case NINTENDO:
      return 'switchPro'
    default:
      return null
  }
}

/** A slot that a translator may have created on behalf of another controller. */
function maybeVirtual(c: Controller): boolean {
  if (c.vendorId == null || c.productId == null) return true
  return c.vendorId === VALVE || (c.vendorId === MICROSOFT && c.productId === XBOX_360)
}

/** Adds `model` to every connected gamepad slot. */
export function resolveModels(
  controllers: Controller[],
  hidGamepads: HidGamepad[],
  bridged: BridgedPad[] = [],
): Controller[] {
  // Physical pads XInput cannot see directly: the ones a translator stands in for. Pads
  // InputSplit's own bridge holds are shown in their slot instead.
  const unbridged = [...hidGamepads]
  for (const pad of bridged) {
    const i = unbridged.findIndex(
      (h) => h.vendorId === pad.vendorId && h.productId === pad.productId,
    )
    if (i !== -1) unbridged.splice(i, 1)
  }
  const hidden = unbridged
    .map((pad) => modelFromIds(pad.vendorId, pad.productId))
    .filter((model): model is GamepadModel => model !== null && model !== 'xbox')
  return controllers.map((c) => {
    const bridge = bridged.find((pad) => pad.slot === c.slot)
    if (!c.connected && bridge !== undefined) {
      return {
        ...c,
        connected: true,
        kind: 'gamepad',
        wireless: null,
        battery: null,
        vendorId: bridge.vendorId,
        productId: bridge.productId,
        model: modelFromIds(bridge.vendorId, bridge.productId) ?? 'generic',
        bridged: true,
      }
    }
    if (!c.connected || c.kind !== 'gamepad') return { ...c, model: undefined }
    if (maybeVirtual(c) && hidden.length > 0) return { ...c, model: hidden.shift(), doubled: true }
    const fromIds =
      c.vendorId != null && c.productId != null && c.vendorId !== VALVE
        ? modelFromIds(c.vendorId, c.productId)
        : null
    return { ...c, model: fromIds ?? 'generic' }
  })
}
