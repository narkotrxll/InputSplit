import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UpdateState } from '@shared/domain'
import { call, errorCode, subscribe } from '../api'

export const useUpdatesStore = defineStore('updates', () => {
  const state = ref<UpdateState | null>(null)
  const error = ref<string | null>(null)

  async function init(): Promise<void> {
    subscribe('updates:changed', (next) => {
      state.value = next
    })
    state.value = await call('updates:get')
  }

  async function check(): Promise<void> {
    error.value = null
    state.value = await call('updates:check')
  }

  async function install(): Promise<void> {
    error.value = null
    try {
      await call('updates:install')
    } catch (e) {
      error.value = errorCode(e)
    }
  }

  async function openRelease(): Promise<void> {
    await call('updates:openRelease')
  }

  return { state, error, init, check, install, openRelease }
})
