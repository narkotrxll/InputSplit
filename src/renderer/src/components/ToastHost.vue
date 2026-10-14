<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '@lucide/vue'
import { useUiStore, type Toast } from '../stores/ui'

const ui = useUiStore()

function runAction(toast: Toast): void {
  toast.action?.run()
  ui.dismissToast(toast.id)
}
const icons = { neutral: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert }
const colors = {
  neutral: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}
</script>

<template>
  <div
    class="pointer-events-none fixed right-5 bottom-5 z-[70] flex w-[340px] flex-col gap-2"
    aria-live="polite"
  >
    <TransitionGroup name="pop">
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="pointer-events-auto flex gap-3 rounded-lg border border-line-strong bg-surface-2 px-3.5 py-3 shadow-[var(--shadow-pop)]"
      >
        <component
          :is="icons[toast.tone]"
          class="mt-0.5 size-4 shrink-0"
          :class="colors[toast.tone]"
        />
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-text">{{ toast.title }}</p>
          <p v-if="toast.body" class="mt-0.5 text-[12.5px] text-text-muted">{{ toast.body }}</p>
          <button
            v-if="toast.action"
            type="button"
            class="mt-1.5 text-[12.5px] font-medium text-accent hover:text-accent-hover"
            @click="runAction(toast)"
          >
            {{ toast.action.label }}
          </button>
        </div>
        <button
          type="button"
          class="-m-1 inline-flex size-6 items-center justify-center rounded text-text-faint hover:text-text"
          :aria-label="$t('common.close')"
          @click="ui.dismissToast(toast.id)"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
