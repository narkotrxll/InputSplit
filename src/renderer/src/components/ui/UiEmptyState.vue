<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
    <div
      class="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2"
    >
      <component :is="icon" class="size-5 text-text-muted" aria-hidden="true" />
    </div>
    <p class="text-[14px] font-medium text-text">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-[13px] text-text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5 flex gap-2"><slot /></div>
  </div>
</template>
