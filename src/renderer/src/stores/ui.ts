import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  body?: string
  action?: { label: string; run: () => void }
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const diagnosticsOpen = ref(false)
  const onboardingOpen = ref(false)
  const reportOpen = ref(false)
  let nextId = 1

  function toast(input: Omit<Toast, 'id'>, durationMs = 4500): void {
    const id = nextId++
    toasts.value = [...toasts.value.slice(-3), { ...input, id }]
    window.setTimeout(() => dismissToast(id), durationMs)
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, diagnosticsOpen, onboardingOpen, reportOpen, toast, dismissToast }
})
