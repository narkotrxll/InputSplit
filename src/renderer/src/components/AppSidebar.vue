<script setup lang="ts">
import {
  AppWindow,
  Bookmark,
  Gamepad2,
  Info,
  LayoutDashboard,
  PanelRight,
  Settings,
  Sparkles,
} from '@lucide/vue'
import { computed } from 'vue'
import { useBackendStore } from '../stores/backend'
import { useUiStore } from '../stores/ui'
import { useUpdatesStore } from '../stores/updates'
import UiKbd from './ui/UiKbd.vue'

const backend = useBackendStore()
const ui = useUiStore()
const updates = useUpdatesStore()

const items = [
  { to: '/', name: 'dashboard', icon: LayoutDashboard, key: '1' },
  { to: '/applications', name: 'applications', icon: AppWindow, key: '2' },
  { to: '/controllers', name: 'controllers', icon: Gamepad2, key: '3' },
  { to: '/profiles', name: 'profiles', icon: Bookmark, key: '4' },
  { to: '/settings', name: 'settings', icon: Settings, key: '5' },
  { to: '/about', name: 'about', icon: Info, key: '6' },
] as const

const backendStatus = computed(() => backend.state?.status ?? 'starting')
const dotClass = computed(
  () =>
    ({
      ready: 'bg-success',
      starting: 'bg-info',
      restarting: 'bg-info',
      crashed: 'bg-danger',
      unavailable: 'bg-text-faint',
    })[backendStatus.value],
)
</script>

<template>
  <nav
    class="flex w-[228px] shrink-0 flex-col border-r border-line bg-bg-subtle"
    :aria-label="'Main'"
  >
    <ul class="flex flex-col gap-0.5 p-2.5 pt-3">
      <li v-for="item in items" :key="item.name">
        <RouterLink
          :to="item.to"
          class="group flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          active-class="!bg-surface-3 !text-text"
          :exact-active-class="item.to === '/' ? '!bg-surface-3 !text-text' : undefined"
        >
          <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ $t(`nav.${item.name}`) }}</span>
          <UiKbd class="opacity-0 transition-opacity group-hover:opacity-100"
            >Ctrl {{ item.key }}</UiKbd
          >
        </RouterLink>
      </li>
    </ul>

    <div class="mt-auto flex flex-col gap-2 p-2.5">
      <RouterLink
        v-if="updates.state?.status === 'available'"
        to="/settings"
        class="flex min-h-8.5 items-center gap-2.5 rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-[13px] font-medium text-accent transition-colors hover:bg-accent-soft/70"
      >
        <Sparkles class="size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          {{ $t('updates.sidebar') }}
          <span class="block text-[11.5px] font-normal text-text-muted">{{
            updates.state.latestVersion
          }}</span>
        </span>
      </RouterLink>
      <button
        type="button"
        class="flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        @click="ui.diagnosticsOpen = true"
      >
        <PanelRight class="size-4" aria-hidden="true" />
        {{ $t('nav.diagnostics') }}
      </button>
      <div class="rounded-lg border border-line bg-surface px-3 py-2.5">
        <div class="flex items-center gap-2 text-[12px] font-medium text-text">
          <span class="size-1.5 rounded-full" :class="dotClass" />
          {{ $t(`backend.${backendStatus}`) }}
        </div>
        <p
          v-if="backend.state?.emergencyHotkey"
          class="mt-1.5 text-[11.5px] leading-snug text-text-faint"
        >
          {{ $t('shortcuts.emergency') }}:
          <span class="font-mono text-text-muted">{{ backend.state.emergencyHotkey }}</span>
        </p>
      </div>
    </div>
  </nav>
</template>
