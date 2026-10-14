<script setup lang="ts">
import { Search, X } from '@lucide/vue'

defineProps<{ placeholder: string }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <label class="relative flex h-8.5 w-full items-center">
    <Search
      class="pointer-events-none absolute left-2.5 size-4 text-text-faint"
      aria-hidden="true"
    />
    <input
      v-model="model"
      type="search"
      :placeholder="placeholder"
      :aria-label="placeholder"
      class="h-full w-full rounded-lg border border-line bg-bg-subtle pr-8 pl-8.5 text-[13px] text-text placeholder:text-text-faint focus:border-accent/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
    />
    <button
      v-if="model"
      type="button"
      class="absolute right-1.5 inline-flex size-6 items-center justify-center rounded text-text-faint hover:text-text"
      :aria-label="$t('common.close')"
      @click="model = ''"
    >
      <X class="size-3.5" />
    </button>
  </label>
</template>
