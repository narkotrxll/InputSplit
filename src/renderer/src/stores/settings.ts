import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { Settings, SettingsPatch } from '@shared/domain'
import { call } from '../api'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(structuredClone(DEFAULT_SETTINGS))
  const loaded = ref(false)

  async function load(): Promise<void> {
    settings.value = await call('settings:get')
    loaded.value = true
  }

  async function update(patch: SettingsPatch): Promise<void> {
    const previous = settings.value
    settings.value = { ...settings.value, ...patch } // optimistic: switches feel instant
    try {
      settings.value = await call('settings:update', patch)
    } catch (error) {
      settings.value = previous
      throw error
    }
  }

  return { settings, loaded, load, update }
})
