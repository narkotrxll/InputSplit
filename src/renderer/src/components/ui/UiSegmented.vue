<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'

defineProps<{ options: { value: T; label: string }[]; label?: string }>()
const model = defineModel<T>({ required: true })

function update(value: unknown): void {
  // A toggle group can be "unset" by clicking the active item; keep one value selected.
  if (typeof value === 'string' && value.length > 0) model.value = value as T
}
</script>

<template>
  <ToggleGroupRoot
    type="single"
    :model-value="model"
    :aria-label="label"
    class="inline-flex h-8.5 items-center gap-0.5 rounded-lg border border-line bg-bg-subtle p-0.5"
    @update:model-value="update"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      class="h-full rounded-md px-3 text-[12.5px] font-medium whitespace-nowrap text-text-muted transition-colors hover:text-text data-[state=on]:bg-surface-3 data-[state=on]:text-text data-[state=on]:shadow-sm"
    >
      {{ option.label }}
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
