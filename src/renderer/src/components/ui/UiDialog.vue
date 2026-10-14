<script setup lang="ts">
import { X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'

withDefaults(
  defineProps<{
    title: string
    description?: string
    width?: 'sm' | 'md' | 'lg'
    dismissible?: boolean
  }>(),
  { description: undefined, width: 'md', dismissible: true },
)
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <Transition name="fade">
        <DialogOverlay class="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
      </Transition>
      <Transition name="pop">
        <DialogContent
          class="fixed top-1/2 left-1/2 z-50 flex max-h-[min(86vh,760px)] w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line-strong bg-surface shadow-[var(--shadow-pop)] focus:outline-none"
          :class="{ sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[760px]' }[width]"
          @escape-key-down="(e: Event) => !dismissible && e.preventDefault()"
          @pointer-down-outside="(e: Event) => !dismissible && e.preventDefault()"
        >
          <header class="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <DialogTitle class="text-[16px] font-semibold tracking-[-0.015em] text-text">{{
                title
              }}</DialogTitle>
              <DialogDescription v-if="description" class="mt-1 text-[13px] text-text-muted">
                {{ description }}
              </DialogDescription>
            </div>
            <DialogClose
              v-if="dismissible"
              class="-mr-2 inline-flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
              :aria-label="$t('common.close')"
            >
              <X class="size-4" />
            </DialogClose>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-5"><slot /></div>
          <footer
            v-if="$slots.footer"
            class="flex items-center justify-end gap-2 border-t border-line px-6 py-3.5"
          >
            <slot name="footer" />
          </footer>
        </DialogContent>
      </Transition>
    </DialogPortal>
  </DialogRoot>
</template>
