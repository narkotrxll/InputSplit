<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{ text?: string; side?: 'top' | 'bottom' | 'left' | 'right' }>(), {
  text: undefined,
  side: 'top',
})
</script>

<template>
  <TooltipRoot v-if="text" :delay-duration="350">
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side="side"
        :side-offset="6"
        class="z-50 max-w-72 rounded-md border border-line-strong bg-surface-3 px-2.5 py-1.5 text-[12px] leading-snug text-text shadow-[var(--shadow-pop)]"
      >
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
  <slot v-else />
</template>
