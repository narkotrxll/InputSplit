<script setup lang="ts">
import { Gamepad2, Info } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GamepadModel } from '@shared/domain'
import { GAMEPAD_MODELS } from '@shared/gamepad-models'
import { INPUT_TOOLS } from '@shared/input-tools'
import ControllerSlotCard from '../components/ControllerSlotCard.vue'
import ControllerTuningCard from '../components/ControllerTuningCard.vue'
import GamepadVisualizer from '../components/GamepadVisualizer.vue'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCallout from '../components/ui/UiCallout.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiEmptyState from '../components/ui/UiEmptyState.vue'
import UiSelect from '../components/ui/UiSelect.vue'
import UiSwitch from '../components/ui/UiSwitch.vue'
import { useSettingsStore } from '../stores/settings'
import { useBackendStore } from '../stores/backend'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'

const devices = useDevicesStore()
const settings = useSettingsStore()
const isolation = useIsolationStore()
const backend = useBackendStore()

const testSlot = computed(() => devices.testSlot)
const testController = computed(() => devices.controllers.find((c) => c.slot === testSlot.value))
const { t } = useI18n()

// Picture in the test view: detected automatically, or chosen by hand.
const lookOptions = computed(() => [
  {
    value: 'auto' as const,
    label: t('controllers.lookAuto', {
      model: t(`controllers.model.${testController.value?.model ?? 'xbox'}`),
    }),
  },
  ...GAMEPAD_MODELS.map((m) => ({ value: m, label: t(`controllers.model.${m}`) })),
])
const look = computed<GamepadModel | 'auto'>({
  get: () => (testSlot.value === null ? 'auto' : (devices.looks[testSlot.value] ?? 'auto')),
  set: (value) => {
    if (testSlot.value !== null) devices.setLook(testSlot.value, value)
  },
})

// Programs between the controller and games, and pads a game may see twice.
const runningTools = computed(() =>
  INPUT_TOOLS.filter((tool) => devices.inputTools.includes(tool.id)),
)
const doubledSlots = computed(() =>
  devices.controllers.filter((c) => c.connected && c.doubled).map((c) => c.slot + 1),
)

async function toggleTest(slot: number): Promise<void> {
  if (devices.testSlot === slot) await devices.stopTest()
  else await devices.startTest(slot)
}

onMounted(() => {
  void devices.refresh().catch(() => {})
  void devices.refreshInputTools().catch(() => {})
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

    <UiCallout
      v-if="doubledSlots.length > 0 || runningTools.length > 0"
      class="mb-4"
      tone="warning"
      :title="$t('controllers.tools.title')"
    >
      <p v-if="doubledSlots.length > 0">
        {{ $t('controllers.tools.doubled', { slots: doubledSlots.join(', ') }) }}
      </p>
      <ul v-if="runningTools.length > 0" class="mt-1.5 list-disc space-y-1 pl-4">
        <li v-for="tool in runningTools" :key="tool.id">
          <span class="font-medium text-text">{{ tool.name }}</span
          >{{ ': '
          }}{{
            tool.id === 'steam' ? $t('controllers.tools.steam') : $t('controllers.tools.other')
          }}
        </li>
      </ul>
    </UiCallout>

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
        <div class="w-56">
          <!-- keyed: the trigger keeps its first label otherwise -->
          <UiSelect
            :key="`${testSlot}-${testController?.model}`"
            v-model="look"
            :options="lookOptions"
            :label="$t('controllers.look')"
          />
        </div>
      </template>
      <GamepadVisualizer :state="devices.testState" :model="devices.lookOf(testSlot)" />
    </UiCard>

    <UiCard class="mt-5" :padded="false">
      <label class="flex items-center justify-between gap-6 px-5 py-4">
        <span>
          <span class="block text-[13.5px] font-medium text-text">{{
            $t('controllers.bridge.title')
          }}</span>
          <span class="mt-0.5 block text-[12.5px] text-text-muted">{{
            $t('controllers.bridge.hint')
          }}</span>
        </span>
        <UiSwitch
          :model-value="settings.settings.padBridge"
          :label="$t('controllers.bridge.title')"
          @update:model-value="settings.update({ padBridge: $event })"
        />
      </label>
    </UiCard>

    <ControllerTuningCard v-if="devices.connected.length > 0" class="mt-5" />

    <UiEmptyState
      v-if="devices.loaded && devices.connected.length === 0"
      class="mt-6"
      :icon="Gamepad2"
      :title="$t('controllers.emptyTitle')"
      :description="$t('controllers.emptyHint')"
    />
  </div>
</template>
