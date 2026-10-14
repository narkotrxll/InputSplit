/**
 * What InputSplit knows about a game before it is started: the built-in list (launchers,
 * online games) and how it went the last time on this PC.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { lookupCompat, type CompatEntry } from '@shared/compatibility'
import type { CompatHistory, CompatRecord } from '@shared/domain'
import { call, subscribe } from '../api'

export const useCompatStore = defineStore('compat', () => {
  const history = ref<CompatHistory>({})

  async function init(): Promise<void> {
    subscribe('compat:changed', (next) => {
      history.value = next
    })
    history.value = await call('compat:history')
  }

  function entry(exeName: string): CompatEntry | null {
    return lookupCompat(exeName)
  }

  function lastTime(exeName: string): CompatRecord | null {
    return history.value[exeName.toLowerCase()] ?? null
  }

  return { history, init, entry, lastTime }
})
