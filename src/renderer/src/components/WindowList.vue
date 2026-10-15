<script setup lang="ts">
import { AppWindow, Check, SearchX, ShieldAlert } from '@lucide/vue'
import { computed } from 'vue'
import type { WindowInfo } from '@shared/domain'
import { useCompatStore } from '../stores/compat'
import { useWindowsStore } from '../stores/windows'
import AppIcon from './AppIcon.vue'
import UiBadge from './ui/UiBadge.vue'
import UiButton from './ui/UiButton.vue'
import UiEmptyState from './ui/UiEmptyState.vue'

const props = defineProps<{
  windows: WindowInfo[]
  query: string
  showAll: boolean
  selectedPid: number | null
  selectedHwnd: number | null
  compact?: boolean
}>()
const emit = defineEmits<{ select: [window: WindowInfo] }>()

const store = useWindowsStore()
const compat = useCompatStore()

const KIND_BADGES = {
  blocked: { tone: 'danger', key: 'compat.badgeBlocked' },
  online: { tone: 'warning', key: 'compat.badgeOnline' },
  launcher: { tone: 'warning', key: 'compat.badgeLauncher' },
} as const
const HISTORY_BADGES = {
  works: { tone: 'success', key: 'compat.badgeWorks' },
  limited: { tone: 'info', key: 'compat.badgeLimited' },
  failed: { tone: 'warning', key: 'compat.badgeFailed' },
} as const

/** One badge from what InputSplit knows about the game: built-in list first, then history. */
function compatBadge(window: WindowInfo) {
  const kind = compat.entry(window.exeName)?.kind
  if (kind) return KIND_BADGES[kind]
  const last = compat.lastTime(window.exeName)
  return last ? HISTORY_BADGES[last.outcome] : null
}

/** Hints worth showing as badges, most informative first. */
const BADGE_HINTS = [
  'steam',
  'epic',
  'gog',
  'xbox',
  'ea',
  'ubisoft',
  'unity',
  'unreal',
  'xinput',
  'sdl',
  'fullscreenWindow',
]

const visible = computed(() => {
  const q = props.query.trim().toLowerCase()
  return props.windows
    .filter((w) => props.showAll || w.isLikelyGame)
    .filter((w) => !q || w.title.toLowerCase().includes(q) || w.exeName.toLowerCase().includes(q))
    .sort((a, b) => b.gameScore - a.gameScore || a.title.localeCompare(b.title))
})

function badges(window: WindowInfo): string[] {
  return BADGE_HINTS.filter((h) => window.hints.includes(h)).slice(0, props.compact ? 2 : 4)
}

function isSelected(window: WindowInfo): boolean {
  return window.pid === props.selectedPid && window.hwnd === props.selectedHwnd
}
</script>

<template>
  <div>
    <ul
      v-if="visible.length > 0"
      class="flex flex-col gap-1"
      role="listbox"
      :aria-label="$t('apps.title')"
    >
      <li
        v-for="window in visible"
        :key="`${window.pid}-${window.hwnd}`"
        role="option"
        :aria-selected="isSelected(window)"
        tabindex="0"
        class="group flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors outline-none focus-visible:border-accent/60"
        :class="
          isSelected(window)
            ? 'border-accent/35 bg-accent-soft'
            : 'border-transparent hover:border-line hover:bg-surface-2'
        "
        @click="emit('select', window)"
        @keydown.enter.prevent="emit('select', window)"
        @keydown.space.prevent="emit('select', window)"
      >
        <AppIcon
          :src="store.iconFor(window.exePath)"
          :name="window.exeName"
          :size="compact ? 32 : 36"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-[13.5px] font-medium text-text">{{ window.title }}</p>
          <p class="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-text-faint">
            <span class="font-mono text-text-muted">{{ window.exeName }}</span>
            <span>·</span>
            <span class="tabular">{{ $t('common.pid', { pid: window.pid }) }}</span>
          </p>
        </div>
        <div class="hidden flex-wrap justify-end gap-1 md:flex">
          <UiBadge v-if="window.architecture === 'x86'" tone="neutral">{{
            $t('apps.x86')
          }}</UiBadge>
          <UiBadge v-if="window.elevated || !window.accessible" tone="warning" :icon="ShieldAlert">
            {{ $t('apps.admin') }}
          </UiBadge>
          <UiBadge v-if="window.isMinimized" tone="neutral">{{ $t('apps.minimized') }}</UiBadge>
          <UiBadge v-if="compatBadge(window)" :tone="compatBadge(window)!.tone">{{
            $t(compatBadge(window)!.key)
          }}</UiBadge>
          <UiBadge v-for="hint in badges(window)" :key="hint" tone="neutral">{{
            $t(`apps.hints.${hint}`)
          }}</UiBadge>
        </div>
        <span
          v-if="isSelected(window)"
          class="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent"
        >
          <Check class="size-4" aria-hidden="true" /> {{ $t('apps.selected') }}
        </span>
        <UiButton
          v-else
          size="sm"
          variant="ghost"
          class="opacity-0 group-hover:opacity-100"
          tabindex="-1"
        >
          {{ $t('apps.select') }}
        </UiButton>
      </li>
    </ul>

    <div
      v-else-if="!store.loadedOnce"
      class="flex flex-col gap-1.5"
      :aria-label="$t('apps.loading')"
    >
      <div v-for="i in 5" :key="i" class="skeleton h-[58px] rounded-lg" />
    </div>
    <UiEmptyState v-else-if="query" :icon="SearchX" :title="$t('apps.emptySearch', { query })" />
    <UiEmptyState
      v-else
      :icon="AppWindow"
      :title="showAll ? $t('apps.emptyAll') : $t('apps.emptyGames')"
      :description="showAll ? undefined : $t('apps.emptyGamesHint')"
    >
      <slot name="empty-actions" />
    </UiEmptyState>
  </div>
</template>
