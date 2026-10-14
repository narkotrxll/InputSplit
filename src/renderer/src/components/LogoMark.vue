<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 22 })
</script>

<template>
  <!-- One shape, split in two: a solid half (the game) and an outlined half (your desktop). -->
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect width="24" height="24" rx="6.5" fill="var(--app-accent)" />
    <path d="M10.75 6.5a5.5 5.5 0 0 0 0 11z" fill="#fff" />
    <path
      d="M13.25 7.35a4.6 4.6 0 0 1 0 9.3"
      stroke="#fff"
      stroke-width="1.9"
      stroke-linecap="round"
    />
  </svg>
</template>
