<script setup lang="ts">
import { useIsolationStore } from '../stores/isolation'
import LogoMark from './LogoMark.vue'
import StatusPill from './StatusPill.vue'

const isolation = useIsolationStore()
</script>

<template>
  <!-- Draggable title bar; the right side leaves room for the native caption buttons. -->
  <header
    class="drag-region flex h-10 shrink-0 items-center gap-2.5 border-b border-line bg-bg pl-4"
    style="
      padding-right: calc(
        100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px
      );
    "
  >
    <LogoMark :size="18" />
    <span class="text-[13px] font-semibold tracking-[-0.01em] text-text">InputSplit</span>
    <div class="flex-1" />
    <div class="no-drag"><StatusPill :status="isolation.uiStatus" /></div>
  </header>
</template>
