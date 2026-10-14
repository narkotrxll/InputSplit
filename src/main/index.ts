/**
 * Electron main process entry point: wires services together and owns the app lifecycle.
 *
 * Shutdown order matters: stop isolation (the game returns to normal), then stop the
 * helper, then quit. Even if this sequence is interrupted, the helper's stdin closes when
 * this process dies and the fail-safe chain takes over (docs/ARCHITECTURE.md §3).
 */
import { join } from 'node:path'
import { app, nativeTheme, type BrowserWindow } from 'electron'
import { HelperClient } from './native/helper-client'
import { SimulatedBackend } from './native/simulated-backend'
import type { NativeBackend } from './native/backend'
import { createBroadcaster, registerIpc } from './ipc/register'
import { hardenApp } from './ipc/security'
import { helperExecutablePath } from './paths'
import { DeviceService } from './services/device-service'
import { IconService } from './services/icon-service'
import { IsolationService } from './services/isolation-service'
import { Logger } from './services/logger'
import { ProfilesService } from './services/profiles-service'
import { SettingsService } from './services/settings-service'
import { AppTray } from './tray'
import { createMainWindow, showWindow, titleBarColors } from './window'

// Development-only stand-in for the native helper (never available in packaged builds).
const useSimulatedBackend = !app.isPackaged && process.env['INPUTSPLIT_SIMULATED_BACKEND'] === '1'

let mainWindow: BrowserWindow | null = null
let tray: AppTray | null = null
let quitting = false
let shutdownDone = false
let trayHintShown = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('io.github.narkotrxll.inputsplit')
  app.on('second-instance', () => showWindow(mainWindow))
  void app.whenReady().then(main)
}

async function main(): Promise<void> {
  hardenApp()
  const userData = app.getPath('userData')
  const logger = new Logger(join(userData, 'logs'))
  logger.info(`InputSplit ${app.getVersion()} starting (Electron ${process.versions.electron})`)

  const settings = new SettingsService(join(userData, 'settings.json'), (w) => logger.warn(w))
  const profiles = new ProfilesService(join(userData, 'profiles.json'), (w) => logger.warn(w))
  await Promise.all([settings.load(), profiles.load()])
  logger.setVerbose(settings.get().verboseLogging)

  const backend: NativeBackend = useSimulatedBackend
    ? new SimulatedBackend()
    : new HelperClient({ executablePath: helperExecutablePath(), logger })
  if (useSimulatedBackend) logger.warn('Using the SIMULATED backend (development only)')

  const isolation = new IsolationService(backend, logger)
  const devices = new DeviceService(backend)
  const icons = new IconService()
  const getWindow = () => mainWindow
  const broadcast = createBroadcaster(getWindow)

  registerIpc({ getWindow, backend, isolation, devices, profiles, settings, icons, logger })

  let previousStatus = backend.getState().status
  backend.onState((state) => {
    broadcast('backend:state', state)
    const becameReady = state.status === 'ready' && previousStatus !== 'ready'
    previousStatus = state.status
    // Only on the transition: registering the hotkey itself updates the state.
    if (becameReady) {
      void backend
        .setEmergencyHotkey(settings.get().emergencyHotkeyEnabled)
        .catch((error: unknown) => logger.warn(`Emergency hotkey: ${String(error)}`))
    }
  })
  isolation.onChange((view) => {
    broadcast('isolation:changed', view)
    tray?.update(view)
  })
  devices.controllersChanged.on((list) => broadcast('controllers:changed', list))
  devices.displaysChanged.on((list) => broadcast('displays:changed', list))
  devices.controllerState.on((state) => broadcast('controllers:state', state))
  logger.onEntry((entry) => broadcast('log:entry', entry))
  const applyTheme = (theme: 'dark' | 'light' | 'system') => {
    nativeTheme.themeSource = theme
    if (mainWindow && !mainWindow.isDestroyed() && process.platform !== 'darwin') {
      mainWindow.setTitleBarOverlay({
        ...titleBarColors(nativeTheme.shouldUseDarkColors),
        height: 40,
      })
    }
  }
  nativeTheme.themeSource = settings.get().theme
  nativeTheme.on('updated', () => applyTheme(settings.get().theme))
  settings.onChange((next) => {
    applyTheme(next.theme)
    logger.setVerbose(next.verboseLogging)
    if (backend.getState().status === 'ready') {
      void backend.setEmergencyHotkey(next.emergencyHotkeyEnabled).catch(() => {})
    }
  })

  mainWindow = createMainWindow({
    show: !settings.get().startMinimized,
    dark: nativeTheme.shouldUseDarkColors,
  })
  mainWindow.on('close', (event) => {
    if (quitting || !settings.get().closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
    if (!trayHintShown) {
      tray?.notifyStillRunning()
      trayHintShown = true
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  tray = new AppTray({
    show: () => showWindow(mainWindow),
    stopIsolation: () => void isolation.stop(),
    openSettings: () => {
      showWindow(mainWindow)
      broadcast('app:navigate', 'settings')
    },
    quit: () => app.quit(),
  })

  app.on('before-quit', (event) => {
    quitting = true
    if (shutdownDone) return
    event.preventDefault()
    void (async () => {
      try {
        await isolation.stop()
        await backend.stop()
      } catch (error) {
        logger.error(`Shutdown problem: ${String(error)}`)
      } finally {
        shutdownDone = true
        logger.info('InputSplit stopped')
        logger.close()
        tray?.destroy()
        app.quit()
      }
    })()
  })

  // Keep running in the tray when every window is closed (closeToTray); otherwise quit.
  app.on('window-all-closed', () => {
    if (!settings.get().closeToTray) app.quit()
  })

  await backend.start()
}
