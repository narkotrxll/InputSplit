<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <header class="mb-6 flex items-end justify-between gap-6">
    <div class="min-w-0">
      <h1 class="text-[22px] font-semibold tracking-[-0.025em] text-text">{{ title }}</h1>
      <p v-if="subtitle" class="mt-1 text-[13.5px] text-text-muted">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.default" class="flex shrink-0 items-center gap-2"><slot /></div>
  </header>
</template>
