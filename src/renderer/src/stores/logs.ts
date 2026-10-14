import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LogEntry } from '@shared/domain'
import { call, subscribe } from '../api'

const LIMIT = 500

export const useLogsStore = defineStore('logs', () => {
  const entries = ref<LogEntry[]>([])

  async function init(): Promise<void> {
    subscribe('log:entry', (entry) => {
      entries.value = [...entries.value.slice(-(LIMIT - 1)), entry]
    })
    entries.value = (await call('diagnostics:getLogs')).slice(-LIMIT)
  }

  return { entries, init }
})
