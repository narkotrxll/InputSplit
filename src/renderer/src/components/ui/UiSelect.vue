<script setup lang="ts" generic="T extends string | number">
import { Check, ChevronDown } from '@lucide/vue'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'

defineProps<{
  options: { value: T; label: string; hint?: string }[]
  label?: string
  id?: string
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <SelectRoot v-model="model">
    <SelectTrigger
      :id="id"
      :aria-label="label"
      class="inline-flex h-8.5 w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 text-left text-[13px] text-text hover:bg-surface-3 focus:outline-none data-[placeholder]:text-text-faint"
    >
      <SelectValue />
      <ChevronDown class="size-4 shrink-0 text-text-muted" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-[60] max-h-72 min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-lg border border-line-strong bg-surface-2 p-1 shadow-[var(--shadow-pop)]"
      >
        <SelectViewport>
          <SelectItem
            v-for="option in options"
            :key="String(option.value)"
            :value="option.value"
            class="relative flex cursor-default items-center rounded-md py-1.5 pr-2 pl-7 text-[13px] text-text outline-none data-[highlighted]:bg-surface-3"
          >
            <SelectItemIndicator class="absolute left-2 inline-flex">
              <Check class="size-3.5 text-accent" />
            </SelectItemIndicator>
            <SelectItemText>{{ option.label }}</SelectItemText>
            <span v-if="option.hint" class="ml-2 text-[12px] text-text-faint">{{
              option.hint
            }}</span>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
