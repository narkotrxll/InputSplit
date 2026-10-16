<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GAMEPAD_BUTTONS, type GamepadButton } from '@shared/defaults'
import type { GamepadTuning } from '@shared/domain'
import { isDefaultTuning, stickPercent, withPlayerSlot } from '@shared/tuning'
import { useDevicesStore } from '../stores/devices'
import { useSettingsStore } from '../stores/settings'
import UiButton from './ui/UiButton.vue'
import UiCard from './ui/UiCard.vue'
import UiSelect from './ui/UiSelect.vue'

const store = useSettingsStore()
const devices = useDevicesStore()
const { t } = useI18n()

const tuning = computed(() => store.settings.gamepadTuning)

function save(patch: Partial<GamepadTuning>): void {
  void store.update({ gamepadTuning: { ...tuning.value, ...patch } })
}

type Zone = 'leftDeadzone' | 'rightDeadzone' | 'triggerDeadzone'

// Live readout from the controller test, so drift can be measured with the stick released.
const now = computed<Record<Zone, number | null>>(() => {
  const s = devices.testState
  if (!s?.connected || s.thumbLX === undefined) {
    return { leftDeadzone: null, rightDeadzone: null, triggerDeadzone: null }
  }
  return {
    leftDeadzone: stickPercent(s.thumbLX, s.thumbLY ?? 0),
    rightDeadzone: stickPercent(s.thumbRX ?? 0, s.thumbRY ?? 0),
    triggerDeadzone: Math.round((Math.max(s.leftTrigger ?? 0, s.rightTrigger ?? 0) / 255) * 100),
  }
})
const zones: Zone[] = ['leftDeadzone', 'rightDeadzone', 'triggerDeadzone']

const BUTTON_LABELS: Record<GamepadButton, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  leftShoulder: 'LB',
  rightShoulder: 'RB',
  back: 'View',
  start: 'Menu',
  leftThumb: 'LS',
  rightThumb: 'RS',
  dpadUp: '↑',
  dpadDown: '↓',
  dpadLeft: '←',
  dpadRight: '→',
}
const label = (button: GamepadButton) =>
  button.startsWith('dpad')
    ? `${t('controllers.tuning.dpad')} ${BUTTON_LABELS[button]}`
    : BUTTON_LABELS[button]

const targetOptions = computed(() => [
  ...GAMEPAD_BUTTONS.map((b) => ({ value: b as GamepadButton | 'off', label: label(b) })),
  { value: 'off' as const, label: t('controllers.tuning.off') },
])

function setTarget(from: GamepadButton, to: GamepadButton | 'off'): void {
  const remap = { ...tuning.value.remap }
  if (to === from) delete remap[from]
  else remap[from] = to
  save({ remap })
}

function swapAB(): void {
  const remap = { ...tuning.value.remap }
  const swapped = remap.a === 'b' && remap.b === 'a'
  if (swapped) {
    delete remap.a
    delete remap.b
  } else {
    remap.a = 'b'
    remap.b = 'a'
  }
  save({ remap })
}

const slotOptions = computed(() =>
  [0, 1, 2, 3].map((slot) => ({ value: slot, label: t('common.slot', { n: slot + 1 }) })),
)
function setPlayerSlot(player: number, slot: number): void {
  save({ playerOrder: withPlayerSlot(tuning.value.playerOrder, player, slot) })
}

function reset(): void {
  save({
    leftDeadzone: 0,
    rightDeadzone: 0,
    triggerDeadzone: 0,
    remap: {},
    playerOrder: [0, 1, 2, 3],
  })
}
</script>

<template>
  <UiCard
    :title="$t('controllers.tuning.title')"
    :description="$t('controllers.tuning.description')"
  >
    <template #actions>
      <UiButton size="sm" variant="ghost" :disabled="isDefaultTuning(tuning)" @click="reset">
        {{ $t('controllers.tuning.reset') }}
      </UiButton>
    </template>

    <div class="grid gap-4 md:grid-cols-3">
      <label v-for="zone in zones" :key="zone" class="flex flex-col gap-1.5">
        <span class="flex items-baseline justify-between gap-2 text-[13px] text-text">
          {{ $t(`controllers.tuning.${zone}`) }}
          <span class="text-text-muted tabular">{{ tuning[zone] }}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="60"
          step="1"
          class="w-full accent-accent"
          :value="tuning[zone]"
          :aria-label="$t(`controllers.tuning.${zone}`)"
          @change="save({ [zone]: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="min-h-4 text-[12px] text-text-faint tabular">
          <template v-if="now[zone] !== null">{{
            $t('controllers.tuning.now', { n: now[zone] })
          }}</template>
        </span>
      </label>
    </div>
    <p class="mt-2 text-[12px] text-text-muted">{{ $t('controllers.tuning.driftHint') }}</p>

    <div class="mt-5 flex items-center justify-between gap-3">
      <p class="text-[13px] font-medium text-text">{{ $t('controllers.tuning.buttons') }}</p>
      <UiButton size="sm" variant="ghost" @click="swapAB">
        {{ $t('controllers.tuning.swapAB') }}
      </UiButton>
    </div>
    <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4 xl:grid-cols-7">
      <div v-for="button in GAMEPAD_BUTTONS" :key="button" class="flex flex-col gap-1">
        <span class="text-[12px] text-text-muted">{{ label(button) }}</span>
        <UiSelect
          :key="`${button}-${tuning.remap[button] ?? button}`"
          :model-value="tuning.remap[button] ?? button"
          :options="targetOptions"
          :label="label(button)"
          @update:model-value="setTarget(button, $event)"
        />
      </div>
    </div>

    <p class="mt-5 text-[13px] font-medium text-text">{{ $t('controllers.tuning.order') }}</p>
    <p class="mt-0.5 text-[12px] text-text-muted">{{ $t('controllers.tuning.orderHint') }}</p>
    <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
      <div v-for="player in [0, 1, 2, 3]" :key="player" class="flex flex-col gap-1">
        <span class="text-[12px] text-text-muted">{{
          $t('controllers.tuning.player', { n: player + 1 })
        }}</span>
        <UiSelect
          :key="`${player}-${tuning.playerOrder.join()}`"
          :model-value="tuning.playerOrder[player] ?? player"
          :options="slotOptions"
          :label="$t('controllers.tuning.player', { n: player + 1 })"
          @update:model-value="setPlayerSlot(player, $event)"
        />
      </div>
    </div>
  </UiCard>
</template>
