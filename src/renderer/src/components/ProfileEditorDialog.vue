<script setup lang="ts">
import { AppWindow, FolderOpen } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_FEATURES } from '@shared/defaults'
import type { FeatureFlags, FeatureName, Profile, ProfileInput } from '@shared/domain'
import { call, errorCode } from '../api'
import { errorText } from '../i18n'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'
import { useProfilesStore } from '../stores/profiles'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import FeatureList from './FeatureList.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiSelect from './ui/UiSelect.vue'
import UiSwitch from './ui/UiSwitch.vue'

const props = defineProps<{ profile: Profile | null; fromSelection?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [profile: Profile] }>()

const { t } = useI18n()
const devices = useDevicesStore()
const isolation = useIsolationStore()
const profiles = useProfilesStore()
const settings = useSettingsStore()
const ui = useUiStore()

const ANY = 'any'
const CURRENT = 'current'

const name = ref('')
const exeName = ref('')
const exePath = ref<string | null>(null)
const controller = ref<string>(ANY)
const display = ref<string>(CURRENT)
const moveWindow = ref(true)
const restoreOnExit = ref(true)
const autoStart = ref(false)
const features = ref<FeatureFlags>({ ...DEFAULT_FEATURES })
const saving = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = null
  const p = props.profile
  const s = settings.settings
  if (p) {
    name.value = p.name
    exeName.value = p.exeName
    exePath.value = p.exePath
    controller.value = p.controllerSlot === null ? ANY : String(p.controllerSlot)
    display.value = p.displayId ?? CURRENT
    moveWindow.value = p.moveWindow
    restoreOnExit.value = p.restoreOnExit
    autoStart.value = p.autoStart
    features.value = { ...p.features }
  } else {
    const sel = isolation.selection
    const target = props.fromSelection ? sel.target : null
    name.value = target ? target.title.split(' — ')[0]!.slice(0, 80) : ''
    exeName.value = target?.exeName ?? ''
    exePath.value = target?.exePath ?? null
    controller.value = sel.controllerSlot === null ? ANY : String(sel.controllerSlot)
    display.value = sel.displayId ?? CURRENT
    moveWindow.value = props.fromSelection ? sel.moveWindow : s.moveWindowByDefault
    restoreOnExit.value = props.fromSelection ? sel.restoreOnExit : s.restoreOnExit
    autoStart.value = false
    features.value = { ...(props.fromSelection ? sel.features : s.defaultFeatures) }
  }
})

const controllerOptions = computed(() => [
  { value: ANY, label: t('profiles.summary.anyController') },
  ...[0, 1, 2, 3].map((slot) => ({
    value: String(slot),
    label: t('common.slot', { n: slot + 1 }),
    hint:
      devices.isConnected(slot) && devices.controllers.length > 0
        ? t('controllers.connected')
        : undefined,
  })),
])
const displayOptions = computed(() => [
  { value: CURRENT, label: t('profiles.summary.currentScreen') },
  ...devices.displays.map((d) => ({
    value: d.id,
    label: d.name,
    hint: `${d.bounds.width}×${d.bounds.height}`,
  })),
])

const valid = computed(() => name.value.trim().length > 0 && /\.exe$/i.test(exeName.value))

function useSelectedGame(): void {
  const target = isolation.selection.target
  if (!target) return
  exeName.value = target.exeName
  exePath.value = target.exePath
  if (!name.value) name.value = target.title.slice(0, 80)
}

async function browse(): Promise<void> {
  try {
    const picked = await call('profiles:pickExecutable')
    if (!picked) return
    exeName.value = picked.exeName
    exePath.value = picked.exePath
    if (!name.value) name.value = picked.exeName.replace(/\.exe$/i, '')
  } catch (e) {
    error.value = errorText(errorCode(e))
  }
}

function toggle(feature: FeatureName, value: boolean): void {
  features.value = { ...features.value, [feature]: value }
}

async function save(): Promise<void> {
  if (!valid.value) return
  saving.value = true
  error.value = null
  const selectedDisplay = devices.display(display.value === CURRENT ? null : display.value)
  const input: ProfileInput = {
    id: props.profile?.id ?? null,
    name: name.value.trim(),
    exeName: exeName.value.trim(),
    exePath: exePath.value,
    controllerSlot: controller.value === ANY ? null : Number(controller.value),
    displayId: display.value === CURRENT ? null : display.value,
    displayName: selectedDisplay?.name ?? null,
    moveWindow: moveWindow.value,
    restoreOnExit: restoreOnExit.value,
    autoStart: autoStart.value,
    features: features.value,
  }
  try {
    const saved = await profiles.save(input)
    ui.toast({ tone: 'success', title: saved.name, body: t('common.save') + ' ✓' })
    emit('saved', saved)
    open.value = false
  } catch (e) {
    error.value = errorText(errorCode(e), (e as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="profile ? $t('profiles.editor.editTitle') : $t('profiles.editor.createTitle')"
    width="lg"
  >
    <form id="profile-form" class="flex flex-col gap-5" @submit.prevent="save">
      <label class="flex flex-col gap-1.5">
        <span class="text-[12.5px] font-medium text-text-muted">{{
          $t('profiles.editor.name')
        }}</span>
        <input
          v-model="name"
          maxlength="80"
          :placeholder="$t('profiles.editor.namePlaceholder')"
          class="h-9 rounded-lg border border-line-strong bg-surface-2 px-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-accent/60 focus:outline-none"
        />
      </label>

      <div class="flex flex-col gap-1.5">
        <span class="text-[12.5px] font-medium text-text-muted">{{
          $t('profiles.editor.executable')
        }}</span>
        <div class="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2">
          <div class="min-w-0 flex-1">
            <p class="truncate font-mono text-[13px] text-text">{{ exeName || '—' }}</p>
            <p v-if="exePath" class="selectable truncate text-[11.5px] text-text-faint">
              {{ exePath }}
            </p>
          </div>
          <UiButton
            v-if="isolation.selection.target"
            size="sm"
            variant="ghost"
            :icon="AppWindow"
            @click="useSelectedGame"
          >
            {{ $t('profiles.editor.useSelected') }}
          </UiButton>
          <UiButton size="sm" :icon="FolderOpen" @click="browse">{{
            $t('profiles.editor.browse')
          }}</UiButton>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-[12.5px] font-medium text-text-muted">{{
            $t('profiles.editor.controller')
          }}</span>
          <UiSelect
            v-model="controller"
            :options="controllerOptions"
            :label="$t('profiles.editor.controller')"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[12.5px] font-medium text-text-muted">{{
            $t('profiles.editor.display')
          }}</span>
          <UiSelect
            v-model="display"
            :options="displayOptions"
            :label="$t('profiles.editor.display')"
          />
        </label>
      </div>

      <div class="flex flex-col divide-y divide-line rounded-lg border border-line">
        <label
          class="flex items-center justify-between gap-4 px-4 py-3"
          :class="display === CURRENT ? 'opacity-50' : ''"
        >
          <span class="text-[13px] text-text">{{ $t('profiles.editor.moveWindow') }}</span>
          <UiSwitch
            v-model="moveWindow"
            :disabled="display === CURRENT"
            :label="$t('profiles.editor.moveWindow')"
          />
        </label>
        <label class="flex items-center justify-between gap-4 px-4 py-3">
          <span class="text-[13px] text-text">{{ $t('profiles.editor.restoreOnExit') }}</span>
          <UiSwitch v-model="restoreOnExit" :label="$t('profiles.editor.restoreOnExit')" />
        </label>
        <label class="flex items-center justify-between gap-4 px-4 py-3">
          <span>
            <span class="block text-[13px] text-text">{{ $t('automation.autoStart') }}</span>
            <span class="block text-[12px] text-text-muted">{{
              $t('automation.autoStartHint')
            }}</span>
          </span>
          <UiSwitch v-model="autoStart" :label="$t('automation.autoStart')" />
        </label>
      </div>

      <div>
        <p class="mb-3 text-[12.5px] font-medium text-text-muted">
          {{ $t('profiles.editor.protections') }}
        </p>
        <FeatureList :flags="features" @toggle="toggle" />
      </div>

      <p v-if="error" class="text-[12.5px] text-danger" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="open = false">{{ $t('common.cancel') }}</UiButton>
      <UiButton
        variant="primary"
        type="submit"
        form="profile-form"
        :disabled="!valid"
        :loading="saving"
      >
        {{ $t('common.save') }}
      </UiButton>
    </template>
  </UiDialog>
</template>
