import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { WindowInfo } from '@shared/domain'
import { call, errorCode } from '../api'

export const useWindowsStore = defineStore('windows', () => {
  const windows = ref<WindowInfo[]>([])
  const loading = ref(false)
  const loadedOnce = ref(false)
  const error = ref<string | null>(null)
  const icons = ref<Record<string, string | null>>({})
  let pending: Promise<void> | null = null

  /** Refreshes on demand (never on a timer): page open, window focus, refresh button. */
  function refresh(): Promise<void> {
    if (pending) return pending
    loading.value = true
    pending = call('windows:list')
      .then((list) => {
        windows.value = list
        error.value = null
        for (const w of list) if (w.exePath) void loadIcon(w.exePath)
      })
      .catch((e: unknown) => {
        error.value = errorCode(e)
      })
      .finally(() => {
        loading.value = false
        loadedOnce.value = true
        pending = null
      })
    return pending
  }

  async function loadIcon(exePath: string): Promise<void> {
    const key = exePath.toLowerCase()
    if (key in icons.value) return
    icons.value[key] = null
    try {
      icons.value[key] = await call('windows:icon', exePath)
    } catch {
      icons.value[key] = null
    }
  }

  function iconFor(exePath: string | null): string | null {
    return exePath ? (icons.value[exePath.toLowerCase()] ?? null) : null
  }

  const games = computed(() => windows.value.filter((w) => w.isLikelyGame))

  function isOpen(pid: number, hwnd: number): boolean {
    return windows.value.some((w) => w.pid === pid && w.hwnd === hwnd)
  }

  return { windows, games, loading, loadedOnce, error, refresh, loadIcon, iconFor, isOpen }
})
