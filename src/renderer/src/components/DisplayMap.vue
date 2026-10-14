<script setup lang="ts">
import { computed } from 'vue'
import type { Display } from '@shared/domain'

/** The monitor arrangement as Windows sees it (scaled), clickable to pick a screen. */
const props = defineProps<{
  displays: Display[]
  selectedId: string | null
  currentId?: string | null
}>()
const emit = defineEmits<{ select: [id: string] }>()

const PADDING = 8
const layout = computed(() => {
  if (props.displays.length === 0) return null
  const minX = Math.min(...props.displays.map((d) => d.bounds.x))
  const minY = Math.min(...props.displays.map((d) => d.bounds.y))
  const maxX = Math.max(...props.displays.map((d) => d.bounds.x + d.bounds.width))
  const maxY = Math.max(...props.displays.map((d) => d.bounds.y + d.bounds.height))
  const width = maxX - minX
  const height = maxY - minY
  const gap = Math.max(width, height) * 0.012 // a hairline between touching monitors
  return {
    viewBox: `${-PADDING * 10} ${-PADDING * 10} ${width + PADDING * 20} ${height + PADDING * 20}`,
    rects: props.displays.map((d) => ({
      display: d,
      x: d.bounds.x - minX + gap / 2,
      y: d.bounds.y - minY + gap / 2,
      w: d.bounds.width - gap,
      h: d.bounds.height - gap,
    })),
    fontSize: Math.max(width, height) * 0.032,
  }
})
</script>

<template>
  <svg
    v-if="layout"
    :viewBox="layout.viewBox"
    class="h-44 w-full"
    role="listbox"
    aria-label="Screens"
  >
    <g
      v-for="r in layout.rects"
      :key="r.display.id"
      role="option"
      :aria-selected="r.display.id === selectedId"
      tabindex="0"
      class="cursor-pointer outline-none"
      @click="emit('select', r.display.id)"
      @keydown.enter.prevent="emit('select', r.display.id)"
    >
      <rect
        :x="r.x"
        :y="r.y"
        :width="r.w"
        :height="r.h"
        :rx="layout.fontSize * 0.6"
        :fill="r.display.id === selectedId ? 'var(--app-accent-soft)' : 'var(--app-surface-2)'"
        :stroke="r.display.id === selectedId ? 'var(--app-accent)' : 'var(--app-line-strong)'"
        :stroke-width="layout.fontSize * 0.12"
        class="transition-colors"
      />
      <text
        :x="r.x + r.w / 2"
        :y="r.y + r.h / 2 - layout.fontSize * 0.2"
        text-anchor="middle"
        :font-size="layout.fontSize"
        font-weight="600"
        :fill="r.display.id === selectedId ? 'var(--app-accent)' : 'var(--app-text)'"
      >
        {{ r.display.name }}
      </text>
      <text
        :x="r.x + r.w / 2"
        :y="r.y + r.h / 2 + layout.fontSize * 1.1"
        text-anchor="middle"
        :font-size="layout.fontSize * 0.78"
        fill="var(--app-text-muted)"
      >
        {{ r.display.bounds.width }}×{{ r.display.bounds.height
        }}{{ r.display.id === currentId ? ' · ●' : '' }}
      </text>
    </g>
  </svg>
</template>
