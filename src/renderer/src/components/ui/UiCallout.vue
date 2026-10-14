<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/vue'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    tone?: 'info' | 'success' | 'warning' | 'danger'
    title?: string
    dismissible?: boolean
  }>(),
  { tone: 'info', title: undefined },
)
defineEmits<{ dismiss: [] }>()

const style = computed(
  () =>
    ({
      info: { box: 'border-info/25 bg-info-soft', icon: Info, color: 'text-info' },
      success: {
        box: 'border-success/25 bg-success-soft',
        icon: CircleCheck,
        color: 'text-success',
      },
      warning: {
        box: 'border-warning/30 bg-warning-soft',
        icon: TriangleAlert,
        color: 'text-warning',
      },
      danger: { box: 'border-danger/30 bg-danger-soft', icon: CircleAlert, color: 'text-danger' },
    })[props.tone],
)
</script>

<template>
  <div class="flex gap-3 rounded-lg border px-3.5 py-3" :class="style.box" role="status">
    <component
      :is="style.icon"
      class="mt-0.5 size-4 shrink-0"
      :class="style.color"
      aria-hidden="true"
    />
    <div class="min-w-0 flex-1 text-[13px] leading-relaxed text-text">
      <p v-if="title" class="font-medium">{{ title }}</p>
      <div :class="title ? 'text-text-muted' : ''"><slot /></div>
      <div v-if="$slots.actions" class="mt-2.5 flex gap-2"><slot name="actions" /></div>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="-m-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-text-muted hover:text-text"
      :aria-label="$t('common.close')"
      @click="$emit('dismiss')"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
