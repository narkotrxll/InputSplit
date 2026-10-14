<script setup lang="ts">
import { Check, Monitor, Tv } from '@lucide/vue'
import { onMounted } from 'vue'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'
import UiBadge from './ui/UiBadge.vue'

/** Onboarding: pick the screen the game should move to (a likely TV is preselected). */
const devices = useDevicesStore()
const isolation = useIsolationStore()

onMounted(() => {
  if (isolation.selection.displayId !== null) return
  const tv = devices.displays.find((d) => d.isLikelyTv)
  if (tv) void isolation.selectDisplay(tv.id)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-[13.5px] leading-relaxed text-text-muted">{{ $t('wizard.displayBody') }}</p>
    <ul class="flex flex-col gap-1">
      <li v-for="display in devices.displays" :key="display.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
          :class="
            isolation.selection.displayId === display.id
              ? 'border-accent/40 bg-accent-soft'
              : 'border-line hover:bg-surface-2'
          "
          :aria-pressed="isolation.selection.displayId === display.id"
          @click="isolation.selectDisplay(display.id)"
        >
          <component
            :is="display.isLikelyTv ? Tv : Monitor"
            class="size-4 shrink-0 text-text-muted"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13.5px] font-medium text-text">{{
              display.name
            }}</span>
            <span class="block text-[12px] text-text-faint tabular">
              {{ $t('displays.resolution', { w: display.bounds.width, h: display.bounds.height }) }}
              · {{ $t('displays.refresh', { hz: display.refreshRate }) }}
            </span>
          </span>
          <UiBadge v-if="display.isPrimary" tone="neutral">{{ $t('displays.primary') }}</UiBadge>
          <UiBadge v-if="display.isLikelyTv" tone="accent">{{ $t('displays.tv') }}</UiBadge>
          <Check
            v-if="isolation.selection.displayId === display.id"
            class="size-4 shrink-0 text-accent"
          />
        </button>
      </li>
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
          :class="
            isolation.selection.displayId === null
              ? 'border-accent/40 bg-accent-soft'
              : 'border-line hover:bg-surface-2'
          "
          :aria-pressed="isolation.selection.displayId === null"
          @click="isolation.selectDisplay(null)"
        >
          <span class="size-4 shrink-0" />
          <span class="flex-1 text-[13.5px] text-text-muted">{{ $t('displays.keep') }}</span>
          <Check
            v-if="isolation.selection.displayId === null"
            class="size-4 shrink-0 text-accent"
          />
        </button>
      </li>
    </ul>
  </div>
</template>
