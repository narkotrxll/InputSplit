<script setup lang="ts">
import { Copy, Download, FolderOpen, X } from '@lucide/vue'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from 'reka-ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { call } from '../api'
import { useBackendStore } from '../stores/backend'
import { useIsolationStore } from '../stores/isolation'
import { useLogsStore } from '../stores/logs'
import { useUiStore } from '../stores/ui'
import UiButton from './ui/UiButton.vue'
import UiSegmented from './ui/UiSegmented.vue'

const { t } = useI18n()
const ui = useUiStore()
const logs = useLogsStore()
const backend = useBackendStore()
const isolation = useIsolationStore()
const level = ref<'all' | 'warn' | 'error'>('all')

const shown = computed(() => {
  const list = logs.entries.filter((e) =>
    level.value === 'all'
      ? true
      : level.value === 'warn'
        ? e.level === 'warn' || e.level === 'error'
        : e.level === 'error',
  )
  return [...list].reverse()
})

const levelColor = {
  debug: 'text-text-faint',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-danger',
}
const sessionJson = computed(() => {
  const view = isolation.view
  // Window titles are personal; diagnostics show the executable name only.
  return JSON.stringify(
    {
      ...view,
      target: view.target ? { exeName: view.target.exeName, pid: view.target.pid } : null,
    },
    null,
    2,
  )
})

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  ui.toast({ tone: 'success', title: t('common.copied') }, 2000)
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

async function exportFile(): Promise<void> {
  const result = await call('diagnostics:export')
  if (result.saved) ui.toast({ tone: 'success', title: t('settings.exported') })
}
</script>

<template>
  <DialogRoot v-model:open="ui.diagnosticsOpen">
    <DialogPortal>
      <Transition name="fade">
        <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      </Transition>
      <DialogContent
        class="fixed top-0 right-0 bottom-0 z-50 flex w-[560px] max-w-[92vw] flex-col border-l border-line-strong bg-surface shadow-[var(--shadow-pop)] focus:outline-none"
      >
        <header class="flex h-14 items-center justify-between border-b border-line px-5">
          <DialogTitle class="text-[15px] font-semibold text-text">{{
            $t('diagnostics.title')
          }}</DialogTitle>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
            :aria-label="$t('common.close')"
            @click="ui.diagnosticsOpen = false"
          >
            <X class="size-4" />
          </button>
        </header>
        <TabsRoot default-value="logs" class="flex min-h-0 flex-1 flex-col">
          <TabsList class="flex gap-1 border-b border-line px-4">
            <TabsTrigger
              v-for="tab in ['logs', 'session', 'system']"
              :key="tab"
              :value="tab"
              class="-mb-px border-b-2 border-transparent px-2.5 py-2.5 text-[13px] font-medium text-text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
            >
              {{ $t(`diagnostics.${tab}`) }}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" class="flex min-h-0 flex-1 flex-col">
            <div class="flex items-center gap-2 px-4 py-3">
              <UiSegmented
                v-model="level"
                :options="[
                  { value: 'all', label: $t('diagnostics.filterAll') },
                  { value: 'warn', label: $t('diagnostics.filterWarnings') },
                  { value: 'error', label: $t('diagnostics.filterErrors') },
                ]"
              />
              <div class="flex-1" />
              <UiButton
                size="sm"
                variant="ghost"
                :icon="FolderOpen"
                :aria-label="$t('settings.openLogs')"
                @click="call('diagnostics:openLogFolder')"
              />
              <UiButton
                size="sm"
                variant="ghost"
                :icon="Download"
                :aria-label="$t('settings.exportDiagnostics')"
                @click="exportFile"
              />
            </div>
            <ol
              class="selectable min-h-0 flex-1 overflow-y-auto px-4 pb-4 font-mono text-[11.5px] leading-relaxed"
            >
              <li
                v-for="(entry, i) in shown"
                :key="i"
                class="flex gap-2 border-b border-line/50 py-1"
              >
                <span class="shrink-0 text-text-faint tabular">{{ time(entry.time) }}</span>
                <span class="w-10 shrink-0 uppercase" :class="levelColor[entry.level]">{{
                  entry.level
                }}</span>
                <span class="w-12 shrink-0 text-text-faint">{{ entry.source }}</span>
                <span class="min-w-0 break-words text-text">{{ entry.message }}</span>
              </li>
              <li v-if="shown.length === 0" class="py-10 text-center font-sans text-text-faint">
                {{ $t('diagnostics.empty') }}
              </li>
            </ol>
            <p class="border-t border-line px-4 py-2.5 text-[11.5px] text-text-faint">
              {{ $t('diagnostics.privacy') }}
            </p>
          </TabsContent>

          <TabsContent value="session" class="flex min-h-0 flex-1 flex-col p-4">
            <div class="mb-2 flex justify-end">
              <UiButton size="sm" :icon="Copy" @click="copy(sessionJson)">{{
                $t('diagnostics.copyJson')
              }}</UiButton>
            </div>
            <pre
              class="selectable min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-bg-subtle p-3 font-mono text-[11.5px] text-text"
              >{{ sessionJson }}</pre>
          </TabsContent>

          <TabsContent value="system" class="p-5">
            <dl class="grid grid-cols-[170px_1fr] gap-y-2.5 text-[13px]">
              <dt class="text-text-faint">{{ $t('diagnostics.appVersion') }}</dt>
              <dd class="selectable font-mono text-text">{{ backend.info?.version }}</dd>
              <dt class="text-text-faint">{{ $t('diagnostics.electron') }}</dt>
              <dd class="selectable font-mono text-text">{{ backend.info?.electron }}</dd>
              <dt class="text-text-faint">{{ $t('diagnostics.helperVersion') }}</dt>
              <dd class="selectable font-mono text-text">
                {{ backend.state?.helperVersion ?? '—' }} ({{ backend.state?.status }})
              </dd>
              <dt class="text-text-faint">{{ $t('diagnostics.windowsBuild') }}</dt>
              <dd class="selectable font-mono text-text">
                {{ backend.state?.windowsBuild ?? '—' }}
              </dd>
              <dt class="text-text-faint">{{ $t('diagnostics.elevated') }}</dt>
              <dd class="font-mono text-text">
                {{ backend.state?.isElevated ? $t('common.yes') : $t('common.no') }}
              </dd>
              <dt class="text-text-faint">{{ $t('diagnostics.dataFolder') }}</dt>
              <dd class="selectable font-mono text-[12px] break-all text-text">
                {{ backend.info?.userDataPath }}
              </dd>
            </dl>
          </TabsContent>
        </TabsRoot>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
