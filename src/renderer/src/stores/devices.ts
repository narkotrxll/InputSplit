import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  Controller,
  ControllerState,
  Display,
  GamepadModel,
  PollingRate,
} from '@shared/domain'
import { GAMEPAD_MODELS } from '@shared/gamepad-models'
import { call } from '../api'

const LOOKS_KEY = 'inputsplit.gamepadLooks'

/** Look chosen by hand per slot, for when detection guesses wrong. Kept in this browser only. */
function loadLooks(): Record<number, GamepadModel> {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOKS_KEY) ?? '{}') as Record<string, unknown>
    const out: Record<number, GamepadModel> = {}
    for (const [slot, model] of Object.entries(raw)) {
      if ((GAMEPAD_MODELS as readonly unknown[]).includes(model))
        out[Number(slot)] = model as GamepadModel
    }
    return out
  } catch {
    return {}
  }
}

export const useDevicesStore = defineStore('devices', () => {
  const controllers = ref<Controller[]>([])
  const displays = ref<Display[]>([])
  const testSlot = ref<number | null>(null)
  const testState = ref<ControllerState | null>(null)
  const loaded = ref(false)
  /** Controller test: the last polling-rate result, or 'measuring'. */
  const pollingRate = ref<{ slot: number; value: number | null | 'measuring' } | null>(null)
  const looks = ref<Record<number, GamepadModel>>(loadLooks())
  /** Running programs that change controller input (ids from input-tools.ts). */
  const inputTools = ref<string[]>([])

  /** What the test view draws for a slot: the hand-picked look, else the detected one. */
  function lookOf(slot: number): GamepadModel {
    return looks.value[slot] ?? controllers.value.find((c) => c.slot === slot)?.model ?? 'xbox'
  }

  function setLook(slot: number, model: GamepadModel | 'auto'): void {
    const next = { ...looks.value }
    if (model === 'auto') delete next[slot]
    else next[slot] = model
    looks.value = next
    try {
      localStorage.setItem(LOOKS_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: the choice lasts until the app closes.
    }
  }

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

  async function refreshInputTools(): Promise<void> {
    inputTools.value = await call('controllers:inputTools')
  }

  function setPollingRate(rate: PollingRate): void {
    pollingRate.value = { slot: rate.slot, value: rate.updatesPerSecond }
  }

  async function measurePollingRate(slot: number): Promise<void> {
    pollingRate.value = { slot, value: 'measuring' }
    await call('controllers:measureRate', slot)
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
    looks,
    pollingRate,
    setPollingRate,
    measurePollingRate,
    inputTools,
    connected,
    setControllers,
    setDisplays,
    setTestState,
    refresh,
    refreshInputTools,
    startTest,
    stopTest,
    isConnected,
    display,
    lookOf,
    setLook,
  }
})
