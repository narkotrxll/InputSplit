<script setup lang="ts">
import { computed } from 'vue'
import type { UiStatus } from '@shared/domain'
import { STATUS_STYLE } from '../lib/status'

const props = withDefaults(defineProps<{ status: UiStatus; size?: 'sm' | 'lg' }>(), { size: 'sm' })
const style = computed(() => STATUS_STYLE[props.status])
const tones = {
  neutral: 'bg-surface-2 border-line',
  accent: 'bg-accent-soft border-accent/20',
  success: 'bg-success-soft border-success/25',
  warning: 'bg-warning-soft border-warning/25',
  danger: 'bg-danger-soft border-danger/25',
  info: 'bg-info-soft border-info/25',
  orange: 'bg-orange-soft border-orange/25',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-2 rounded-full border font-medium whitespace-nowrap"
    :class="[
      tones[style.tone],
      style.text,
      size === 'lg' ? 'h-7 px-3 text-[13px]' : 'h-6 px-2.5 text-[12px]',
    ]"
    role="status"
    aria-live="polite"
  >
    <span
      class="relative inline-flex size-2 rounded-full"
      :class="[style.dot, style.pulse ? 'pulse-dot ' + style.text : '']"
    />
    {{ $t(`status.${status}`) }}
  </span>
</template>
