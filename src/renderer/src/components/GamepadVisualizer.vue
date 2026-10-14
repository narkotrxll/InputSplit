<script setup lang="ts">
import { computed } from 'vue'
import { XInputButton } from '@shared/defaults'
import type { ControllerState } from '@shared/domain'

/** Live drawing of an Xbox-style controller from an XInput state. */
const props = defineProps<{ state: ControllerState | null }>()

const buttons = computed(() => props.state?.buttons ?? 0)
const pressed = (mask: number) => (buttons.value & mask) !== 0

function stick(x: number | undefined, y: number | undefined) {
  const scale = 13 / 32767
  return { dx: (x ?? 0) * scale, dy: -(y ?? 0) * scale }
}
const left = computed(() => stick(props.state?.thumbLX, props.state?.thumbLY))
const right = computed(() => stick(props.state?.thumbRX, props.state?.thumbRY))
const lt = computed(() => Math.round(((props.state?.leftTrigger ?? 0) / 255) * 100))
const rt = computed(() => Math.round(((props.state?.rightTrigger ?? 0) / 255) * 100))

const face = [
  { label: 'Y', mask: XInputButton.y, cx: 236, cy: 70, color: '#f2c94c' },
  { label: 'X', mask: XInputButton.x, cx: 218, cy: 88, color: '#5aa9ff' },
  { label: 'B', mask: XInputButton.b, cx: 254, cy: 88, color: '#f26b6b' },
  { label: 'A', mask: XInputButton.a, cx: 236, cy: 106, color: '#3ecf8e' },
]
const dpad = [
  { mask: XInputButton.dpadUp, x: 112, y: 112, w: 12, h: 13 },
  { mask: XInputButton.dpadDown, x: 112, y: 137, w: 12, h: 13 },
  { mask: XInputButton.dpadLeft, x: 98, y: 125, w: 14, h: 12 },
  { mask: XInputButton.dpadRight, x: 124, y: 125, w: 14, h: 12 },
]
const idle = 'var(--app-surface-3)'
const line = 'var(--app-line-strong)'
const accent = 'var(--app-accent)'
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <svg
      viewBox="0 0 320 200"
      class="w-full max-w-[440px]"
      role="img"
      :aria-label="$t('controllers.stateLabel')"
    >
      <!-- bumpers -->
      <rect
        x="52"
        y="22"
        width="62"
        height="10"
        rx="5"
        :fill="pressed(XInputButton.leftShoulder) ? accent : idle"
        :stroke="line"
      />
      <rect
        x="206"
        y="22"
        width="62"
        height="10"
        rx="5"
        :fill="pressed(XInputButton.rightShoulder) ? accent : idle"
        :stroke="line"
      />
      <!-- body -->
      <path
        d="M70 40 Q160 28 250 40 Q290 48 300 100 Q312 160 290 178 Q268 194 245 168 L225 145 Q160 138 95 145 L75 168 Q52 194 30 178 Q8 160 20 100 Q30 48 70 40Z"
        fill="var(--app-surface-2)"
        :stroke="line"
        stroke-width="1.5"
      />
      <!-- left stick -->
      <circle cx="84" cy="88" r="21" :fill="idle" :stroke="line" />
      <circle
        :cx="84 + left.dx"
        :cy="88 + left.dy"
        r="12"
        :fill="pressed(XInputButton.leftThumb) ? accent : 'var(--app-text-faint)'"
      />
      <!-- right stick -->
      <circle cx="198" cy="130" r="21" :fill="idle" :stroke="line" />
      <circle
        :cx="198 + right.dx"
        :cy="130 + right.dy"
        r="12"
        :fill="pressed(XInputButton.rightThumb) ? accent : 'var(--app-text-faint)'"
      />
      <!-- d-pad -->
      <rect
        v-for="(d, i) in dpad"
        :key="i"
        :x="d.x"
        :y="d.y"
        :width="d.w"
        :height="d.h"
        rx="2"
        :fill="pressed(d.mask) ? accent : idle"
        :stroke="line"
      />
      <!-- face buttons -->
      <g v-for="b in face" :key="b.label">
        <circle
          :cx="b.cx"
          :cy="b.cy"
          r="10"
          :fill="pressed(b.mask) ? b.color : idle"
          :stroke="pressed(b.mask) ? b.color : line"
        />
        <text
          :x="b.cx"
          :y="b.cy + 4"
          text-anchor="middle"
          font-size="10"
          font-weight="600"
          :fill="pressed(b.mask) ? '#0b0c0f' : b.color"
        >
          {{ b.label }}
        </text>
      </g>
      <!-- back / guide / start -->
      <circle
        cx="142"
        cy="90"
        r="6"
        :fill="pressed(XInputButton.back) ? accent : idle"
        :stroke="line"
      />
      <circle
        cx="178"
        cy="90"
        r="6"
        :fill="pressed(XInputButton.start) ? accent : idle"
        :stroke="line"
      />
      <circle cx="160" cy="64" r="9" :fill="state?.guide ? accent : idle" :stroke="line" />
    </svg>

    <div class="grid w-full max-w-[440px] grid-cols-2 gap-4">
      <div
        v-for="t in [
          { label: 'LT', value: lt },
          { label: 'RT', value: rt },
        ]"
        :key="t.label"
      >
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
