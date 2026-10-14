<script setup lang="ts">
import { CircleCheck, CircleDashed, CircleSlash, CircleX, LoaderCircle } from '@lucide/vue'
import type { FeatureFlags, FeatureName, FeatureReport } from '@shared/domain'
import { FEATURE_META } from '../lib/features'
import UiSwitch from './ui/UiSwitch.vue'
import UiTooltip from './ui/UiTooltip.vue'

/**
 * Two modes:
 *  - `flags` given: editable switches (before isolation starts),
 *  - `reports` given: read-only states confirmed by the hook DLL (while running).
 */
const props = defineProps<{
  flags?: FeatureFlags
  reports?: FeatureReport[]
  disabled?: Partial<Record<FeatureName, string>>
}>()
const emit = defineEmits<{ toggle: [name: FeatureName, value: boolean] }>()

const stateIcon = {
  active: { icon: CircleCheck, class: 'text-success' },
  pending: { icon: LoaderCircle, class: 'text-info animate-spin' },
  failed: { icon: CircleX, class: 'text-danger' },
  unsupported: { icon: CircleSlash, class: 'text-warning' },
  off: { icon: CircleDashed, class: 'text-text-faint' },
}

function report(name: FeatureName): FeatureReport | undefined {
  return props.reports?.find((r) => r.name === name)
}
</script>

<template>
  <ul class="divide-y divide-line">
    <li
      v-for="meta in FEATURE_META"
      :key="meta.name"
      class="flex items-start gap-3.5 py-3 first:pt-0 last:pb-0"
    >
      <span
        class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2"
      >
        <component :is="meta.icon" class="size-4 text-text-muted" aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[13.5px] font-medium text-text">{{ $t(`features.${meta.name}.title`) }}</p>
        <p class="mt-0.5 text-[12.5px] leading-snug text-text-muted">
          <template v-if="report(meta.name)?.reason">
            {{ $t(`features.reason.${report(meta.name)?.reason}`) }}
          </template>
          <template v-else-if="disabled?.[meta.name]">{{ disabled[meta.name] }}</template>
          <template v-else>{{ $t(`features.${meta.name}.description`) }}</template>
        </p>
      </div>
      <div class="flex shrink-0 items-center pt-1">
        <template v-if="reports">
          <span
            v-if="report(meta.name)"
            class="inline-flex items-center gap-1.5 text-[12px] font-medium"
            :class="stateIcon[report(meta.name)!.state].class.replace('animate-spin', '')"
          >
            <component
              :is="stateIcon[report(meta.name)!.state].icon"
              class="size-4"
              :class="stateIcon[report(meta.name)!.state].class"
              aria-hidden="true"
            />
            {{ $t(`features.state.${report(meta.name)!.state}`) }}
          </span>
        </template>
        <UiTooltip v-else-if="flags" :text="disabled?.[meta.name]">
          <span>
            <UiSwitch
              :model-value="flags[meta.name] && !disabled?.[meta.name]"
              :disabled="!!disabled?.[meta.name]"
              :label="$t(`features.${meta.name}.title`)"
              @update:model-value="emit('toggle', meta.name, $event)"
            />
          </span>
        </UiTooltip>
      </div>
    </li>
  </ul>
</template>
