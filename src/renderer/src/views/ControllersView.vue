<script setup lang="ts">
import { Gamepad2, Info } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import ControllerSlotCard from '../components/ControllerSlotCard.vue'
import GamepadVisualizer from '../components/GamepadVisualizer.vue'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiEmptyState from '../components/ui/UiEmptyState.vue'
import { useBackendStore } from '../stores/backend'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'

const devices = useDevicesStore()
const isolation = useIsolationStore()
const backend = useBackendStore()

const testSlot = computed(() => devices.testSlot)
const testController = computed(() => devices.controllers.find((c) => c.slot === testSlot.value))

async function toggleTest(slot: number): Promise<void> {
  if (devices.testSlot === slot) await devices.stopTest()
  else await devices.startTest(slot)
}

onMounted(() => {
  void devices.refresh().catch(() => {})
  const first = devices.connected[0]
  const preferred = isolation.selection.controllerSlot ?? first?.slot
  if (preferred !== undefined && backend.state?.status === 'ready')
    void devices.startTest(preferred)
})
// The 60 Hz test stream runs only while this page is visible.
onBeforeUnmount(() => void devices.stopTest().catch(() => {}))
</script>

<template>
  <div>
    <PageHeader :title="$t('controllers.title')" :subtitle="$t('controllers.subtitle')" />

    <div
      class="mb-4 flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-[12.5px] text-text-muted"
    >
      <Info class="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden="true" />
      {{ $t('controllers.slotNote') }}
    </div>

    <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <div
        v-for="controller in devices.controllers"
        :key="controller.slot"
        class="flex flex-col gap-2"
      >
        <ControllerSlotCard
          :controller="controller"
          :selected="isolation.selection.controllerSlot === controller.slot"
          @select="isolation.selectController(controller.slot)"
        />
        <UiButton
          v-if="controller.connected"
          size="sm"
          :variant="testSlot === controller.slot ? 'subtle' : 'ghost'"
          @click="toggleTest(controller.slot)"
        >
          {{ testSlot === controller.slot ? $t('controllers.stopTest') : $t('controllers.test') }}
        </UiButton>
      </div>
    </div>

    <UiCard
      v-if="testSlot !== null && testController?.connected"
      class="mt-5"
      :title="`${$t('controllers.testTitle')} · ${$t('common.slot', { n: testSlot + 1 })}`"
      :description="$t('controllers.testHint')"
    >
      <template #actions>
        <span class="text-[12px] text-text-faint tabular">{{
          $t('controllers.packets', { n: devices.testState?.packet ?? 0 })
        }}</span>
      </template>
      <GamepadVisualizer :state="devices.testState" />
    </UiCard>

    <UiEmptyState
      v-if="devices.loaded && devices.connected.length === 0"
      class="mt-6"
      :icon="Gamepad2"
      :title="$t('controllers.emptyTitle')"
      :description="$t('controllers.emptyHint')"
    />
  </div>
</template>
