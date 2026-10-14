<script setup lang="ts">
import { CircleCheck, Gamepad2, LoaderCircle } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'

/** Onboarding: press a button on the controller the player will use. */
const devices = useDevicesStore()
const isolation = useIsolationStore()
const confirmedSlot = ref<number | null>(null)

const STICK_DEADZONE = 12000
const TRIGGER_THRESHOLD = 60

async function test(slot: number): Promise<void> {
  confirmedSlot.value = null
  await devices.startTest(slot).catch(() => {})
}

function firstSlot(): number | null {
  const preferred = isolation.selection.controllerSlot
  if (preferred !== null && devices.isConnected(preferred)) return preferred
  return devices.connected[0]?.slot ?? null
}

onMounted(() => {
  const slot = firstSlot()
  if (slot !== null) void test(slot)
})
onBeforeUnmount(() => void devices.stopTest().catch(() => {}))

// A controller connected while this step is open is tested right away.
watch(
  () => devices.connected.length,
  (count, before) => {
    if (count > 0 && (before ?? 0) === 0 && devices.testSlot === null) {
      const slot = firstSlot()
      if (slot !== null) void test(slot)
    }
  },
)

watch(
  () => devices.testState,
  (state) => {
    if (!state?.connected || confirmedSlot.value === state.slot) return
    const pressed =
      (state.buttons ?? 0) !== 0 ||
      state.guide === true ||
      (state.leftTrigger ?? 0) > TRIGGER_THRESHOLD ||
      (state.rightTrigger ?? 0) > TRIGGER_THRESHOLD ||
      [state.thumbLX, state.thumbLY, state.thumbRX, state.thumbRY].some(
        (v) => Math.abs(v ?? 0) > STICK_DEADZONE,
      )
    if (pressed) {
      confirmedSlot.value = state.slot
      void isolation.selectController(state.slot)
    }
  },
)

const testing = computed(() => devices.testSlot)
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-[13.5px] leading-relaxed text-text-muted">
      {{ $t('wizard.controllerBody') }}
    </p>
    <p
      v-if="devices.connected.length === 0"
      class="rounded-lg border border-line bg-bg-subtle px-4 py-3 text-[13px] text-text-muted"
    >
      {{ $t('wizard.noController') }}
    </p>
    <template v-else>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="c in devices.connected"
          :key="c.slot"
          type="button"
          class="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors"
          :class="
            testing === c.slot
              ? 'border-accent/40 bg-accent-soft text-text'
              : 'border-line text-text-muted hover:bg-surface-2'
          "
          :aria-pressed="testing === c.slot"
          @click="test(c.slot)"
        >
          <Gamepad2 class="size-4" aria-hidden="true" />
          {{ $t('common.slot', { n: c.slot + 1 }) }}
          <span class="text-text-faint">· {{ $t(`controllers.kind.${c.kind}`) }}</span>
        </button>
      </div>
      <div
        class="flex items-center gap-3 rounded-lg border px-4 py-3 text-[13.5px]"
        :class="
          confirmedSlot !== null
            ? 'border-success/30 bg-success-soft text-text'
            : 'border-line bg-bg-subtle text-text-muted'
        "
        aria-live="polite"
      >
        <CircleCheck
          v-if="confirmedSlot !== null"
          class="size-5 shrink-0 text-success"
          aria-hidden="true"
        />
        <LoaderCircle v-else class="size-5 shrink-0 animate-spin" aria-hidden="true" />
        {{ confirmedSlot !== null ? $t('wizard.works') : $t('wizard.waiting') }}
      </div>
    </template>
  </div>
</template>
