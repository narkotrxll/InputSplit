<script setup lang="ts">
import {
  Bookmark,
  Gamepad2,
  Monitor,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  Zap,
} from '@lucide/vue'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { Profile } from '@shared/domain'
import AppIcon from '../components/AppIcon.vue'
import PageHeader from '../components/PageHeader.vue'
import ProfileEditorDialog from '../components/ProfileEditorDialog.vue'
import UiBadge from '../components/ui/UiBadge.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiDialog from '../components/ui/UiDialog.vue'
import UiEmptyState from '../components/ui/UiEmptyState.vue'
import UiIconButton from '../components/ui/UiIconButton.vue'
import UiTooltip from '../components/ui/UiTooltip.vue'
import { FEATURE_META } from '../lib/features'
import { formatRelativeDate } from '../lib/format'
import { useAutomationStore } from '../stores/automation'
import { useIsolationStore } from '../stores/isolation'
import { useProfilesStore } from '../stores/profiles'
import { useUiStore } from '../stores/ui'
import { useWindowsStore } from '../stores/windows'

const { t, locale } = useI18n()
const router = useRouter()
const profiles = useProfilesStore()
const isolation = useIsolationStore()
const automation = useAutomationStore()
const windows = useWindowsStore()
const ui = useUiStore()

const editorOpen = ref(false)
const editing = ref<Profile | null>(null)
const deleting = ref<Profile | null>(null)
const deleteOpen = ref(false)
const applying = ref<string | null>(null)

function edit(profile: Profile | null): void {
  editing.value = profile
  editorOpen.value = true
}

function askDelete(profile: Profile): void {
  deleting.value = profile
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  if (deleting.value) await profiles.remove(deleting.value.id)
  deleteOpen.value = false
}

async function apply(profile: Profile): Promise<void> {
  applying.value = profile.id
  try {
    await windows.refresh()
    // The shown player is playing: set the profile up for the free player instead.
    if (isolation.live && isolation.freeSeat !== null) isolation.setActiveSeat(isolation.freeSeat)
    const found = await isolation.applyProfile(profile, windows.windows)
    if (found) {
      ui.toast({ tone: 'success', title: t('profiles.applied'), body: profile.name })
      await router.push('/')
    } else {
      ui.toast({
        tone: 'warning',
        title: profile.name,
        body: t('profiles.notRunning', { exe: profile.exeName }),
      })
    }
  } finally {
    applying.value = null
  }
}

/** "Play": start the game if needed and isolate it; progress shows on the dashboard. */
async function play(profile: Profile): Promise<void> {
  await router.push('/')
  await automation.play(profile.id, true)
}

onMounted(() => void profiles.load())
</script>

<template>
  <div>
    <PageHeader :title="$t('profiles.title')" :subtitle="$t('profiles.subtitle')">
      <UiButton variant="primary" :icon="Plus" @click="edit(null)">{{
        $t('profiles.new')
      }}</UiButton>
    </PageHeader>

    <div v-if="profiles.profiles.length" class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <article
        v-for="profile in profiles.profiles"
        :key="profile.id"
        class="group flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong"
      >
        <div class="flex items-start gap-3">
          <AppIcon :src="windows.iconFor(profile.exePath)" :name="profile.exeName" :size="40" />
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-[14.5px] font-semibold text-text">{{ profile.name }}</h2>
            <p class="truncate font-mono text-[12px] text-text-faint">{{ profile.exeName }}</p>
          </div>
          <div class="flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
            <UiIconButton
              :icon="Pencil"
              :label="$t('common.edit')"
              size="sm"
              @click="edit(profile)"
            />
            <UiIconButton
              :icon="Trash2"
              :label="$t('common.delete')"
              size="sm"
              @click="askDelete(profile)"
            />
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 text-[12px]">
          <UiBadge :icon="Gamepad2">
            {{
              profile.controllerSlot === null
                ? $t('profiles.summary.anyController')
                : $t('common.slot', { n: profile.controllerSlot + 1 })
            }}
          </UiBadge>
          <UiBadge :icon="Monitor">{{
            profile.displayName ?? $t('profiles.summary.currentScreen')
          }}</UiBadge>
          <UiBadge v-if="profile.autoStart" tone="success" :icon="Zap">{{
            $t('automation.autoStartBadge')
          }}</UiBadge>
          <UiBadge tone="accent">
            {{ FEATURE_META.filter((f) => profile.features[f.name]).length }}/{{
              FEATURE_META.length
            }}
            {{ $t('dashboard.protections').toLowerCase() }}
          </UiBadge>
        </div>
        <div class="flex items-center justify-between border-t border-line pt-3">
          <span class="text-[12px] text-text-faint">
            {{
              profile.lastUsedAt
                ? $t('profiles.lastUsed', {
                    date: formatRelativeDate(profile.lastUsedAt, Date.now(), locale),
                  })
                : $t('profiles.neverUsed')
            }}
          </span>
          <div class="flex flex-wrap justify-end gap-2">
            <UiButton
              size="sm"
              variant="ghost"
              :icon="SlidersHorizontal"
              :loading="applying === profile.id"
              :disabled="isolation.live && isolation.freeSeat === null"
              @click="apply(profile)"
            >
              {{ $t('profiles.apply') }}
            </UiButton>
            <UiTooltip :text="$t('automation.playHint')">
              <span>
                <UiButton
                  size="sm"
                  variant="primary"
                  :icon="Play"
                  :disabled="isolation.freeSeat === null || automation.state.phase !== 'idle'"
                  @click="play(profile)"
                >
                  {{ $t('automation.play') }}
                </UiButton>
              </span>
            </UiTooltip>
          </div>
        </div>
      </article>
    </div>

    <div v-else-if="profiles.loaded" class="rounded-xl border border-line bg-surface">
      <UiEmptyState
        :icon="Bookmark"
        :title="$t('profiles.empty')"
        :description="$t('profiles.emptyHint')"
      >
        <UiButton variant="primary" :icon="Plus" @click="edit(null)">{{
          $t('profiles.new')
        }}</UiButton>
      </UiEmptyState>
    </div>

    <ProfileEditorDialog v-model:open="editorOpen" :profile="editing" />
    <UiDialog
      v-model:open="deleteOpen"
      :title="$t('profiles.deleteTitle', { name: deleting?.name ?? '' })"
      :description="$t('profiles.deleteBody')"
      width="sm"
    >
      <template #footer>
        <UiButton variant="ghost" @click="deleteOpen = false">{{ $t('common.cancel') }}</UiButton>
        <UiButton variant="danger" :icon="Trash2" @click="confirmDelete">{{
          $t('common.delete')
        }}</UiButton>
      </template>
    </UiDialog>
  </div>
</template>
