import { createPinia } from 'pinia'
import { createApp, watch } from 'vue'
import App from './App.vue'
import './assets/main.css'
import { applyLanguage, i18n } from './i18n'
import { router } from './router'
import { useBackendStore } from './stores/backend'
import { useDevicesStore } from './stores/devices'
import { useIsolationStore } from './stores/isolation'
import { useLogsStore } from './stores/logs'
import { useProfilesStore } from './stores/profiles'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'
import { subscribe } from './api'

async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia).use(router).use(i18n)

  const settings = useSettingsStore()
  const backend = useBackendStore()
  const isolation = useIsolationStore()
  const devices = useDevicesStore()
  const logs = useLogsStore()
  const profiles = useProfilesStore()
  const ui = useUiStore()

  // Device events are pushed by the main process; no polling in the renderer.
  subscribe('controllers:changed', devices.setControllers)
  subscribe('displays:changed', devices.setDisplays)
  subscribe('controllers:state', devices.setTestState)

  await settings.load()
  watch(() => settings.settings.language, applyLanguage, { immediate: true })
  isolation.applyDefaults(settings.settings)
  await Promise.all([backend.init(), isolation.init(), logs.init(), profiles.load()])
  if (backend.state?.status === 'ready') await devices.refresh().catch(() => {})

  if (!settings.settings.onboardingCompleted) ui.onboardingOpen = true
  app.mount('#app')
}

void bootstrap()
