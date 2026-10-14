<script setup lang="ts">
import {
  ArrowRight,
  Check,
  Gamepad2,
  Keyboard,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import LogoMark from './LogoMark.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiKbd from './ui/UiKbd.vue'

const ui = useUiStore()
const settings = useSettingsStore()
const step = ref(0)
const acknowledged = ref(false)
const total = 3

const open = computed({
  get: () => ui.onboardingOpen,
  set: (value) => {
    // The guide can be closed only after the risks were acknowledged once.
    if (!value && !settings.settings.riskAcknowledgedAt) return
    ui.onboardingOpen = value
  },
})

watch(
  () => ui.onboardingOpen,
  (isOpen) => {
    if (isOpen) {
      step.value = 0
      acknowledged.value = settings.settings.riskAcknowledgedAt !== null
    }
  },
)

async function finish(): Promise<void> {
  await settings.update({
    onboardingCompleted: true,
    riskAcknowledgedAt: settings.settings.riskAcknowledgedAt ?? new Date().toISOString(),
  })
  ui.onboardingOpen = false
}

const welcomePoints = [
  { icon: MonitorPlay, key: 'point1' },
  { icon: Gamepad2, key: 'point2' },
  { icon: Keyboard, key: 'point3' },
]
const riskPoints = ['point1', 'point2', 'point3', 'point4'] as const
const tips = ['tip1', 'tip2', 'tip3'] as const
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="
      [$t('onboarding.welcome.title'), $t('onboarding.risks.title'), $t('onboarding.tips.title')][
        step
      ]!
    "
    :dismissible="settings.settings.riskAcknowledgedAt !== null"
    width="md"
  >
    <Transition name="page" mode="out-in">
      <div v-if="step === 0" key="welcome" class="flex flex-col gap-5">
        <div class="flex items-center gap-4 rounded-xl border border-line bg-bg-subtle p-4">
          <LogoMark :size="44" />
          <p class="text-[13.5px] leading-relaxed text-text-muted">
            {{ $t('onboarding.welcome.body') }}
          </p>
        </div>
        <ol class="flex flex-col gap-3">
          <li v-for="(point, i) in welcomePoints" :key="point.key" class="flex items-center gap-3">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[12.5px] font-semibold text-accent"
            >
              {{ i + 1 }}
            </span>
            <component
              :is="point.icon"
              class="size-4 shrink-0 text-text-faint"
              aria-hidden="true"
            />
            <span class="text-[13.5px] text-text">{{ $t(`onboarding.welcome.${point.key}`) }}</span>
          </li>
        </ol>
      </div>

      <div v-else-if="step === 1" key="risks" class="flex flex-col gap-4">
        <p class="text-[13.5px] leading-relaxed text-text-muted">
          {{ $t('onboarding.risks.body') }}
        </p>
        <ul class="flex flex-col gap-2.5">
          <li v-for="point in riskPoints" :key="point" class="flex gap-2.5 text-[13.5px] text-text">
            <ShieldCheck class="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
            <span v-if="point === 'point4'" class="flex flex-wrap items-center gap-1">
              {{ $t('onboarding.risks.point4').split('Ctrl+Alt+Shift+Q')[0] }}
              <UiKbd>Ctrl</UiKbd><UiKbd>Alt</UiKbd><UiKbd>Shift</UiKbd><UiKbd>Q</UiKbd>
              {{ $t('onboarding.risks.point4').split('Ctrl+Alt+Shift+Q')[1] }}
            </span>
            <span v-else>{{ $t(`onboarding.risks.${point}`) }}</span>
          </li>
        </ul>
        <label
          class="mt-1 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
          :class="
            acknowledged
              ? 'border-accent/40 bg-accent-soft'
              : 'border-line-strong bg-bg-subtle hover:bg-surface-2'
          "
        >
          <input v-model="acknowledged" type="checkbox" class="peer sr-only" />
          <span
            class="flex size-4.5 items-center justify-center rounded border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
            :class="acknowledged ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'"
          >
            <Check v-if="acknowledged" class="size-3" />
          </span>
          <span class="text-[13.5px] font-medium text-text">{{
            $t('onboarding.risks.acknowledge')
          }}</span>
        </label>
      </div>

      <div v-else key="tips" class="flex flex-col gap-3">
        <div
          v-for="tip in tips"
          :key="tip"
          class="flex gap-3 rounded-lg border border-line bg-bg-subtle px-4 py-3"
        >
          <Sparkles class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span class="text-[13.5px] text-text">{{ $t(`onboarding.tips.${tip}`) }}</span>
        </div>
      </div>
    </Transition>

    <template #footer>
      <div class="mr-auto flex items-center gap-2">
        <span
          v-for="i in total"
          :key="i"
          class="h-1.5 rounded-full transition-all"
          :class="i - 1 === step ? 'w-5 bg-accent' : 'w-1.5 bg-surface-3'"
        />
        <span class="sr-only">{{ $t('onboarding.step', { n: step + 1, total }) }}</span>
      </div>
      <UiButton v-if="step > 0" variant="ghost" @click="step--">{{ $t('common.back') }}</UiButton>
      <UiButton
        v-if="step < total - 1"
        variant="primary"
        :icon="ArrowRight"
        :disabled="step === 1 && !acknowledged"
        @click="step++"
      >
        {{ $t('common.next') }}
      </UiButton>
      <UiButton v-else variant="primary" :icon="Check" @click="finish">{{
        $t('onboarding.tips.finish')
      }}</UiButton>
    </template>
  </UiDialog>
</template>
