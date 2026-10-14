<script setup lang="ts">
import {
  ArchiveRestore,
  Bug,
  Download,
  ExternalLink,
  FileDown,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ShieldOff,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FeatureName } from '@shared/domain'
import { LOCALE_NAMES, LOCALES, type LanguageSetting } from '@shared/locales'
import FeatureList from '../components/FeatureList.vue'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCard from '../components/ui/UiCard.vue'
import UiDialog from '../components/ui/UiDialog.vue'
import UiKbd from '../components/ui/UiKbd.vue'
import UiSegmented from '../components/ui/UiSegmented.vue'
import UiSelect from '../components/ui/UiSelect.vue'
import UiSwitch from '../components/ui/UiSwitch.vue'
import type { Backup } from '@shared/domain'
import { call, errorCode } from '../api'
import { formatRelativeDate } from '../lib/format'
import { systemLocale } from '../i18n'
import { errorText } from '../i18n'
import { useBackendStore } from '../stores/backend'
import { useUpdatesStore } from '../stores/updates'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const { t, locale } = useI18n()
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

/** Turning anti-cheat protection off always goes through the risk warning. */
const antiCheatDialog = ref(false)
function setAntiCheatProtection(on: boolean): void {
  if (on) void store.update({ antiCheatProtection: true })
  else antiCheatDialog.value = true
}
function turnOffAntiCheatProtection(): void {
  antiCheatDialog.value = false
  void store.update({ antiCheatProtection: false })
}

// Backup: export everything to a file, or load one (with a confirmation step).
const backup = ref<Backup | null>(null)
const backupOpen = ref(false)
const backupSettings = ref(false)
const importing = ref(false)

async function exportBackup(): Promise<void> {
  try {
    const result = await call('backup:export')
    if (result.saved) ui.toast({ tone: 'success', title: t('backup.exported') })
  } catch (e) {
    ui.toast({ tone: 'danger', title: t('errors.title'), body: errorText(errorCode(e)) })
  }
}

async function openBackup(): Promise<void> {
  try {
    const loaded = await call('backup:open')
    if (!loaded) return
    backup.value = loaded
    backupSettings.value = false
    backupOpen.value = true
  } catch (e) {
    ui.toast({ tone: 'danger', title: t('errors.title'), body: errorText(errorCode(e)) })
  }
}

async function importBackup(): Promise<void> {
  if (!backup.value) return
  importing.value = true
  try {
    const result = await call('backup:import', {
      backup: backup.value,
      settings: backupSettings.value,
    })
    backupOpen.value = false
    const body = [
      t('backup.importedBody', { added: result.added, updated: result.updated }),
      result.skipped > 0 ? t('backup.skipped', { skipped: result.skipped }) : '',
    ]
      .filter(Boolean)
      .join(' ')
    ui.toast({ tone: 'success', title: t('backup.imported'), body })
  } catch (e) {
    ui.toast({ tone: 'danger', title: t('errors.title'), body: errorText(errorCode(e)) })
  } finally {
    importing.value = false
  }
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
              <span class="block text-[13.5px] text-text">{{
                $t('settings.antiCheatProtection')
              }}</span>
              <span class="block text-[12.5px] text-text-muted">{{
                $t('settings.antiCheatProtectionHint')
              }}</span>
              <span v-if="!s.antiCheatProtection" class="mt-1 block text-[12px] text-danger">{{
                $t('settings.antiCheatOff')
              }}</span>
            </span>
            <UiSwitch
              :model-value="s.antiCheatProtection"
              :label="$t('settings.antiCheatProtection')"
              @update:model-value="setAntiCheatProtection"
            />
          </label>
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
              <span v-else-if="u.status === 'ready'" class="font-medium text-accent">
                {{ $t('updates.ready', { version: u.latestVersion ?? '' }) }}
                <span class="mt-0.5 block text-[12px] font-normal text-text-muted">{{
                  $t('updates.readyHint')
                }}</span>
              </span>
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
                v-if="
                  u.releaseUrl &&
                  (u.status === 'available' || u.status === 'ready' || u.status === 'upToDate')
                "
                size="sm"
                variant="ghost"
                :icon="ExternalLink"
                @click="updates.openRelease()"
                >{{ $t('updates.whatsNew') }}</UiButton
              >
              <UiButton
                v-if="u.status === 'ready' && u.canInstall"
                size="sm"
                variant="primary"
                :icon="RotateCw"
                @click="updates.install()"
                >{{ $t('updates.restart') }}</UiButton
              >
              <UiButton
                v-else-if="u.status === 'available' && u.canInstall"
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

      <UiCard :title="$t('backup.title')" :padded="false">
        <div class="flex items-center justify-between gap-6 px-5 py-3.5">
          <span class="text-[12.5px] text-text-muted">{{ $t('backup.hint') }}</span>
          <span class="flex shrink-0 gap-2">
            <UiButton :icon="FileDown" @click="exportBackup">{{ $t('backup.export') }}</UiButton>
            <UiButton :icon="ArchiveRestore" @click="openBackup">{{
              $t('backup.import')
            }}</UiButton>
          </span>
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
          <div class="flex flex-wrap items-center gap-2 px-5 py-3.5">
            <UiButton :icon="FolderOpen" @click="call('diagnostics:openLogFolder')">{{
              $t('settings.openLogs')
            }}</UiButton>
            <UiButton :icon="Download" @click="exportDiagnostics">{{
              $t('settings.exportDiagnostics')
            }}</UiButton>
            <UiButton :icon="Bug" @click="ui.reportOpen = true">{{ $t('report.button') }}</UiButton>
          </div>
        </div>
      </UiCard>
    </div>

    <UiDialog
      v-model:open="antiCheatDialog"
      :title="$t('settings.antiCheatDialogTitle')"
      width="sm"
    >
      <p class="text-[13px] text-text">{{ $t('settings.antiCheatDialogBody') }}</p>
      <ul class="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-text">
        <li class="font-medium text-danger">{{ $t('settings.antiCheatDialogBan') }}</li>
        <li>{{ $t('settings.antiCheatDialogBlock') }}</li>
        <li>{{ $t('settings.antiCheatDialogAsk') }}</li>
      </ul>
      <template #footer>
        <UiButton @click="antiCheatDialog = false">{{ $t('common.cancel') }}</UiButton>
        <UiButton variant="danger" :icon="ShieldOff" @click="turnOffAntiCheatProtection">{{
          $t('settings.antiCheatDialogConfirm')
        }}</UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model:open="backupOpen" :title="$t('backup.importTitle')" width="md">
      <div v-if="backup" class="flex flex-col gap-4">
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt class="text-text-faint">{{ $t('backup.profiles') }}</dt>
          <dd class="text-text">{{ backup.profiles.length }}</dd>
          <dt class="text-text-faint">{{ $t('backup.saved') }}</dt>
          <dd class="text-text">
            {{ formatRelativeDate(backup.exportedAt, Date.now(), locale) }}
          </dd>
        </dl>
        <p class="text-[12.5px] text-text-muted">{{ $t('backup.replaceHint') }}</p>
        <label
          v-if="backup.settings"
          class="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3"
        >
          <span>
            <span class="block text-[13px] text-text">{{ $t('backup.includeSettings') }}</span>
            <span class="block text-[12px] text-text-muted">{{
              $t('backup.includeSettingsHint')
            }}</span>
          </span>
          <UiSwitch v-model="backupSettings" :label="$t('backup.includeSettings')" />
        </label>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="backupOpen = false">{{ $t('common.cancel') }}</UiButton>
        <UiButton
          variant="primary"
          :icon="ArchiveRestore"
          :loading="importing"
          @click="importBackup"
          >{{ $t('backup.importButton') }}</UiButton
        >
      </template>
    </UiDialog>
  </div>
</template>
