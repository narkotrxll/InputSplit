<script setup lang="ts">
import { TooltipProvider } from 'reka-ui'
import { onBeforeUnmount, onMounted, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import AppTitleBar from './components/AppTitleBar.vue'
import BackendBanner from './components/BackendBanner.vue'
import DiagnosticsDrawer from './components/DiagnosticsDrawer.vue'
import OnboardingDialog from './components/OnboardingDialog.vue'
import ReportProblemDialog from './components/ReportProblemDialog.vue'
import ToastHost from './components/ToastHost.vue'
import { subscribe } from './api'
import { useSettingsStore } from './stores/settings'

const router = useRouter()
const settings = useSettingsStore()

// Theme: explicit choice, or follow Windows.
const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => {
  const theme = settings.settings.theme
  const dark = theme === 'dark' || (theme === 'system' && media.matches)
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light'
}
watchEffect(applyTheme)
media.addEventListener('change', applyTheme)

const pages = ['/', '/applications', '/controllers', '/profiles', '/settings', '/about']
function onKeydown(event: KeyboardEvent): void {
  if (!event.ctrlKey || event.altKey || event.shiftKey) return
  const index = Number(event.key) - 1
  const page = pages[index]
  if (page !== undefined) {
    event.preventDefault()
    void router.push(page)
  }
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  unsubscribe = subscribe('app:navigate', (page) => {
    void router.push(page === 'dashboard' ? '/' : `/${page}`)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  media.removeEventListener('change', applyTheme)
  unsubscribe?.()
})
</script>

<template>
  <TooltipProvider>
    <div class="flex h-full flex-col">
      <AppTitleBar />
      <BackendBanner />
      <div class="flex min-h-0 flex-1">
        <AppSidebar />
        <main class="min-w-0 flex-1 overflow-y-auto">
          <div class="mx-auto max-w-[1120px] px-8 pt-7 pb-12">
            <RouterView v-slot="{ Component }">
              <Transition name="page" mode="out-in">
                <component :is="Component" />
              </Transition>
            </RouterView>
          </div>
        </main>
      </div>
    </div>
    <OnboardingDialog />
    <DiagnosticsDrawer />
    <ReportProblemDialog />
    <ToastHost />
  </TooltipProvider>
</template>
