<script setup lang="ts">
import { Gamepad2 } from '@lucide/vue'
import type { Seat } from '@shared/domain'
import { deriveUiStatus } from '@shared/support'
import { useBackendStore } from '../stores/backend'
import { useDevicesStore } from '../stores/devices'
import { useIsolationStore } from '../stores/isolation'
import StatusPill from './StatusPill.vue'

/** "Player 1 / Player 2": which seat the dashboard shows. */
const isolation = useIsolationStore()
const backend = useBackendStore()
const devices = useDevicesStore()

function status(seat: number) {
  const state = isolation.seats[seat]!
  return deriveUiStatus({
    backend: backend.state?.status ?? 'starting',
    view: state.view,
    hasTarget: state.selection.target !== null,
    controllerConnected: devices.isConnected(state.view.controllerSlot),
  })
}

function game(seat: number): string | null {
  const state = isolation.seats[seat]!
  const target = state.view.phase === 'idle' ? state.selection.target : state.view.target
  return target ? target.title || target.exeName : null
}

function slot(seat: number): number | null {
  const state = isolation.seats[seat]!
  return state.view.phase === 'idle' ? state.selection.controllerSlot : state.view.controllerSlot
}
</script>

<template>
  <div class="grid grid-cols-2 gap-3" role="tablist" :aria-label="$t('seats.title')">
    <button
      v-for="(_, seat) in isolation.seats"
      :key="seat"
      type="button"
      role="tab"
      :aria-selected="isolation.activeSeat === seat"
      class="flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors outline-none focus-visible:border-accent/60"
      :class="
        isolation.activeSeat === seat
          ? 'border-accent/35 bg-accent-soft'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
      "
      @click="isolation.setActiveSeat(seat as Seat)"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2"
      >
        <Gamepad2 class="size-4.5 text-text-muted" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center justify-between gap-2">
          <span class="truncate text-[13.5px] font-medium text-text">{{
            $t('seats.player', { n: seat + 1 })
          }}</span>
          <StatusPill :status="status(seat)" />
        </span>
        <span class="mt-0.5 block truncate text-[12px] text-text-muted">
          {{ game(seat) ?? $t('seats.noGame') }}
          <template v-if="slot(seat) !== null">
            · {{ $t('common.slot', { n: slot(seat)! + 1 }) }}
          </template>
        </span>
      </span>
    </button>
  </div>
</template>
