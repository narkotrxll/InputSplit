<script setup lang="ts">
withDefaults(defineProps<{ title?: string; description?: string; padded?: boolean }>(), {
  title: undefined,
  description: undefined,
  padded: true,
})
</script>

<template>
  <section class="rounded-xl border border-line bg-surface">
    <header
      v-if="title || $slots.actions"
      class="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5"
    >
      <div class="min-w-0">
        <h2 class="text-[13.5px] font-semibold tracking-[-0.01em] text-text">{{ title }}</h2>
        <p v-if="description" class="mt-0.5 text-[12.5px] text-text-muted">{{ description }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5"><slot name="actions" /></div>
    </header>
    <div :class="padded ? 'p-5' : ''"><slot /></div>
  </section>
</template>
