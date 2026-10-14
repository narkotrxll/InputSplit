import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Profile, ProfileInput } from '@shared/domain'
import { call } from '../api'

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = ref<Profile[]>([])
  const loaded = ref(false)

  async function load(): Promise<void> {
    profiles.value = await call('profiles:list')
    loaded.value = true
  }

  async function save(input: ProfileInput): Promise<Profile> {
    const saved = await call('profiles:save', input)
    await load()
    return saved
  }

  async function remove(id: string): Promise<void> {
    await call('profiles:delete', id)
    profiles.value = profiles.value.filter((p) => p.id !== id)
  }

  return { profiles, loaded, load, save, remove }
})
