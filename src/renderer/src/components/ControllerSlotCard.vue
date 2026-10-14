<script setup lang="ts">
import { Check, Gamepad2 } from '@lucide/vue'
import type { Controller } from '@shared/domain'
import BatteryIndicator from './BatteryIndicator.vue'

defineProps<{ controller: Controller; selected: boolean; testing?: boolean }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="relative flex flex-col gap-4 rounded-xl border p-4 text-left transition-colors"
    :class="[
      selected
        ? 'border-accent/45 bg-accent-soft'
        : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
      controller.connected ? '' : 'opacity-60',
    ]"
    :aria-pressed="selected"
    @click="$emit('select')"
  >
    <div class="flex items-center justify-between">
      <span
        class="flex size-10 items-center justify-center rounded-lg border"
        :class="
          controller.connected
            ? 'border-line-strong bg-surface-2 text-text'
            : 'border-line text-text-faint'
        "
      >
        <Gamepad2 class="size-5" aria-hidden="true" />
      </span>
      <span
        v-if="selected"
        class="flex size-5 items-center justify-center rounded-full bg-accent text-on-accent"
      >
        <Check class="size-3" aria-hidden="true" />
      </span>
    </div>
    <div>
      <p class="text-[14px] font-semibold text-text">
        {{ $t('common.slot', { n: controller.slot + 1 }) }}
      </p>
      <p class="mt-0.5 text-[12.5px] text-text-muted">
        {{
          !controller.connected
            ? $t('controllers.notConnected')
            : controller.model && controller.model !== 'generic'
              ? $t(`controllers.model.${controller.model}`)
              : $t(`controllers.kind.${controller.kind}`)
        }}
      </p>
    </div>
    <div
      class="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] whitespace-nowrap text-text-faint"
    >
      <template v-if="controller.connected">
        <span class="inline-flex items-center gap-1.5 text-success">
          <span class="size-1.5 rounded-full bg-success" />{{ $t('controllers.connected') }}
        </span>
        <span v-if="controller.wireless !== null">
          {{ controller.wireless ? $t('controllers.wireless') : $t('controllers.wired') }}
        </span>
        <BatteryIndicator v-if="controller.wireless" :battery="controller.battery" />
      </template>
    </div>
  </button>
</template>
