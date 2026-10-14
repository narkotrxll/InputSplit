/** Profiles started by InputSplit itself ("Play", automatic start, controller shortcut). */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AutomationState } from '@shared/domain'
import { call, subscribe } from '../api'

export const useAutomationStore = defineStore('automation', () => {
  const state = ref<AutomationState>({
    phase: 'idle',
    profileId: null,
    profileName: null,
    error: null,
  })

  async function init(): Promise<void> {
    subscribe('automation:changed', (next) => {
      state.value = next
    })
    state.value = await call('automation:get')
  }

  /** Errors are shown from the state (also for starts from the tray), not thrown here. */
  async function play(profileId: string, launch: boolean): Promise<void> {
    await call('profiles:play', { id: profileId, launch }).catch(() => {})
  }

  async function cancel(): Promise<void> {
    await call('automation:cancel')
  }

  return { state, init, play, cancel }
})
