<script setup lang="ts">
import { Battery, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Cable } from '@lucide/vue'
import { computed } from 'vue'
import type { Controller } from '@shared/domain'

const props = defineProps<{ battery: Controller['battery'] }>()

const view = computed(() => {
  const b = props.battery
  if (b === null) return null
  if (b.type === 'wired') return { icon: Cable, key: 'wired', color: 'text-text-muted' }
  const map = {
    empty: { icon: BatteryWarning, color: 'text-danger' },
    low: { icon: BatteryLow, color: 'text-warning' },
    medium: { icon: BatteryMedium, color: 'text-text-muted' },
    full: { icon: BatteryFull, color: 'text-success' },
  } as const
  return { ...(map[b.level] ?? { icon: Battery, color: 'text-text-muted' }), key: b.level }
})
</script>

<template>
  <span v-if="view" class="inline-flex items-center gap-1 text-[12px]" :class="view.color">
    <component :is="view.icon" class="size-3.5" aria-hidden="true" />
    {{ $t(`controllers.battery.${view.key}`) }}
  </span>
</template>
