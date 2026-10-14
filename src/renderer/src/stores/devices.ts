import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Controller, ControllerState, Display } from '@shared/domain'
import { call } from '../api'

export const useDevicesStore = defineStore('devices', () => {
  const controllers = ref<Controller[]>([])
  const displays = ref<Display[]>([])
  const testSlot = ref<number | null>(null)
  const testState = ref<ControllerState | null>(null)
  const loaded = ref(false)

  function setControllers(list: Controller[]): void {
    controllers.value = list
  }
  function setDisplays(list: Display[]): void {
    displays.value = list
  }
  function setTestState(state: ControllerState): void {
    if (state.slot === testSlot.value) testState.value = state
  }

  async function refresh(): Promise<void> {
    const [c, d] = await Promise.all([call('controllers:list'), call('displays:list')])
    controllers.value = c
    displays.value = d
    loaded.value = true
  }

  async function startTest(slot: number): Promise<void> {
    testSlot.value = slot
    testState.value = null
    await call('controllers:startTest', slot)
  }

  async function stopTest(): Promise<void> {
    testSlot.value = null
    testState.value = null
    await call('controllers:stopTest')
  }

  const connected = computed(() => controllers.value.filter((c) => c.connected))

  function isConnected(slot: number | null): boolean {
    return slot === null || controllers.value.some((c) => c.slot === slot && c.connected)
  }

  function display(id: string | null): Display | null {
    return id === null ? null : (displays.value.find((d) => d.id === id) ?? null)
  }

  return {
    controllers,
    displays,
    testSlot,
    testState,
    loaded,
    connected,
    setControllers,
    setDisplays,
    setTestState,
    refresh,
    startTest,
    stopTest,
    isConnected,
    display,
  }
})
