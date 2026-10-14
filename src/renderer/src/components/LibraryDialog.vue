<script setup lang="ts">
import { Library, LoaderCircle, RefreshCw } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LibraryGame, LibraryStore } from '@shared/domain'
import { call } from '../api'
import { useCompatStore } from '../stores/compat'
import { useProfilesStore } from '../stores/profiles'
import { useWindowsStore } from '../stores/windows'
import AppIcon from './AppIcon.vue'
import UiBadge from './ui/UiBadge.vue'
import UiButton from './ui/UiButton.vue'
import UiDialog from './ui/UiDialog.vue'
import UiEmptyState from './ui/UiEmptyState.vue'
import UiSearchInput from './ui/UiSearchInput.vue'
import UiSegmented from './ui/UiSegmented.vue'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [game: LibraryGame] }>()

const { t } = useI18n()
const profiles = useProfilesStore()
const windows = useWindowsStore()
const compat = useCompatStore()

const STORE_NAMES: Record<LibraryStore, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
}

const games = ref<LibraryGame[]>([])
const scanned = ref(false)
const loading = ref(false)
const query = ref('')
const store = ref<'all' | LibraryStore>('all')
const covers = ref<Record<string, string | null>>({})

async function scan(): Promise<void> {
  loading.value = true
  try {
    games.value = await call('library:scan')
    covers.value = {}
    for (const game of games.value) {
      if (game.hasCover) void loadCover(game.id)
      else void windows.loadIcon(game.exePath)
    }
  } catch {
    games.value = []
  } finally {
    loading.value = false
    scanned.value = true
  }
}

async function loadCover(id: string): Promise<void> {
  covers.value[id] = await call('library:cover', id).catch(() => null)
}

watch(open, (isOpen) => {
  if (!isOpen) return
  query.value = ''
  // The library rarely changes while the app runs; "Search again" rescans on demand.
  if (!scanned.value) void scan()
})

const storeOptions = computed(() => {
  const present = (['steam', 'epic', 'gog'] as const).filter((s) =>
    games.value.some((g) => g.store === s),
  )
  return [
    { value: 'all' as const, label: t('library.all') },
    ...present.map((s) => ({ value: s, label: STORE_NAMES[s] })),
  ]
})

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return games.value.filter(
    (g) =>
      (store.value === 'all' || g.store === store.value) &&
      (!q || g.name.toLowerCase().includes(q) || g.exeName.toLowerCase().includes(q)),
  )
})

function hasProfile(game: LibraryGame): boolean {
  const exe = game.exeName.toLowerCase()
  return profiles.profiles.some((p) => p.exeName.toLowerCase() === exe)
}

function warning(game: LibraryGame): string | null {
  const kind = compat.entry(game.exeName)?.kind
  if (kind === 'blocked') return t('compat.badgeBlocked')
  if (kind === 'online') return t('compat.badgeOnline')
  if (kind === 'launcher') return t('compat.badgeLauncher')
  return null
}

function choose(game: LibraryGame): void {
  open.value = false
  emit('pick', game)
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="$t('library.title')"
    :description="$t('library.subtitle')"
    width="lg"
  >
    <div class="sticky top-0 z-10 -mx-1 mb-3 flex items-center gap-2 bg-surface px-1 pb-2">
      <UiSearchInput v-model="query" :placeholder="$t('library.search')" />
      <UiSegmented
        v-if="storeOptions.length > 2"
        v-model="store"
        :options="storeOptions"
        :label="$t('library.title')"
      />
      <UiButton
        size="md"
        :icon="RefreshCw"
        :loading="loading"
        :aria-label="$t('library.rescan')"
        @click="scan()"
      />
    </div>

    <div
      v-if="loading && !games.length"
      class="flex items-center justify-center gap-2 py-16 text-[13px] text-text-muted"
    >
      <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
      {{ $t('library.searching') }}
    </div>
    <UiEmptyState
      v-else-if="scanned && !games.length"
      :icon="Library"
      :title="$t('library.emptyTitle')"
      :description="$t('library.emptyHint')"
    >
      <UiButton :icon="RefreshCw" :loading="loading" @click="scan()">{{
        $t('library.rescan')
      }}</UiButton>
    </UiEmptyState>
    <p v-else-if="scanned && !shown.length" class="py-12 text-center text-[13px] text-text-muted">
      {{ $t('library.noMatch') }}
    </p>
    <ul v-else class="flex flex-col gap-1" role="listbox" :aria-label="$t('library.title')">
      <li v-for="game in shown" :key="game.id">
        <button
          type="button"
          role="option"
          :aria-selected="false"
          class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
          @click="choose(game)"
        >
          <div
            v-if="game.hasCover"
            class="h-12 w-8 shrink-0 overflow-hidden rounded-md border border-line bg-surface-2"
            aria-hidden="true"
          >
            <img
              v-if="covers[game.id]"
              :src="covers[game.id]!"
              alt=""
              class="size-full object-cover"
              draggable="false"
            />
          </div>
          <div v-else class="flex h-12 w-8 shrink-0 items-center justify-center">
            <AppIcon :src="windows.iconFor(game.exePath)" :name="game.name" :size="32" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] font-medium text-text">{{ game.name }}</p>
            <p class="truncate font-mono text-[11.5px] text-text-faint">{{ game.exeName }}</p>
          </div>
          <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
            <UiBadge v-if="warning(game)" tone="warning">{{ warning(game) }}</UiBadge>
            <UiBadge v-if="hasProfile(game)" tone="success">{{ $t('library.hasProfile') }}</UiBadge>
            <UiBadge>{{ STORE_NAMES[game.store] }}</UiBadge>
          </div>
        </button>
      </li>
    </ul>
  </UiDialog>
</template>
