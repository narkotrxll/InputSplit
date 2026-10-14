<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { WindowInfo } from '@shared/domain'
import { useIsolationStore } from '../stores/isolation'
import { useWindowsStore } from '../stores/windows'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiSearchInput from './ui/UiSearchInput.vue'
import UiSegmented from './ui/UiSegmented.vue'
import WindowList from './WindowList.vue'

const open = defineModel<boolean>('open', { required: true })
const windows = useWindowsStore()
const isolation = useIsolationStore()
const router = useRouter()
const query = ref('')
const filter = ref<'games' | 'all'>('games')

watch(open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    void windows.refresh()
  }
})

function openApplications(): void {
  open.value = false
  void router.push('/applications')
}

async function choose(window: WindowInfo): Promise<void> {
  open.value = false
  await isolation.selectTarget(window)
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="$t('picker.gameTitle')"
    :description="$t('dashboard.chooseGameHint')"
    width="lg"
  >
    <div class="sticky top-0 z-10 -mx-1 mb-3 flex items-center gap-2 bg-surface px-1 pb-2">
      <UiSearchInput v-model="query" :placeholder="$t('apps.search')" />
      <UiSegmented
        v-model="filter"
        :options="[
          { value: 'games', label: $t('apps.filterGames') },
          { value: 'all', label: $t('apps.filterAll') },
        ]"
      />
      <UiButton
        size="md"
        :icon="RefreshCw"
        :loading="windows.loading"
        :aria-label="$t('common.refresh')"
        @click="windows.refresh()"
      />
    </div>
    <WindowList
      :windows="windows.windows"
      :query="query"
      :show-all="filter === 'all'"
      :selected-pid="isolation.selection.target?.pid ?? null"
      :selected-hwnd="isolation.selection.target?.hwnd ?? null"
      compact
      @select="choose"
    >
      <template #empty-actions>
        <UiButton v-if="filter === 'games'" @click="filter = 'all'">{{
          $t('apps.filterAll')
        }}</UiButton>
      </template>
    </WindowList>
    <template #footer>
      <UiButton variant="ghost" @click="openApplications">{{ $t('picker.browseAll') }}</UiButton>
    </template>
  </UiDialog>
</template>
