<script setup lang="ts">
import { Download, ExternalLink, FolderOpen, RefreshCw, RotateCcw } from '@lucide/vue'
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
import { errorText } from '../i18n'
import { useBackendStore } from '../stores/backend'
import { useUpdatesStore } from '../stores/updates'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const store = useSettingsStore()
const backend = useBackendStore()
const ui = useUiStore()
const updates = useUpdatesStore()
const s = computed(() => store.settings)
const u = computed(() => updates.state)

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
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('notify.launchAtLogin') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('notify.launchAtLoginHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.launchAtLogin"
              :label="$t('notify.launchAtLogin')"
              @update:model-value="store.update({ launchAtLogin: $event })"
            />
          </label>
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('notify.notifications') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('notify.notificationsHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.notifications"
              :label="$t('notify.notifications')"
              @update:model-value="store.update({ notifications: $event })"
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

      <UiCard :title="$t('gamepadHotkey.title')" :padded="false">
        <div class="divide-y divide-line">
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="flex flex-wrap items-center gap-2 text-[13.5px] text-text">
                {{ $t('gamepadHotkey.shortcut') }}
                <span class="flex gap-0.5"
                  ><UiKbd>LB</UiKbd><UiKbd>RB</UiKbd><UiKbd>View</UiKbd></span
                >
              </span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('gamepadHotkey.shortcutHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.gamepadHotkeyEnabled"
              :label="$t('gamepadHotkey.shortcut')"
              @update:model-value="store.update({ gamepadHotkeyEnabled: $event })"
            />
          </label>
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('gamepadHotkey.rumble') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('gamepadHotkey.rumbleHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.rumbleFeedback"
              :label="$t('gamepadHotkey.rumble')"
              @update:model-value="store.update({ rumbleFeedback: $event })"
            />
          </label>
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('seats.twoPlayers') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('seats.twoPlayersHint')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.twoPlayers"
              :label="$t('seats.twoPlayers')"
              @update:model-value="store.update({ twoPlayers: $event })"
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

      <UiCard :title="$t('updates.title')" :padded="false">
        <div class="divide-y divide-line">
          <label class="flex items-center justify-between gap-6 px-5 py-3.5">
            <span>
              <span class="block text-[13.5px] text-text">{{ $t('updates.auto') }}</span>
              <span class="block text-[12.5px] text-text-muted">{{ $t('updates.autoHint') }}</span>
            </span>
            <UiSwitch
              :model-value="s.checkForUpdates"
              :label="$t('updates.auto')"
              @update:model-value="store.update({ checkForUpdates: $event })"
            />
          </label>
          <div
            v-if="u"
            class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5"
          >
            <span class="min-w-0 text-[13px]" aria-live="polite">
              <span v-if="u.status === 'available'" class="font-medium text-accent">{{
                $t('updates.available', { version: u.latestVersion ?? '' })
              }}</span>
              <span v-else-if="u.status === 'downloading'" class="text-text">{{
                $t('updates.downloading', { percent: u.progress ?? 0 })
              }}</span>
              <span v-else-if="u.status === 'installing'" class="text-text">{{
                $t('updates.installing')
              }}</span>
              <span v-else-if="u.status === 'upToDate'" class="text-success">{{
                $t('updates.upToDate', { version: u.currentVersion })
              }}</span>
              <span v-else-if="u.status === 'error'" class="text-warning">{{
                $t('updates.error')
              }}</span>
              <span v-else class="text-text-muted">{{
                $t('about.version', { version: u.currentVersion })
              }}</span>
              <span v-if="updates.error" class="mt-1 block text-[12px] text-danger">{{
                errorText(updates.error)
              }}</span>
              <span
                v-if="u.status === 'available' && !u.canInstall"
                class="mt-1 block text-[12px] text-text-faint"
                >{{ $t('updates.devBuild') }}</span
              >
            </span>
            <span class="flex flex-wrap gap-2">
              <UiButton
                v-if="u.releaseUrl && (u.status === 'available' || u.status === 'upToDate')"
                size="sm"
                variant="ghost"
                :icon="ExternalLink"
                @click="updates.openRelease()"
                >{{ $t('updates.whatsNew') }}</UiButton
              >
              <UiButton
                v-if="u.status === 'available' && u.canInstall"
                size="sm"
                variant="primary"
                :icon="Download"
                @click="updates.install()"
                >{{ $t('updates.install') }}</UiButton
              >
              <UiButton
                v-else
                size="sm"
                :icon="RefreshCw"
                :loading="u.status === 'checking'"
                :disabled="u.status === 'downloading' || u.status === 'installing'"
                @click="updates.check()"
                >{{
                  u.status === 'checking' ? $t('updates.checking') : $t('updates.check')
                }}</UiButton
              >
            </span>
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
