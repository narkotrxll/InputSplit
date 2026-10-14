<script setup lang="ts">
import { computed } from 'vue'

/** An application icon, or a monogram when Windows has no icon for it. */
const props = withDefaults(defineProps<{ src: string | null; name: string; size?: number }>(), {
  size: 36,
})
const letter = computed(
  () =>
    props.name
      .replace(/\.exe$/i, '')
      .trim()
      .charAt(0)
      .toUpperCase() || '?',
)
const hue = computed(() => [...props.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7))
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <img v-if="src" :src="src" alt="" class="size-[72%] object-contain" draggable="false" />
    <span
      v-else
      class="font-semibold"
      :style="{
        color: `hsl(${hue} 65% var(--app-monogram-lightness))`,
        fontSize: `${Math.round(size * 0.42)}px`,
      }"
    >
      {{ letter }}
    </span>
  </div>
</template>
