<script setup lang="ts">
import { computed, useId } from 'vue'
import { XInputButton } from '@shared/defaults'
import type { ControllerState, GamepadModel } from '@shared/domain'
import {
  GAMEPAD_LAYOUTS,
  VIEW_H,
  VIEW_W,
  type CenterButton,
  type FaceStyle,
} from '../lib/gamepad-layouts'

/** Live drawing of the connected controller from its XInput state. */
const props = withDefaults(defineProps<{ state: ControllerState | null; model?: GamepadModel }>(), {
  model: 'xbox',
})

const uid = useId()
const layout = computed(() => GAMEPAD_LAYOUTS[props.model])

const buttons = computed(() => props.state?.buttons ?? 0)
const pressed = (mask: number) => (buttons.value & mask) !== 0

function deflection(x: number | undefined, y: number | undefined, travel: number) {
  const scale = travel / 32767
  return { dx: (x ?? 0) * scale, dy: -(y ?? 0) * scale }
}
const travel = computed(() => layout.value.sticks.r * 0.38)
const sticks = computed(() => {
  const s = layout.value.sticks
  const l = deflection(props.state?.thumbLX, props.state?.thumbLY, travel.value)
  const r = deflection(props.state?.thumbRX, props.state?.thumbRY, travel.value)
  return [
    { key: 'l', x: s.left[0], y: s.left[1], ...l, click: pressed(XInputButton.leftThumb) },
    { key: 'r', x: s.right[0], y: s.right[1], ...r, click: pressed(XInputButton.rightThumb) },
  ]
})

const lt = computed(() => (props.state?.leftTrigger ?? 0) / 255)
const rt = computed(() => (props.state?.rightTrigger ?? 0) / 255)

/** Trigger names as printed on each controller (brand terms, not translated). */
const triggerNames = computed((): [string, string] => {
  switch (props.model) {
    case 'dualsense':
    case 'dualshock4':
      return ['L2', 'R2']
    case 'switchPro':
      return ['ZL', 'ZR']
    default:
      return ['LT', 'RT']
  }
})

// Face buttons by position; XInput names them after the Xbox layout (A is the bottom one).
type Glyph = 'triangle' | 'circle' | 'cross' | 'square' | string
const FACE: Record<FaceStyle, { glyph: Glyph; tone: string }[]> = {
  xbox: [
    { glyph: 'Y', tone: 'var(--app-warning)' },
    { glyph: 'B', tone: 'var(--app-danger)' },
    { glyph: 'A', tone: 'var(--app-success)' },
    { glyph: 'X', tone: 'var(--app-info)' },
  ],
  playstation: [
    { glyph: 'triangle', tone: 'var(--pad-ps-triangle)' },
    { glyph: 'circle', tone: 'var(--pad-ps-circle)' },
    { glyph: 'cross', tone: 'var(--pad-ps-cross)' },
    { glyph: 'square', tone: 'var(--pad-ps-square)' },
  ],
  nintendo: [
    { glyph: 'X', tone: 'var(--pad-ink)' },
    { glyph: 'A', tone: 'var(--pad-ink)' },
    { glyph: 'B', tone: 'var(--pad-ink)' },
    { glyph: 'Y', tone: 'var(--pad-ink)' },
  ],
  plain: [
    { glyph: 'Y', tone: 'var(--pad-ink)' },
    { glyph: 'B', tone: 'var(--pad-ink)' },
    { glyph: 'A', tone: 'var(--pad-ink)' },
    { glyph: 'X', tone: 'var(--pad-ink)' },
  ],
}
const FACE_MASKS = [XInputButton.y, XInputButton.b, XInputButton.a, XInputButton.x]
const FACE_OFFSETS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const

const face = computed(() => {
  const { at, gap, r, style } = layout.value.face
  return FACE[style].map((b, i) => ({
    ...b,
    r,
    x: at[0] + FACE_OFFSETS[i]![0] * gap,
    y: at[1] + FACE_OFFSETS[i]![1] * gap,
    on: pressed(FACE_MASKS[i]!),
  }))
})

/** PlayStation symbols, drawn as strokes around (0, 0) for a button of radius r. */
function symbol(glyph: Glyph, r: number): string {
  const s = r * 0.46
  switch (glyph) {
    case 'triangle':
      return `M0 ${-s} L${s * 0.95} ${s * 0.68} L${-s * 0.95} ${s * 0.68}Z`
    case 'square':
      return `M${-s * 0.78} ${-s * 0.78} h${s * 1.56} v${s * 1.56} h${-s * 1.56}Z`
    case 'cross':
      return `M${-s * 0.8} ${-s * 0.8} L${s * 0.8} ${s * 0.8} M${s * 0.8} ${-s * 0.8} L${-s * 0.8} ${s * 0.8}`
    default:
      return ''
  }
}

// D-pad: four directions in the order up, right, down, left.
const DPAD_MASKS = [
  XInputButton.dpadUp,
  XInputButton.dpadRight,
  XInputButton.dpadDown,
  XInputButton.dpadLeft,
]
const dpad = computed(() => {
  const { at, size, style } = layout.value.dpad
  const half = size / 2
  const arm = size * (style === 'cross' ? 0.17 : 0.19)
  // An arm pointing up from the centre; the others are rotations of it.
  const shape =
    style === 'cross'
      ? `M${-arm} ${-half + 3} Q${-arm} ${-half} ${-arm + 3} ${-half} H${arm - 3} Q${arm} ${-half} ${arm} ${-half + 3} V${-arm} H${-arm}Z`
      : `M${-arm - 1} ${-half + 4} Q${-arm - 1} ${-half} ${-arm + 3} ${-half} H${arm - 3} Q${arm + 1} ${-half} ${arm + 1} ${-half + 4} V${-arm * 0.95} L0 ${-arm * 0.25} L${-arm - 1} ${-arm * 0.95}Z`
  const arrow = `M0 ${-half + 5} l${arm * 0.42} ${arm * 0.5} h${-arm * 0.84}Z`
  return {
    x: at[0],
    y: at[1],
    style,
    half,
    arm,
    shape,
    arrow,
    dirs: DPAD_MASKS.map((mask, i) => ({ angle: i * 90, on: pressed(mask) })),
  }
})
const crossOutline = computed(() => {
  const { half: h, arm: a } = dpad.value
  return `M${-a} ${-h} H${a} V${-a} H${h} V${a} H${a} V${h} H${-a} V${a} H${-h} V${-a} H${-a}Z`
})

function centerOn(button: CenterButton): boolean {
  if (button.input === 'guide') return props.state?.guide === true
  if (button.input === 'back') return pressed(XInputButton.back)
  if (button.input === 'start') return pressed(XInputButton.start)
  return false
}
const center = computed(() =>
  layout.value.center.map((b) => ({
    ...b,
    on: centerOn(b),
    rx: b.icon === 'capture' ? 3 : Math.min(b.w, b.h) / 2,
  })),
)

const shoulders = computed(() => [
  {
    key: 'l',
    trigger: layout.value.triggers[0],
    bumper: layout.value.bumpers[0],
    value: lt.value,
    bump: pressed(XInputButton.leftShoulder),
  },
  {
    key: 'r',
    trigger: layout.value.triggers[1],
    bumper: layout.value.bumpers[1],
    value: rt.value,
    bump: pressed(XInputButton.rightShoulder),
  },
])

const id = (name: string) => `${uid}-${name}`
const url = (name: string) => `url(#${id(name)})`
const meters = computed(() => [
  { label: triggerNames.value[0], value: Math.round(lt.value * 100) },
  { label: triggerNames.value[1], value: Math.round(rt.value * 100) },
])
</script>

<template>
  <div class="pad flex flex-col items-center gap-4">
    <svg
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      class="w-full max-w-[460px] overflow-visible"
      role="img"
      :aria-label="$t('controllers.stateLabel')"
    >
      <defs>
        <linearGradient :id="id('body')" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--pad-body-a)" />
          <stop offset="1" stop-color="var(--pad-body-b)" />
        </linearGradient>
        <linearGradient :id="id('touch')" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--pad-touch-a)" />
          <stop offset="1" stop-color="var(--pad-touch-b)" />
        </linearGradient>
        <radialGradient :id="id('cap')" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stop-color="var(--pad-cap-a)" />
          <stop offset="1" stop-color="var(--pad-cap-b)" />
        </radialGradient>
        <radialGradient :id="id('well')" cx="0.5" cy="0.4" r="0.6">
          <stop offset="0.6" stop-color="var(--pad-well)" />
          <stop offset="1" stop-color="var(--pad-well-edge)" />
        </radialGradient>
        <linearGradient
          v-for="s in shoulders"
          :id="id(`trigger-${s.key}`)"
          :key="s.key"
          x1="0"
          y1="1"
          x2="0"
          y2="0"
        >
          <stop offset="0" stop-color="var(--pad-on)" />
          <stop :offset="s.value" stop-color="var(--pad-on)" />
          <stop :offset="s.value" stop-color="var(--pad-trigger)" />
          <stop offset="1" stop-color="var(--pad-trigger)" />
        </linearGradient>
        <clipPath :id="id('body-clip')">
          <path :d="layout.body" />
        </clipPath>
      </defs>

      <!-- triggers and bumpers sit behind the body -->
      <g v-for="s in shoulders" :key="s.key">
        <path
          :d="s.trigger"
          :fill="url(`trigger-${s.key}`)"
          stroke="var(--pad-edge)"
          stroke-width="1.2"
          :class="{ lit: s.value > 0.02 }"
        />
        <path
          :d="s.bumper"
          :fill="s.bump ? 'var(--pad-on)' : 'var(--pad-trigger)'"
          stroke="var(--pad-edge)"
          stroke-width="1.2"
          :class="{ lit: s.bump }"
        />
      </g>

      <!-- body -->
      <path :d="layout.body" class="pad-shadow" :fill="url('body')" />
      <path :d="layout.body" fill="none" stroke="var(--pad-edge)" stroke-width="1.4" />
      <g :clip-path="url('body-clip')">
        <path
          :d="layout.body"
          fill="none"
          stroke="var(--pad-shine)"
          stroke-width="3"
          transform="translate(0 2)"
        />
      </g>
      <path
        v-if="layout.panel"
        :d="layout.panel"
        fill="var(--pad-panel)"
        stroke="var(--pad-edge)"
        stroke-width="1"
      />

      <!-- touchpad, light strips, speaker -->
      <path
        v-if="layout.touchpad"
        :d="layout.touchpad"
        :fill="url('touch')"
        stroke="var(--pad-edge)"
        stroke-width="1.2"
      />
      <template v-if="layout.lightStrips">
        <path v-for="(d, i) in layout.lightStrips" :key="i" :d="d" class="strip" />
      </template>
      <g v-if="layout.grille" fill="var(--pad-well)">
        <template v-for="row in 3" :key="row">
          <circle
            v-for="col in 8 - row"
            :key="col"
            :cx="layout.grille[0] + (col - (9 - row) / 2) * 5"
            :cy="layout.grille[1] + (row - 2) * 4.5"
            r="1.2"
          />
        </template>
      </g>

      <!-- d-pad -->
      <g :transform="`translate(${dpad.x} ${dpad.y})`">
        <circle
          v-if="dpad.style === 'cross'"
          :r="dpad.half + 6"
          :fill="url('well')"
          stroke="var(--pad-edge)"
        />
        <path
          v-if="dpad.style === 'cross'"
          :d="crossOutline"
          fill="var(--pad-btn)"
          stroke="var(--pad-btn-edge)"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
        <g v-for="d in dpad.dirs" :key="d.angle" :transform="`rotate(${d.angle})`">
          <path
            :d="dpad.shape"
            :fill="
              d.on ? 'var(--pad-on)' : dpad.style === 'cross' ? 'transparent' : 'var(--pad-btn)'
            "
            :stroke="dpad.style === 'cross' ? 'none' : 'var(--pad-btn-edge)'"
            stroke-width="1.2"
            stroke-linejoin="round"
            :class="{ lit: d.on }"
          />
          <path :d="dpad.arrow" :fill="d.on ? 'var(--pad-on-ink)' : 'var(--pad-ink-soft)'" />
        </g>
      </g>

      <!-- sticks -->
      <g v-for="s in sticks" :key="s.key" :transform="`translate(${s.x} ${s.y})`">
        <circle
          :r="layout.sticks.r"
          :fill="url('well')"
          stroke="var(--pad-edge)"
          stroke-width="1.2"
        />
        <line
          v-if="Math.hypot(s.dx, s.dy) > 1.5"
          x1="0"
          y1="0"
          :x2="s.dx"
          :y2="s.dy"
          stroke="var(--pad-on)"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.55"
        />
        <g :transform="`translate(${s.dx} ${s.dy})`" :class="{ lit: s.click }">
          <circle
            :r="layout.sticks.r * 0.7"
            :fill="url('cap')"
            :stroke="s.click ? 'var(--pad-on)' : 'var(--pad-cap-edge)'"
            :stroke-width="s.click ? 2.5 : 1.2"
          />
          <circle
            :r="layout.sticks.r * 0.47"
            :fill="s.click ? 'var(--pad-on)' : 'var(--pad-cap-dish)'"
            stroke="var(--pad-cap-edge)"
            stroke-width="0.8"
          />
        </g>
      </g>

      <!-- face buttons -->
      <g v-for="b in face" :key="b.glyph" :transform="`translate(${b.x} ${b.y})`">
        <circle
          :r="b.r"
          :fill="b.on ? b.tone : 'var(--pad-btn)'"
          :stroke="b.on ? b.tone : 'var(--pad-btn-edge)'"
          stroke-width="1.2"
          :class="{ lit: b.on }"
          :style="b.on ? { '--lit': b.tone } : undefined"
        />
        <circle
          v-if="b.glyph === 'circle'"
          :r="b.r * 0.42"
          fill="none"
          :stroke="b.on ? 'var(--pad-on-ink)' : b.tone"
          stroke-width="1.8"
        />
        <path
          v-else-if="b.glyph.length > 1"
          :d="symbol(b.glyph, b.r)"
          fill="none"
          :stroke="b.on ? 'var(--pad-on-ink)' : b.tone"
          stroke-width="1.8"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <text
          v-else
          y="0.5"
          text-anchor="middle"
          dominant-baseline="central"
          :font-size="b.r * 1.05"
          font-weight="700"
          :fill="b.on ? 'var(--pad-on-ink)' : b.tone"
        >
          {{ b.glyph }}
        </text>
      </g>

      <!-- centre buttons -->
      <g v-for="(b, i) in center" :key="i" :transform="`translate(${b.x} ${b.y})`">
        <rect
          :x="-b.w / 2"
          :y="-b.h / 2"
          :width="b.w"
          :height="b.h"
          :rx="b.rx"
          :fill="b.on ? 'var(--pad-on)' : 'var(--pad-btn)'"
          :stroke="b.on ? 'var(--pad-on)' : 'var(--pad-btn-edge)'"
          stroke-width="1.1"
          :class="{ lit: b.on }"
        />
        <g
          :stroke="b.on ? 'var(--pad-on-ink)' : 'var(--pad-ink-soft)'"
          fill="none"
          stroke-width="1.1"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <template v-if="b.icon === 'view'">
            <rect x="-3.6" y="-3" width="5" height="4" rx="0.8" />
            <rect x="-1.4" y="-1" width="5" height="4" rx="0.8" />
          </template>
          <path v-else-if="b.icon === 'menu'" d="M-3 -2.4 H3 M-3 0 H3 M-3 2.4 H3" />
          <path v-else-if="b.icon === 'share'" d="M0 2 V-1.8 M-1.6 -0.4 L0 -1.9 L1.6 -0.4" />
          <path v-else-if="b.icon === 'minus'" d="M-3 0 H3" stroke-width="1.6" />
          <path v-else-if="b.icon === 'plus'" d="M-3 0 H3 M0 -3 V3" stroke-width="1.6" />
          <path v-else-if="b.icon === 'home'" d="M-3.4 0 L0 -3 L3.4 0 M-2.3 -0.8 V3 H2.3 V-0.8" />
          <circle v-else-if="b.icon === 'capture'" r="2.6" />
          <circle v-else-if="b.icon === 'guide'" :r="b.w * 0.26" stroke-width="1.6" />
        </g>
      </g>
    </svg>

    <div class="grid w-full max-w-[460px] grid-cols-2 gap-4">
      <div v-for="t in meters" :key="t.label">
        <div class="mb-1 flex justify-between text-[11.5px] text-text-faint">
          <span class="font-medium">{{ t.label }}</span
          ><span class="tabular">{{ t.value }}%</span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-75"
            :style="{ width: `${t.value}%` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pad {
  --pad-body-a: #2b2e36;
  --pad-body-b: #1b1d23;
  --pad-edge: rgb(255 255 255 / 0.1);
  --pad-shine: rgb(255 255 255 / 0.07);
  --pad-panel: #16181d;
  --pad-well: #0e0f13;
  --pad-well-edge: #08090b;
  --pad-cap-a: #434753;
  --pad-cap-b: #272a31;
  --pad-cap-edge: rgb(255 255 255 / 0.12);
  --pad-cap-dish: #1f2228;
  --pad-btn: #24272e;
  --pad-btn-edge: rgb(255 255 255 / 0.1);
  --pad-trigger: #1e2026;
  --pad-touch-a: #24272e;
  --pad-touch-b: #1d1f25;
  --pad-ink: #a3a8b2;
  --pad-ink-soft: #6f747e;
  --pad-on: var(--app-accent);
  --pad-on-ink: #0b0c0f;
  --pad-shadow: rgb(0 0 0 / 0.5);
  --pad-ps-triangle: #3ecfb4;
  --pad-ps-circle: #f26b6b;
  --pad-ps-cross: #7aa6ff;
  --pad-ps-square: #e78bd0;
}

[data-theme='light'] .pad {
  --pad-body-a: #ffffff;
  --pad-body-b: #eceef2;
  --pad-edge: rgb(15 17 23 / 0.16);
  --pad-shine: rgb(255 255 255 / 0.95);
  --pad-panel: #f4f5f8;
  --pad-well: #d9dce2;
  --pad-well-edge: #c9cdd5;
  --pad-cap-a: #4a4e58;
  --pad-cap-b: #2a2d34;
  --pad-cap-edge: rgb(0 0 0 / 0.25);
  --pad-cap-dish: #34373f;
  --pad-btn: #f7f8fa;
  --pad-btn-edge: rgb(15 17 23 / 0.16);
  --pad-trigger: #e1e4e9;
  --pad-touch-a: #f6f7f9;
  --pad-touch-b: #e7e9ed;
  --pad-ink: #5b606a;
  --pad-ink-soft: #8a8f99;
  --pad-on-ink: #ffffff;
  --pad-shadow: rgb(15 17 23 / 0.16);
  --pad-ps-triangle: #12a08a;
  --pad-ps-circle: #d64545;
  --pad-ps-cross: #3f73d8;
  --pad-ps-square: #c2459f;
}

.pad-shadow {
  filter: drop-shadow(0 12px 18px var(--pad-shadow));
}

.lit {
  filter: drop-shadow(0 0 5px var(--lit, var(--pad-on)));
}

.strip {
  fill: none;
  stroke: var(--pad-on);
  stroke-width: 2.5;
  stroke-linecap: round;
  opacity: 0.7;
  filter: drop-shadow(0 0 4px var(--pad-on));
}
</style>
