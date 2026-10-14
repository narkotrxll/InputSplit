<script setup lang="ts">
import { Gamepad2, Shuffle } from '@lucide/vue'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'
import ControllerSlotCard from './ControllerSlotCard.vue'
import UiDialog from './ui/UiDialog.vue'
import UiEmptyState from './ui/UiEmptyState.vue'

const open = defineModel<boolean>('open', { required: true })
const devices = useDevicesStore()
const isolation = useIsolationStore()

async function choose(slot: number | null): Promise<void> {
  await isolation.selectController(slot)
  open.value = false
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="$t('picker.controllerTitle')"
    :description="$t('controllers.slotNote')"
    width="lg"
  >
    <div v-if="devices.connected.length > 0" class="grid grid-cols-2 gap-3">
      <ControllerSlotCard
        v-for="controller in devices.controllers"
        :key="controller.slot"
        :controller="controller"
        :selected="isolation.selection.controllerSlot === controller.slot"
        @select="choose(controller.slot)"
      />
    </div>
    <UiEmptyState
      v-else
      :icon="Gamepad2"
      :title="$t('controllers.emptyTitle')"
      :description="$t('controllers.emptyHint')"
    />
    <button
      type="button"
      class="mt-3 flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors"
      :class="
        isolation.selection.controllerSlot === null
          ? 'border-accent/45 bg-accent-soft'
          : 'border-line hover:bg-surface-2'
      "
      @click="choose(null)"
    >
      <Shuffle class="size-4 text-text-muted" aria-hidden="true" />
      <span>
        <span class="block text-[13.5px] font-medium text-text">{{
          $t('dashboard.anyController')
        }}</span>
        <span class="block text-[12px] text-text-faint">{{
          $t('dashboard.anyControllerHint')
        }}</span>
      </span>
    </button>
  </UiDialog>
</template>
