<script setup lang="ts">
import { Bookmark, Gamepad2, Monitor, Play, Shuffle, Square, Tv } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../components/AppIcon.vue'
import BatteryIndicator from '../components/BatteryIndicator.vue'
import ControllerPickerDialog from '../components/ControllerPickerDialog.vue'
import DisplayPickerDialog from '../components/DisplayPickerDialog.vue'
import FeatureList from '../components/FeatureList.vue'
import GamePickerDialog from '../components/GamePickerDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import ProfileEditorDialog from '../components/ProfileEditorDialog.vue'
import SessionDiagnostics from '../components/SessionDiagnostics.vue'
import SetupTile from '../components/SetupTile.vue'
import StatusPill from '../components/StatusPill.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCallout from '../components/ui/UiCallout.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiTooltip from '../components/ui/UiTooltip.vue'
import { errorText } from '../i18n'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'
import { useUiStore } from '../stores/ui'
import { useWindowsStore } from '../stores/windows'

const { t } = useI18n()
const isolation = useIsolationStore()
const devices = useDevicesStore()
const windows = useWindowsStore()
const ui = useUiStore()

const gamePicker = ref(false)
const controllerPicker = ref(false)
const displayPicker = ref(false)
const profileEditor = ref(false)

const view = computed(() => isolation.view)
const sel = computed(() => isolation.selection)
const shownTarget = computed(() =>
  view.value.phase === 'idle' ? sel.value.target : (view.value.target ?? sel.value.target),
)
const targetGone = computed(
  () =>
    !isolation.live &&
    sel.value.target !== null &&
    windows.loadedOnce &&
    !windows.isOpen(sel.value.target.pid, sel.value.target.hwnd),
)
const editable = computed(() => !isolation.live && !isolation.busyPhase)

const controller = computed(() =>
  sel.value.controllerSlot === null
    ? null
    : devices.controllers.find((c) => c.slot === sel.value.controllerSlot),
)
const display = computed(() => devices.display(sel.value.displayId))

const statusDescription = computed(() => {
  const status = isolation.uiStatus
  if (status === 'isolating') {
    const phase = view.value.phase
    if (phase === 'checking') return t('status.description.isolatingChecking')
    if (phase === 'stopping') return t('status.description.isolatingStopping')
    if (phase === 'starting') return t('status.description.isolatingStarting')
    return t('status.description.isolatingBackend')
  }
  if (status === 'error' && view.value.phase !== 'failed')
    return t('status.description.backendError')
  return t(`status.description.${status}`)
})

const startDisabledReason = computed(() =>
  isolation.cannotStartReason
    ? t(`dashboard.reasonCannotStart.${isolation.cannotStartReason}`)
    : undefined,
)

const errorCodeShown = computed(() =>
  view.value.phase === 'failed' ? view.value.error?.code : isolation.actionError,
)

const featureDisabled = computed(() =>
  sel.value.controllerSlot === null ? { xinputSlotLock: t('dashboard.chooseController') } : {},
)

async function toggleIsolation(): Promise<void> {
  if (isolation.live) await isolation.stop()
  else await isolation.start()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault()
    if (isolation.live || isolation.cannotStartReason === null) void toggleIsolation()
  }
}

onMounted(() => {
  void windows.refresh()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div>
    <PageHeader :title="$t('dashboard.title')" :subtitle="$t('dashboard.subtitle')">
      <UiButton v-if="sel.target" variant="ghost" :icon="Bookmark" @click="profileEditor = true">
        {{ $t('dashboard.saveProfile') }}
      </UiButton>
    </PageHeader>

    <div class="flex flex-col gap-4">
      <Transition name="fade">
        <UiCallout
          v-if="view.phase === 'ended' && view.endedReason"
          :tone="view.error ? 'warning' : 'success'"
          dismissible
          @dismiss="isolation.dismiss()"
        >
          {{ $t(`dashboard.ended.${view.endedReason}`) }}
        </UiCallout>
      </Transition>
      <Transition name="fade">
        <UiCallout
          v-if="errorCodeShown"
          tone="danger"
          :title="$t('errors.title')"
          dismissible
          @dismiss="isolation.dismiss()"
        >
          {{ errorText(errorCodeShown, view.error?.message) }}
        </UiCallout>
      </Transition>

      <!-- Session -->
      <section class="rounded-2xl border border-line bg-surface p-5">
        <div class="mb-5 flex items-center justify-between gap-6">
          <div class="flex min-w-0 items-center gap-3">
            <StatusPill :status="isolation.uiStatus" size="lg" />
            <p class="truncate text-[13px] text-text-muted">{{ statusDescription }}</p>
          </div>
          <UiTooltip :text="isolation.live ? 'Ctrl+Enter' : (startDisabledReason ?? 'Ctrl+Enter')">
            <span>
              <UiButton
                v-if="isolation.live"
                variant="danger"
                size="lg"
                :icon="Square"
                :loading="view.phase === 'stopping'"
                :disabled="view.phase === 'starting'"
                @click="toggleIsolation"
              >
                {{ view.phase === 'stopping' ? $t('dashboard.stopping') : $t('dashboard.stop') }}
              </UiButton>
              <UiButton
                v-else
                variant="primary"
                size="lg"
                :icon="Play"
                :loading="isolation.busy || view.phase === 'checking'"
                :disabled="isolation.cannotStartReason !== null"
                @click="toggleIsolation"
              >
                {{ isolation.busy ? $t('dashboard.starting') : $t('dashboard.start') }}
              </UiButton>
            </span>
          </UiTooltip>
        </div>

        <div class="flex items-stretch gap-3">
          <SetupTile
            :label="$t('dashboard.game')"
            :title="shownTarget?.title ?? $t('dashboard.chooseGame')"
            :subtitle="
              shownTarget
                ? `${shownTarget.exeName} · ${$t('common.pid', { pid: shownTarget.pid })}`
                : $t('dashboard.chooseGameHint')
            "
            :empty="!shownTarget"
            :warn="targetGone"
            :disabled="!editable"
            @open="gamePicker = true"
          >
            <template #visual>
              <AppIcon
                v-if="shownTarget"
                :src="windows.iconFor(shownTarget.exePath)"
                :name="shownTarget.exeName"
                :size="40"
              />
              <span
                v-else
                class="flex size-10 items-center justify-center rounded-lg border border-dashed border-line-strong"
              >
                <Play class="size-4 text-text-faint" />
              </span>
            </template>
            <p v-if="targetGone" class="text-[12px] text-warning">{{ $t('dashboard.gameGone') }}</p>
          </SetupTile>

          <SetupTile
            :label="$t('dashboard.controller')"
            :title="
              sel.controllerSlot === null
                ? $t('dashboard.anyController')
                : $t('common.slot', { n: sel.controllerSlot + 1 })
            "
            :subtitle="
              sel.controllerSlot === null
                ? $t('dashboard.anyControllerHint')
                : controller?.connected
                  ? $t(`controllers.kind.${controller.kind}`)
                  : $t('controllers.notConnected')
            "
            :warn="sel.controllerSlot !== null && !controller?.connected"
            :disabled="!editable"
            @open="controllerPicker = true"
          >
            <template #visual>
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2"
              >
                <component
                  :is="sel.controllerSlot === null ? Shuffle : Gamepad2"
                  class="size-5 text-text-muted"
                />
              </span>
            </template>
            <BatteryIndicator
              v-if="controller?.connected && controller.wireless"
              :battery="controller.battery"
            />
          </SetupTile>

          <SetupTile
            :label="$t('dashboard.display')"
            :title="display?.name ?? $t('dashboard.chooseDisplay')"
            :subtitle="
              display
                ? `${display.bounds.width}×${display.bounds.height} · ${display.refreshRate} Hz`
                : $t('dashboard.chooseDisplayHint')
            "
            :disabled="!editable"
            @open="displayPicker = true"
          >
            <template #visual>
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2"
              >
                <component
                  :is="display?.isLikelyTv ? Tv : Monitor"
                  class="size-5 text-text-muted"
                />
              </span>
            </template>
            <p v-if="display" class="text-[12px] text-text-faint">
              {{ sel.moveWindow ? $t('dashboard.moveWindow') : $t('displays.keep') }}
            </p>
          </SetupTile>
        </div>

        <!-- Compatibility of the chosen game -->
        <div
          v-if="
            !isolation.live &&
            view.phase !== 'failed' &&
            isolation.check &&
            (isolation.check.blockers.length || isolation.check.warnings.length)
          "
          class="mt-4 flex flex-col gap-2"
        >
          <UiCallout
            v-for="b in isolation.check.blockers"
            :key="b.code"
            tone="danger"
            :title="$t('apps.cannotIsolate')"
          >
            {{ errorText(b.code, b.message) }}
          </UiCallout>
          <UiCallout v-for="w in isolation.check.warnings" :key="w.code" tone="warning">
            {{ $t(`warnings.${w.code}`) }}
          </UiCallout>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <UiCard :title="$t('dashboard.protections')" :description="$t('dashboard.protectionsHint')">
          <FeatureList v-if="isolation.live" :reports="view.features" />
          <FeatureList
            v-else
            :flags="sel.features"
            :disabled="featureDisabled"
            @toggle="isolation.setFeature"
          />
          <div v-if="isolation.live && view.limitations.length" class="mt-4 flex flex-col gap-2">
            <p class="text-[11.5px] font-medium tracking-wide text-text-faint uppercase">
              {{ $t('dashboard.limitations') }}
            </p>
            <UiCallout v-for="l in view.limitations" :key="l" tone="warning">{{
              $t(`limitations.${l}`)
            }}</UiCallout>
          </div>
          <div v-if="isolation.live && view.warnings.length" class="mt-4 flex flex-col gap-2">
            <p class="text-[11.5px] font-medium tracking-wide text-text-faint uppercase">
              {{ $t('dashboard.warnings') }}
            </p>
            <UiCallout v-for="w in view.warnings" :key="w.code" tone="info">{{
              $t(`warnings.${w.code}`)
            }}</UiCallout>
          </div>
        </UiCard>

        <UiCard :title="$t('dashboard.liveDiagnostics')">
          <template #actions>
            <UiButton size="sm" variant="ghost" @click="ui.diagnosticsOpen = true">{{
              $t('dashboard.openDiagnostics')
            }}</UiButton>
          </template>
          <SessionDiagnostics :view="view" />
        </UiCard>
      </div>
    </div>

    <GamePickerDialog v-model:open="gamePicker" />
    <ControllerPickerDialog v-model:open="controllerPicker" />
    <DisplayPickerDialog v-model:open="displayPicker" />
    <ProfileEditorDialog v-model:open="profileEditor" :profile="null" from-selection />
  </div>
</template>
