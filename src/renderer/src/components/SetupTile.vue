<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'

defineProps<{
  label: string
  title: string
  subtitle?: string
  empty?: boolean
  disabled?: boolean
  warn?: boolean
}>()
defineEmits<{ open: [] }>()
</script>

<template>
  <button
    type="button"
    class="group flex min-w-0 flex-1 flex-col gap-3 rounded-xl border p-4 text-left transition-[border-color,background-color] duration-150 disabled:cursor-not-allowed"
    :class="[
      empty
        ? 'border-dashed border-line-strong bg-transparent hover:bg-surface-2'
        : 'border-line bg-surface-2/60 hover:border-line-strong hover:bg-surface-2',
      warn ? '!border-warning/40' : '',
    ]"
    :disabled="disabled"
    @click="$emit('open')"
  >
    <span
      class="flex items-center justify-between text-[11.5px] font-medium tracking-wide text-text-faint uppercase"
    >
      {{ label }}
      <ChevronRight
        v-if="!disabled"
        class="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
        aria-hidden="true"
      />
    </span>
    <span class="flex min-w-0 items-center gap-3">
      <slot name="visual" />
      <span class="min-w-0">
        <span
          class="block truncate text-[14px] font-medium"
          :class="empty ? 'text-text-muted' : 'text-text'"
        >
          {{ title }}
        </span>
        <span v-if="subtitle" class="mt-0.5 block truncate text-[12px] text-text-faint">{{
          subtitle
        }}</span>
      </span>
    </span>
    <slot />
  </button>
</template>
