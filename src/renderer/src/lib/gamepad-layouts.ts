/**
 * Vector drawings of the controllers the test view knows, in one 480 × 300 coordinate space.
 * Original artwork (no vendor assets): outlines are symmetric Bézier paths built from their
 * left half, and the controls are placed where they sit on the real controller.
 */
import type { GamepadModel } from '@shared/domain'

export const VIEW_W = 480
export const VIEW_H = 300

type Point = [number, number]
/** One cubic segment: control 1, control 2, end point. */
type Segment = [number, number, number, number, number, number]

const mx = (x: number) => VIEW_W - x
const f = (n: number) => +n.toFixed(1)

/**
 * A closed outline from its left half: starts on the centre line at the top, runs down the
 * left side and ends on the centre line at the bottom; the right half is mirrored.
 */
function symmetric(start: Point, left: Segment[]): string {
  const parts = [`M${f(start[0])} ${f(start[1])}`]
  for (const s of left) parts.push(`C${s.map(f).join(' ')}`)
  const ends: Point[] = [start, ...left.map((s): Point => [s[4], s[5]])]
  for (let i = left.length - 1; i >= 0; i--) {
    const [c1x, c1y, c2x, c2y] = left[i]!
    const [px, py] = ends[i]!
    parts.push(`C${[mx(c2x), c2y, mx(c1x), c1y, mx(px), py].map(f).join(' ')}`)
  }
  return parts.join(' ') + 'Z'
}

/** A left-side shape and its mirror image on the right. */
function pair(start: Point, segments: Segment[]): [string, string] {
  const path = (flip: boolean) => {
    const x = (v: number) => f(flip ? mx(v) : v)
    const head = `M${x(start[0])} ${f(start[1])}`
    const body = segments.map(
      (s) => `C${x(s[0])} ${f(s[1])} ${x(s[2])} ${f(s[3])} ${x(s[4])} ${f(s[5])}`,
    )
    return [head, ...body].join(' ') + 'Z'
  }
  return [path(false), path(true)]
}

/** Rounded rectangle path whose top and bottom edges may differ in width (a trapezoid). */
function roundedTrapezoid(
  cx: number,
  top: number,
  bottom: number,
  wTop: number,
  wBottom: number,
  r: number,
): string {
  const tl: Point = [cx - wTop / 2, top]
  const tr: Point = [cx + wTop / 2, top]
  const br: Point = [cx + wBottom / 2, bottom]
  const bl: Point = [cx - wBottom / 2, bottom]
  const toward = (a: Point, b: Point, d: number): Point => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return [a[0] + ((b[0] - a[0]) / len) * d, a[1] + ((b[1] - a[1]) / len) * d]
  }
  const corners = [tl, tr, br, bl]
  const out: string[] = []
  corners.forEach((corner, i) => {
    const prev = corners[(i + 3) % 4]!
    const next = corners[(i + 1) % 4]!
    const a = toward(corner, prev, r)
    const b = toward(corner, next, r)
    out.push(`${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}`)
    out.push(`Q${f(corner[0])} ${f(corner[1])} ${f(b[0])} ${f(b[1])}`)
  })
  return out.join(' ') + 'Z'
}

export type FaceStyle = 'xbox' | 'playstation' | 'nintendo' | 'plain'
export type CenterIcon =
  | 'view'
  | 'menu'
  | 'share'
  | 'create'
  | 'options'
  | 'minus'
  | 'plus'
  | 'home'
  | 'capture'
  | 'guide'
  | 'mute'
  | 'none'

export interface CenterButton {
  /** XInput input it lights up for; decorative buttons have none. */
  input: 'back' | 'start' | 'guide' | null
  x: number
  y: number
  w: number
  h: number
  icon: CenterIcon
}

export interface GamepadLayout {
  body: string
  /** Optional inset panel drawn over the body (a different material on the real pad). */
  panel?: string
  triggers: [string, string]
  bumpers: [string, string]
  touchpad?: string
  /** Light strips beside the touchpad (DualSense), open paths drawn as strokes. */
  lightStrips?: [string, string]
  /** Small speaker holes centred here. */
  grille?: Point
  sticks: { left: Point; right: Point; r: number }
  dpad: { at: Point; size: number; style: 'cross' | 'split' }
  face: { at: Point; gap: number; r: number; style: FaceStyle }
  center: CenterButton[]
}

const xbox: GamepadLayout = {
  body: symmetric(
    [240, 64],
    [
      [198, 62, 154, 52, 124, 56],
      [94, 60, 70, 72, 58, 98],
      [44, 130, 32, 184, 36, 224],
      [40, 258, 60, 276, 86, 274],
      [108, 272, 122, 256, 136, 238],
      [152, 216, 172, 208, 240, 208],
    ],
  ),
  bumpers: pair(
    [62, 84],
    [
      [72, 59, 96, 45, 128, 42],
      [148, 40, 166, 41, 178, 45],
      [186, 53, 184, 61, 176, 61],
      [156, 58, 132, 58, 114, 62],
      [92, 67, 78, 76, 70, 92],
    ],
  ),
  triggers: pair(
    [92, 52],
    [
      [98, 39, 116, 27, 138, 27],
      [154, 27, 164, 33, 166, 45],
      [167, 44, 166, 48, 164, 50],
      [140, 46, 114, 47, 92, 52],
    ],
  ),
  sticks: { left: [128, 116], right: [294, 168], r: 25 },
  dpad: { at: [186, 168], size: 42, style: 'cross' },
  face: { at: [352, 116], gap: 23, r: 12.5, style: 'xbox' },
  center: [
    { input: 'back', x: 204, y: 116, w: 15, h: 15, icon: 'view' },
    { input: 'start', x: 276, y: 116, w: 15, h: 15, icon: 'menu' },
    { input: 'guide', x: 240, y: 86, w: 26, h: 26, icon: 'guide' },
    { input: null, x: 240, y: 132, w: 15, h: 9, icon: 'share' },
  ],
}

const dualsense: GamepadLayout = {
  body: symmetric(
    [240, 60],
    [
      [208, 60, 166, 54, 136, 56],
      [102, 58, 76, 68, 64, 92],
      [50, 120, 34, 172, 30, 224],
      [26, 264, 46, 290, 76, 288],
      [104, 286, 118, 266, 130, 246],
      [146, 220, 166, 208, 240, 208],
    ],
  ),
  bumpers: pair(
    [66, 82],
    [
      [76, 59, 100, 47, 132, 45],
      [150, 44, 162, 45, 168, 48],
      [174, 56, 172, 63, 164, 63],
      [146, 61, 128, 61, 112, 64],
      [92, 69, 80, 76, 74, 90],
    ],
  ),
  triggers: pair(
    [94, 54],
    [
      [100, 37, 118, 23, 140, 24],
      [156, 25, 164, 35, 164, 49],
      [164, 48, 162, 52, 158, 52],
      [136, 49, 114, 50, 94, 54],
    ],
  ),
  touchpad: roundedTrapezoid(240, 58, 128, 128, 112, 12),
  lightStrips: ['M169 66 L177 122', `M${mx(169)} 66 L${mx(177)} 122`],
  sticks: { left: [180, 172], right: [300, 172], r: 24 },
  dpad: { at: [110, 116], size: 54, style: 'split' },
  face: { at: [368, 116], gap: 23, r: 12.5, style: 'playstation' },
  center: [
    { input: 'back', x: 158, y: 72, w: 7, h: 16, icon: 'create' },
    { input: 'start', x: 322, y: 72, w: 7, h: 16, icon: 'options' },
    { input: 'guide', x: 240, y: 164, w: 20, h: 20, icon: 'guide' },
    { input: null, x: 240, y: 186, w: 18, h: 6, icon: 'mute' },
  ],
}

const dualshock4: GamepadLayout = {
  body: symmetric(
    [240, 62],
    [
      [206, 62, 170, 58, 142, 58],
      [110, 58, 82, 62, 68, 84],
      [54, 108, 40, 160, 34, 214],
      [30, 252, 44, 278, 70, 280],
      [94, 282, 108, 262, 120, 240],
      [138, 210, 160, 202, 240, 202],
    ],
  ),
  bumpers: pair(
    [70, 78],
    [
      [80, 59, 102, 49, 134, 47],
      [150, 46, 160, 47, 166, 50],
      [172, 58, 170, 65, 162, 65],
      [146, 63, 128, 63, 114, 66],
      [96, 70, 84, 76, 78, 88],
    ],
  ),
  triggers: pair(
    [96, 56],
    [
      [100, 41, 116, 29, 138, 29],
      [154, 29, 162, 37, 162, 44],
      [162, 50, 160, 54, 156, 54],
      [136, 51, 116, 52, 96, 56],
    ],
  ),
  touchpad: roundedTrapezoid(240, 60, 122, 116, 116, 9),
  grille: [240, 142],
  sticks: { left: [184, 166], right: [296, 166], r: 24 },
  dpad: { at: [110, 114], size: 54, style: 'split' },
  face: { at: [368, 114], gap: 23, r: 12.5, style: 'playstation' },
  center: [
    { input: 'back', x: 162, y: 76, w: 7, h: 15, icon: 'none' },
    { input: 'start', x: 318, y: 76, w: 7, h: 15, icon: 'none' },
    { input: 'guide', x: 240, y: 164, w: 19, h: 19, icon: 'guide' },
  ],
}

const switchPro: GamepadLayout = {
  body: symmetric(
    [240, 66],
    [
      [200, 66, 160, 58, 130, 60],
      [98, 62, 74, 74, 62, 100],
      [48, 130, 40, 176, 44, 214],
      [48, 250, 66, 268, 90, 266],
      [112, 264, 126, 248, 140, 232],
      [158, 212, 178, 208, 240, 208],
    ],
  ),
  bumpers: pair(
    [66, 88],
    [
      [76, 65, 100, 51, 132, 49],
      [152, 47, 168, 49, 178, 53],
      [184, 61, 182, 68, 174, 68],
      [156, 65, 134, 64, 116, 68],
      [96, 72, 82, 80, 74, 96],
    ],
  ),
  triggers: pair(
    [96, 58],
    [
      [100, 45, 118, 33, 140, 33],
      [156, 33, 166, 39, 168, 44],
      [169, 50, 168, 54, 166, 56],
      [142, 52, 118, 53, 96, 58],
    ],
  ),
  sticks: { left: [132, 120], right: [292, 166], r: 24 },
  dpad: { at: [188, 166], size: 40, style: 'cross' },
  face: { at: [348, 120], gap: 22, r: 12, style: 'nintendo' },
  center: [
    { input: 'back', x: 200, y: 92, w: 12, h: 12, icon: 'minus' },
    { input: 'start', x: 280, y: 92, w: 12, h: 12, icon: 'plus' },
    { input: 'guide', x: 262, y: 122, w: 16, h: 16, icon: 'home' },
    { input: null, x: 218, y: 122, w: 13, h: 13, icon: 'capture' },
  ],
}

const generic: GamepadLayout = {
  body: symmetric(
    [240, 66],
    [
      [196, 66, 152, 60, 122, 62],
      [90, 64, 68, 78, 58, 104],
      [46, 136, 38, 184, 44, 220],
      [50, 254, 70, 270, 94, 266],
      [116, 262, 128, 246, 142, 228],
      [160, 210, 182, 206, 240, 206],
    ],
  ),
  bumpers: pair(
    [64, 90],
    [
      [74, 65, 98, 51, 130, 49],
      [150, 47, 166, 49, 176, 53],
      [182, 61, 180, 68, 172, 68],
      [154, 65, 132, 64, 114, 68],
      [94, 72, 80, 80, 72, 98],
    ],
  ),
  triggers: pair(
    [94, 58],
    [
      [98, 45, 116, 33, 138, 33],
      [154, 33, 164, 39, 166, 44],
      [167, 50, 166, 54, 164, 56],
      [140, 52, 116, 53, 94, 58],
    ],
  ),
  sticks: { left: [130, 120], right: [294, 166], r: 24 },
  dpad: { at: [186, 166], size: 40, style: 'cross' },
  face: { at: [350, 120], gap: 22, r: 12, style: 'plain' },
  center: [
    { input: 'back', x: 210, y: 112, w: 18, h: 8, icon: 'none' },
    { input: 'start', x: 270, y: 112, w: 18, h: 8, icon: 'none' },
    { input: 'guide', x: 240, y: 88, w: 20, h: 20, icon: 'guide' },
  ],
}

export const GAMEPAD_LAYOUTS: Record<GamepadModel, GamepadLayout> = {
  xbox,
  dualsense,
  dualshock4,
  switchPro,
  generic,
}
