<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

defineProps<{ disabled?: boolean; label?: string; id?: string }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <SwitchRoot
    :id="id"
    v-model="model"
    :disabled="disabled"
    :aria-label="label"
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 transition-colors duration-150 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
  >
    <SwitchThumb
      class="block size-3.5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[var(--ease-out-soft)] data-[state=checked]:translate-x-[18px]"
    />
  </SwitchRoot>
</template>
