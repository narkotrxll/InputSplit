<script setup lang="ts">
import { Activity, Crosshair, EyeOff, Keyboard, MousePointer2 } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { IsolationView } from '@shared/domain'
import { formatCount, formatDuration } from '../lib/format'
import UiBadge from './ui/UiBadge.vue'

const props = defineProps<{ view: IsolationView }>()

const now = ref(Date.now())
const timer = window.setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => window.clearInterval(timer))

// Reads per second, from the difference between two status updates (1 s apart).
const previous = ref<{ reads: number; at: number } | null>(null)
const rate = ref(0)
watch(
  () => props.view.counters?.xinputReads,
  (reads) => {
    if (reads === undefined) {
      previous.value = null
      rate.value = 0
      return
    }
    const at = Date.now()
    if (previous.value && at > previous.value.at) {
      rate.value = Math.max(
        0,
        Math.round(((reads - previous.value.reads) * 1000) / (at - previous.value.at)),
      )
    }
    previous.value = { reads, at }
  },
)

const running = computed(() => props.view.phase === 'running')
const counters = computed(() => props.view.counters)
const controllerFeature = computed(() =>
  props.view.features.find((f) => f.name === 'xinputBackground'),
)
const proof = computed(() => {
  const state = controllerFeature.value?.state
  if (state === 'active') return { key: 'reading', class: 'text-success', dot: 'bg-success' }
  if (state === 'unsupported') return { key: 'none', class: 'text-warning', dot: 'bg-warning' }
  return { key: 'waiting', class: 'text-info', dot: 'bg-info' }
})

const rows = computed(() => [
  { key: 'blockedKeyboard', icon: Keyboard, value: counters.value?.blockedKeyboard ?? 0 },
  { key: 'blockedMouse', icon: MousePointer2, value: counters.value?.blockedMouse ?? 0 },
  { key: 'swallowedFocusEvents', icon: EyeOff, value: counters.value?.swallowedFocusEvents ?? 0 },
  { key: 'blockedCursorCalls', icon: Crosshair, value: counters.value?.blockedCursorCalls ?? 0 },
])
</script>

<template>
  <div v-if="running && counters" class="flex flex-col gap-4">
    <div class="rounded-lg border border-line bg-bg-subtle p-4">
      <div class="flex items-center justify-between">
        <span class="inline-flex items-center gap-2 text-[12.5px] font-medium" :class="proof.class">
          <span
            class="relative size-2 rounded-full"
            :class="[proof.dot, proof.key === 'reading' ? 'pulse-dot' : '']"
          />
          {{ $t(`dashboard.controllerProof.${proof.key}`) }}
        </span>
        <Activity class="size-4 text-text-faint" aria-hidden="true" />
      </div>
      <p class="mt-3 text-[28px] leading-none font-semibold tracking-[-0.03em] text-text tabular">
        {{ rate }}
      </p>
      <p class="mt-1 flex justify-between gap-2 text-[12px] text-text-faint">
        <span>{{ $t('dashboard.counters.xinputRate') }}</span>
        <span class="tabular">{{
          $t('dashboard.counters.total', { n: formatCount(counters.xinputReads) })
        }}</span>
      </p>
    </div>
    <dl class="grid grid-cols-2 gap-2">
      <div v-for="row in rows" :key="row.key" class="rounded-lg border border-line px-3 py-2.5">
        <dt class="flex items-center gap-1.5 text-[11.5px] text-text-faint">
          <component :is="row.icon" class="size-3.5" aria-hidden="true" />{{
            $t(`dashboard.counters.${row.key}`)
          }}
        </dt>
        <dd class="mt-1 text-[16px] font-semibold text-text tabular">
          {{ formatCount(row.value) }}
        </dd>
      </div>
    </dl>
    <div class="flex items-center justify-between text-[12px] text-text-faint">
      <span>{{
        $t('dashboard.uptime', { time: formatDuration(now - (view.startedAt ?? now)) })
      }}</span>
    </div>
    <div v-if="view.detectedApis.length > 0">
      <p class="mb-1.5 text-[11.5px] font-medium tracking-wide text-text-faint uppercase">
        {{ $t('dashboard.detectedApis') }}
      </p>
      <div class="flex flex-wrap gap-1">
        <UiBadge v-for="api in view.detectedApis" :key="api" tone="neutral">{{ api }}</UiBadge>
      </div>
    </div>
  </div>
  <p v-else class="py-8 text-center text-[13px] text-text-faint">
    {{ $t('dashboard.notRunning') }}
  </p>
</template>
