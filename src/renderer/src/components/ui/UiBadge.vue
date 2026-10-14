<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'orange'
    icon?: Component
  }>(),
  { tone: 'neutral', icon: undefined },
)

const tones = {
  neutral: 'bg-surface-2 text-text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/25',
  orange: 'bg-orange-soft text-orange border-orange/25',
}
</script>

<template>
  <span
    class="inline-flex h-5.5 items-center gap-1 rounded-md border px-1.5 text-[11.5px] leading-none font-medium whitespace-nowrap"
    :class="tones[tone]"
  >
    <component :is="icon" v-if="icon" class="size-3" aria-hidden="true" />
    <slot />
  </span>
</template>
