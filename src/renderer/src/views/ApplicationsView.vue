<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { WindowInfo } from '@shared/domain'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/ui/UiButton.vue'
import UiCallout from '../components/ui/UiCallout.vue'
import UiSearchInput from '../components/ui/UiSearchInput.vue'
import UiSegmented from '../components/ui/UiSegmented.vue'
import WindowList from '../components/WindowList.vue'
import { errorText } from '../i18n'
import { useIsolationStore } from '../stores/isolation'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useWindowsStore } from '../stores/windows'

const { t } = useI18n()
const router = useRouter()
const windows = useWindowsStore()
const isolation = useIsolationStore()
const settings = useSettingsStore()
const ui = useUiStore()
const query = ref('')

const filter = computed<'games' | 'all'>({
  get: () => (settings.settings.showAllWindows ? 'all' : 'games'),
  set: (value) => void settings.update({ showAllWindows: value === 'all' }),
})

async function select(window: WindowInfo): Promise<void> {
  if (isolation.live) return
  await isolation.selectTarget(window)
  const blocked = (isolation.check?.blockers.length ?? 0) > 0
  ui.toast({
    tone: blocked ? 'warning' : 'success',
    title: t('apps.selectedToast', { name: window.title }),
    body: blocked ? t('apps.cannotIsolate') : t('apps.canIsolate'),
    action: { label: t('apps.goToDashboard'), run: () => void router.push('/') },
  })
}

// Refresh when the user comes back to InputSplit (e.g. after starting a game).
const onFocus = () => void windows.refresh()
onMounted(() => {
  void windows.refresh()
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
</script>

<template>
  <div>
    <PageHeader :title="$t('apps.title')" :subtitle="$t('apps.subtitle')" />
    <div class="mb-4 flex items-center gap-2">
      <div class="max-w-md flex-1">
        <UiSearchInput v-model="query" :placeholder="$t('apps.search')" />
      </div>
      <UiSegmented
        v-model="filter"
        :options="[
          { value: 'games', label: $t('apps.filterGames') },
          { value: 'all', label: $t('apps.filterAll') },
        ]"
        :label="$t('apps.title')"
      />
      <div class="flex-1" />
      <UiButton :icon="RefreshCw" :loading="windows.loading" @click="windows.refresh()">{{
        $t('common.refresh')
      }}</UiButton>
    </div>
    <UiCallout v-if="windows.error" tone="danger" class="mb-4">{{
      errorText(windows.error)
    }}</UiCallout>
    <div class="rounded-xl border border-line bg-surface p-2">
      <WindowList
        :windows="windows.windows"
        :query="query"
        :show-all="filter === 'all'"
        :selected-pid="isolation.selection.target?.pid ?? null"
        :selected-hwnd="isolation.selection.target?.hwnd ?? null"
        @select="select"
      >
        <template #empty-actions>
          <UiButton v-if="filter === 'games'" @click="filter = 'all'">{{
            $t('apps.filterAll')
          }}</UiButton>
          <UiButton :icon="RefreshCw" @click="windows.refresh()">{{
            $t('common.refresh')
          }}</UiButton>
        </template>
      </WindowList>
    </div>
  </div>
</template>
