<script setup lang="ts">
import { Check, Monitor, Tv } from '@lucide/vue'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'
import DisplayMap from './DisplayMap.vue'
import UiBadge from './ui/UiBadge.vue'
import UiDialog from './ui/UiDialog.vue'
import UiSwitch from './ui/UiSwitch.vue'

const open = defineModel<boolean>('open', { required: true })
const devices = useDevicesStore()
const isolation = useIsolationStore()

async function choose(id: string | null): Promise<void> {
  await isolation.selectDisplay(id)
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="$t('displays.title')"
    :description="$t('displays.hint')"
    width="lg"
  >
    <DisplayMap
      :displays="devices.displays"
      :selected-id="isolation.selection.displayId"
      class="mb-4 rounded-lg border border-line bg-bg-subtle"
      @select="choose"
    />
    <ul class="flex flex-col gap-1">
      <li v-for="display in devices.displays" :key="display.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
          :class="
            isolation.selection.displayId === display.id
              ? 'border-accent/40 bg-accent-soft'
              : 'border-transparent hover:bg-surface-2'
          "
          @click="choose(display.id)"
        >
          <component
            :is="display.isLikelyTv ? Tv : Monitor"
            class="size-4 text-text-muted"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13.5px] font-medium text-text">{{
              display.name
            }}</span>
            <span class="block text-[12px] text-text-faint tabular">
              {{ $t('displays.resolution', { w: display.bounds.width, h: display.bounds.height }) }}
              · {{ $t('displays.refresh', { hz: display.refreshRate }) }} ·
              {{ $t('displays.scale', { percent: Math.round(display.scale * 100) }) }}
            </span>
          </span>
          <UiBadge v-if="display.isPrimary" tone="neutral">{{ $t('displays.primary') }}</UiBadge>
          <UiBadge v-if="display.isLikelyTv" tone="accent">{{ $t('displays.tv') }}</UiBadge>
          <Check v-if="isolation.selection.displayId === display.id" class="size-4 text-accent" />
        </button>
      </li>
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
          :class="
            isolation.selection.displayId === null
              ? 'border-accent/40 bg-accent-soft'
              : 'border-transparent hover:bg-surface-2'
          "
          @click="choose(null)"
        >
          <span class="size-4" />
          <span class="flex-1 text-[13.5px] text-text-muted">{{ $t('displays.keep') }}</span>
          <Check v-if="isolation.selection.displayId === null" class="size-4 text-accent" />
        </button>
      </li>
    </ul>
    <label
      v-if="isolation.selection.displayId !== null"
      class="mt-4 flex items-center justify-between gap-4 rounded-lg border border-line bg-bg-subtle px-4 py-3"
    >
      <span class="text-[13px] text-text">{{ $t('dashboard.moveWindow') }}</span>
      <UiSwitch
        :model-value="isolation.selection.moveWindow"
        :label="$t('dashboard.moveWindow')"
        @update:model-value="isolation.setMoveWindow($event)"
      />
    </label>
  </UiDialog>
</template>
