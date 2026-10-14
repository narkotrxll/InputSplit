/** How long each game was played with InputSplit (recorded in the main process). */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Playtime, PlaytimeRecord } from '@shared/domain'
import { call, subscribe } from '../api'

export const usePlaytimeStore = defineStore('playtime', () => {
  const games = ref<Playtime>({})

  async function init(): Promise<void> {
    subscribe('playtime:changed', (next) => {
      games.value = next
    })
    games.value = await call('playtime:get')
  }

  function forExe(exeName: string): PlaytimeRecord | null {
    return games.value[exeName.toLowerCase()] ?? null
  }

  return { games, init, forExe }
})
