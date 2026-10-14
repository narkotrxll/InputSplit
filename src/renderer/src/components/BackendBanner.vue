<script setup lang="ts">
import { FlaskConical, RefreshCw } from '@lucide/vue'
import { computed } from 'vue'
import { useBackendStore } from '../stores/backend'
import UiButton from './ui/UiButton.vue'

const backend = useBackendStore()
const state = computed(() => backend.state)
const problem = computed(() => {
  const s = state.value
  if (!s || s.status === 'ready' || s.status === 'starting') return null
  return s
})
</script>

<template>
  <div
    v-if="state?.simulated"
    class="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-warning/25 bg-warning-soft text-[12px] font-medium text-warning"
    role="note"
  >
    <FlaskConical class="size-3.5" aria-hidden="true" />
    {{ $t('backend.simulated') }}
  </div>
  <div
    v-else-if="problem"
    class="flex shrink-0 items-center gap-3 border-b px-5 py-2 text-[12.5px]"
    :class="
      problem.status === 'restarting'
        ? 'border-info/25 bg-info-soft text-info'
        : 'border-danger/25 bg-danger-soft text-danger'
    "
    role="alert"
  >
    <span class="font-medium">{{ $t(`backend.${problem.status}`) }}</span>
    <span v-if="problem.reason" class="text-text-muted">{{
      $t(`backend.reason.${problem.reason}`)
    }}</span>
    <div class="flex-1" />
    <UiButton
      v-if="
        problem.status === 'crashed' ||
        (problem.status === 'unavailable' && problem.reason !== 'unsupportedPlatform')
      "
      size="sm"
      :icon="RefreshCw"
      :loading="backend.restarting"
      @click="backend.restart()"
    >
      {{ $t('backend.restart') }}
    </UiButton>
  </div>
</template>
