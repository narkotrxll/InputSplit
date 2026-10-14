<script setup lang="ts">
import { Download, FolderOpen, RotateCcw } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FeatureName } from '@shared/domain'
import { LOCALE_NAMES, LOCALES, type LanguageSetting } from '@shared/locales'
import FeatureList from '../components/FeatureList.vue'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiKbd from '../components/ui/UiKbd.vue'
import UiSegmented from '../components/ui/UiSegmented.vue'
import UiSelect from '../components/ui/UiSelect.vue'
import UiSwitch from '../components/ui/UiSwitch.vue'
import { call } from '../api'
import { systemLocale } from '../i18n'
import { useBackendStore } from '../stores/backend'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const store = useSettingsStore()
const backend = useBackendStore()
const ui = useUiStore()
const s = computed(() => store.settings)

const theme = computed({
  get: () => s.value.theme,
  set: (value) => void store.update({ theme: value }),
})

const language = computed({
  get: () => s.value.language,
  set: (value: LanguageSetting) => void store.update({ language: value }),
})
const languageOptions = computed(() => [
  {
    value: 'system' as LanguageSetting,
    label: t('settings.languageSystem', { name: LOCALE_NAMES[systemLocale()] }),
  },
  ...LOCALES.map((locale) => ({ value: locale as LanguageSetting, label: LOCALE_NAMES[locale] })),
])

function setDefault(name: FeatureName, value: boolean): void {
  void store.update({ defaultFeatures: { ...s.value.defaultFeatures, [name]: value } })
}

async function exportDiagnostics(): Promise<void> {
  const result = await call('diagnostics:export')
  if (result.saved) ui.toast({ tone: 'success', title: t('settings.exported') })
}

function showOnboarding(): void {
  ui.onboardingOpen = true
}
</script>

<template>
  <div>
    <PageHeader :title="$t('settings.title')" :subtitle="$t('settings.subtitle')" />
    <div class="flex max-w-3xl flex-col gap-4">
      <UiCard :title="$t('settings.general')" :padded="false">
        <div class="divide-y divide-line">
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('settings.closeToTray') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('settings.closeToTrayHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.closeToTray"
              :label="$t('settings.closeToTray')"
              @update:model-value="store.update({ closeToTray: $event })"
            />
          </label>
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span class="text-[13.5px] text-text">{{ $t('settings.startMinimized') }}</span>
            <UiSwitch
              :model-value="s.startMinimized"
              :label="$t('settings.startMinimized')"
              @update:model-value="store.update({ startMinimized: $event })"
            />
          </label>
          <div class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span class="text-[13.5px] text-text">{{ $t('settings.theme') }}</span>
            <UiSegmented
              v-model="theme"
              :label="$t('settings.theme')"
              :options="[
                { value: 'dark', label: $t('settings.themeDark') },
                { value: 'light', label: $t('settings.themeLight') },
                { value: 'system', label: $t('settings.themeSystem') },
              ]"
            />
          </div>
          <div class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('settings.language') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('settings.languageHint')
              }}</span>
            </span>
            <div class="w-60 shrink-0">
              <UiSelect
                v-model="language"
                :label="$t('settings.language')"
                :options="languageOptions"
              />
            </div>
          </div>
        </div>
      </UiCard>

      <UiCard :title="$t('settings.defaults')" :description="$t('settings.defaultsHint')">
        <FeatureList :flags="s.defaultFeatures" @toggle="setDefault" />
        <div class="mt-4 flex flex-col divide-y divide-line rounded-lg border border-line">
          <label class="flex items-center justify-between gap-6 px-4 py-3">
            <span class="text-[13px] text-text">{{ $t('settings.moveWindowByDefault') }}</span>
            <UiSwitch
              :model-value="s.moveWindowByDefault"
              :label="$t('settings.moveWindowByDefault')"
              @update:model-value="store.update({ moveWindowByDefault: $event })"
            />
          </label>
          <label class="flex items-center justify-between gap-6 px-4 py-3">
            <span class="text-[13px] text-text">{{ $t('settings.restoreOnExit') }}</span>
            <UiSwitch
              :model-value="s.restoreOnExit"
              :label="$t('settings.restoreOnExit')"
              @update:model-value="store.update({ restoreOnExit: $event })"
            />
          </label>
        </div>
      </UiCard>

      <UiCard :title="$t('settings.safety')" :padded="false">
        <div class="divide-y divide-line">
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="flex items-center gap-2 text-[13.5px] text-text">
                {{ $t('settings.emergencyHotkey') }}
                <span class="flex gap-0.5"
                  ><UiKbd>Ctrl</UiKbd><UiKbd>Alt</UiKbd><UiKbd>Shift</UiKbd><UiKbd>Q</UiKbd></span
                >
              </span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('settings.emergencyHotkeyHint')
              }}</span>
              <span
                v-if="s.emergencyHotkeyEnabled && backend.state?.status === 'ready'"
                class="mt-1 block text-[12px]"
                :class="backend.state.emergencyHotkeyRegistered ? 'text-success' : 'text-warning'"
              >
                {{
                  backend.state.emergencyHotkeyRegistered
                    ? $t('settings.hotkeyRegistered')
                    : $t('settings.hotkeyNotRegistered')
                }}
              </span>
            </span>
            <UiSwitch
              :model-value="s.emergencyHotkeyEnabled"
              :label="$t('settings.emergencyHotkey')"
              @update:model-value="store.update({ emergencyHotkeyEnabled: $event })"
            />
          </label>
          <div class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span class="text-[13.5px] text-text">{{ $t('settings.showOnboarding') }}</span>
            <UiButton size="sm" :icon="RotateCcw" @click="showOnboarding">{{
              $t('common.show')
            }}</UiButton>
          </div>
        </div>
      </UiCard>

      <UiCard :title="$t('settings.diagnostics')" :padded="false">
        <div class="divide-y divide-line">
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('settings.verboseLogging') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('settings.verboseLoggingHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.verboseLogging"
              :label="$t('settings.verboseLogging')"
              @update:model-value="store.update({ verboseLogging: $event })"
            />
          </label>
          <div class="flex items-center gap-2 px-5 py-3.5">
            <UiButton :icon="FolderOpen" @click="call('diagnostics:openLogFolder')">{{
              $t('settings.openLogs')
            }}</UiButton>
            <UiButton :icon="Download" @click="exportDiagnostics">{{
              $t('settings.exportDiagnostics')
            }}</UiButton>
          </div>
        </div>
      </UiCard>
    </div>
  </div>
</template>
