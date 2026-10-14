<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import { computed, type Component } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
    size?: 'sm' | 'md' | 'lg'
    icon?: Component
    loading?: boolean
    disabled?: boolean
    block?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', icon: undefined, type: 'button' },
)

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none',
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
  'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
  props.block ? 'w-full' : '',
  {
    sm: 'h-7 px-2.5 text-[12.5px] rounded-md',
    md: 'h-8.5 px-3.5 text-[13px] rounded-lg',
    lg: 'h-11 px-5 text-[14px] rounded-[10px]',
  }[props.size],
  {
    primary:
      'bg-accent text-on-accent hover:bg-accent-hover shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_6px_16px_-6px_var(--app-accent)]',
    secondary: 'bg-surface-2 text-text border border-line-strong hover:bg-surface-3',
    ghost: 'text-text-muted hover:text-text hover:bg-surface-2',
    danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger/20',
    subtle: 'bg-accent-soft text-accent hover:bg-accent/20',
  }[props.variant],
])
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
    <component :is="icon" v-else-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <slot />
  </button>
</template>
