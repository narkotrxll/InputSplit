<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { KEY_BINDINGS, type KeyBinding } from '@shared/defaults'
import type { GamepadTuning } from '@shared/domain'
import { keyName } from '@shared/key-names'
import { useSettingsStore } from '../stores/settings'
import UiButton from './ui/UiButton.vue'
import UiCard from './ui/UiCard.vue'

const store = useSettingsStore()
const { t } = useI18n()

const keys = computed(() => store.settings.gamepadTuning.keys)

function save(next: GamepadTuning['keys']): void {
  void store.update({ gamepadTuning: { ...store.settings.gamepadTuning, keys: next } })
}

const LABELS: Partial<Record<KeyBinding, string>> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  leftShoulder: 'LB',
  rightShoulder: 'RB',
  back: 'View',
  start: 'Menu',
  leftThumb: 'LS',
  rightThumb: 'RS',
  leftTrigger: 'LT',
  rightTrigger: 'RT',
}
const ARROWS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' }
function label(binding: KeyBinding): string {
  const fixed = LABELS[binding]
  if (fixed) return fixed
  const dpad = /^dpad(\w+)$/.exec(binding)
  if (dpad) return `${t('controllers.tuning.dpad')} ${ARROWS[dpad[1]!]}`
  const stick = /^stick(\w+)$/.exec(binding)
  return `${t('controllers.keys.stick')} ${ARROWS[stick![1]!]}`
}

// Waiting for a key press for this input.
const capturing = ref<KeyBinding | null>(null)

function onKey(event: KeyboardEvent): void {
  const binding = capturing.value
  if (!binding || event.keyCode === 229) return // 229: the IME is composing
  event.preventDefault()
  event.stopPropagation()
  stopCapture()
  // Chromium's keyCode on Windows is the virtual-key code.
  if (event.keyCode > 0 && event.keyCode < 255) save({ ...keys.value, [binding]: event.keyCode })
}

function stopCapture(): void {
  capturing.value = null
  window.removeEventListener('keydown', onKey, true)
}

function capture(binding: KeyBinding): void {
  if (capturing.value === binding) return stopCapture()
  stopCapture()
  capturing.value = binding
  window.addEventListener('keydown', onKey, true)
}

function clearKey(binding: KeyBinding): void {
  const next = { ...keys.value }
  delete next[binding]
  save(next)
}

onBeforeUnmount(stopCapture)

/** Stick on WASD, D-pad on the arrows and the usual PC game keys on the buttons. */
const PRESET: GamepadTuning['keys'] = {
  stickUp: 0x57,
  stickLeft: 0x41,
  stickDown: 0x53,
  stickRight: 0x44,
  dpadUp: 0x26,
  dpadDown: 0x28,
  dpadLeft: 0x25,
  dpadRight: 0x27,
  a: 0x20,
  b: 0x1b,
  x: 0x45,
  y: 0x51,
  leftShoulder: 0x10,
  rightShoulder: 0x11,
  start: 0x0d,
  back: 0x09,
}
</script>

<template>
  <UiCard :title="$t('controllers.keys.title')" :description="$t('controllers.keys.description')">
    <template #actions>
      <UiButton size="sm" variant="ghost" @click="save({ ...PRESET })">
        {{ $t('controllers.keys.preset') }}
      </UiButton>
      <UiButton
        size="sm"
        variant="ghost"
        :disabled="Object.keys(keys).length === 0"
        @click="save({})"
      >
        {{ $t('controllers.keys.clear') }}
      </UiButton>
    </template>

    <div class="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4 xl:grid-cols-6">
      <div v-for="binding in KEY_BINDINGS" :key="binding" class="flex min-w-0 flex-col gap-1">
        <span class="truncate text-[12px] text-text-muted">{{ label(binding) }}</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="h-8.5 min-w-0 flex-1 truncate rounded-lg border bg-surface-2 px-3 text-left text-[13px] hover:bg-surface-3"
            :class="
              capturing === binding ? 'border-accent text-accent' : 'border-line-strong text-text'
            "
            :aria-label="label(binding)"
            @click="capture(binding)"
            @blur="capturing === binding && stopCapture()"
          >
            {{
              capturing === binding
                ? $t('controllers.keys.press')
                : keys[binding]
                  ? keyName(keys[binding]!)
                  : '—'
            }}
          </button>
          <button
            v-if="keys[binding] && capturing !== binding"
            type="button"
            class="h-8.5 shrink-0 px-1 text-[13px] text-text-faint hover:text-text"
            :aria-label="$t('controllers.keys.clear')"
            @click="clearKey(binding)"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  </UiCard>
</template>
