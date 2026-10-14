<script setup lang="ts">
import type { Component } from 'vue'
import UiTooltip from './UiTooltip.vue'

defineOptions({ inheritAttrs: false })
defineProps<{ icon: Component; label: string; size?: 'sm' | 'md'; disabled?: boolean }>()
defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <UiTooltip :text="label">
    <button
      v-bind="$attrs"
      type="button"
      :aria-label="label"
      :disabled="disabled"
      class="inline-flex items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
      :class="size === 'sm' ? 'size-7' : 'size-8.5'"
      @click="$emit('click', $event)"
    >
      <component :is="icon" class="size-4" aria-hidden="true" />
    </button>
  </UiTooltip>
</template>
