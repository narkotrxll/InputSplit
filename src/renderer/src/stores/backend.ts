import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppInfo, BackendState } from '@shared/domain'
import { call, subscribe } from '../api'

export const useBackendStore = defineStore('backend', () => {
  const state = ref<BackendState | null>(null)
  const info = ref<AppInfo | null>(null)
  const restarting = ref(false)

  async function init(): Promise<void> {
    subscribe('backend:state', (next) => {
      state.value = next
    })
    const [current, appInfo] = await Promise.all([call('backend:getState'), call('app:getInfo')])
    state.value = current
    info.value = appInfo
  }

  async function restart(): Promise<void> {
    restarting.value = true
    try {
      await call('backend:restart')
    } finally {
      restarting.value = false
    }
  }

  return { state, info, restarting, init, restart }
})
