/**
 * Electron main process entry point: wires services together and owns the app lifecycle.
 *
 * Shutdown order matters: stop isolation (the game returns to normal), then stop the
 * helper, then quit. Even if this sequence is interrupted, the helper's stdin closes when
 * this process dies and the fail-safe chain takes over (docs/ARCHITECTURE.md §3).
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app, nativeTheme, net, type BrowserWindow } from 'electron'
import type { IsolationView } from '@shared/domain'
import { resolveLocale } from '@shared/locales'
import { HelperClient } from './native/helper-client'
import { SimulatedBackend } from './native/simulated-backend'
import type { NativeBackend } from './native/backend'
import { createBroadcaster, registerIpc } from './ipc/register'
import { hardenApp } from './ipc/security'
import { helperExecutablePath } from './paths'
import { AutomationService } from './services/automation-service'
import { CompatHistoryService } from './services/compat-history-service'
import { DeviceService } from './services/device-service'
import { IconService } from './services/icon-service'
import { IsolationService } from './services/isolation-service'
import { Logger } from './services/logger'
import { ProfilesService } from './services/profiles-service'
import { SettingsService } from './services/settings-service'
import { UpdateService } from './services/update-service'
import { mainTexts } from './i18n'
import { Notifier } from './notifier'
import { AppTray } from './tray'
import { createMainWindow, showWindow, titleBarColors } from './window'

// Development-only stand-in for the native helper (never available in packaged builds).
const useSimulatedBackend = !app.isPackaged && process.env['INPUTSPLIT_SIMULATED_BACKEND'] === '1'
/** Passed by the Windows login item: start in the tray, not on screen. */
const startedAtLogin = process.argv.includes('--hidden')

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
  const compat = new CompatHistoryService(join(userData, 'compat-history.json'), (w) =>
    logger.warn(w),
  )
  await Promise.all([settings.load(), profiles.load(), compat.load()])
  logger.setVerbose(settings.get().verboseLogging)
  const texts = () =>
    mainTexts(resolveLocale(settings.get().language, app.getPreferredSystemLanguages()))

  const backend: NativeBackend = useSimulatedBackend
    ? new SimulatedBackend()
    : new HelperClient({ executablePath: helperExecutablePath(), logger })
  if (useSimulatedBackend) logger.warn('Using the SIMULATED backend (development only)')

  const isolation = new IsolationService(backend, logger)
  const devices = new DeviceService(backend)
  const icons = new IconService()
  const getWindow = () => mainWindow
  const broadcast = createBroadcaster(getWindow)
  const ownPids = () => app.getAppMetrics().map((metric) => metric.pid)
  const automation = new AutomationService({ backend, isolation, profiles, logger, ownPids })
  const updates = new UpdateService({
    currentVersion: app.getVersion(),
    canInstall: app.isPackaged && process.platform === 'win32',
    logger,
    // Chromium's network stack: uses the Windows proxy settings and certificate store.
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    runInstaller: async (path) => {
      // The installer replaces this app, so it must run on its own and InputSplit must quit.
      spawn(path, [], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
    },
  })
  const notifier = new Notifier({
    texts,
    enabled: () => settings.get().notifications,
    windowFocused: () =>
      mainWindow !== null &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      mainWindow.isFocused(),
    onClick: () => showWindow(mainWindow),
  })

  registerIpc({
    getWindow,
    backend,
    isolation,
    devices,
    profiles,
    settings,
    icons,
    logger,
    texts,
    automation,
    compat,
    updates,
  })

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
      setGamepadHotkey(settings.get().gamepadHotkeyEnabled)
    }
  })

  // Controller shortcut (LB + RB + View held): start or stop from the couch.
  const setGamepadHotkey = (enabled: boolean) => {
    if (backend.getState().status !== 'ready') return
    void backend
      .request('setGamepadHotkey', { enabled })
      .catch((error: unknown) => logger.warn(`Controller shortcut: ${String(error)}`))
  }
  let lastHotkeySlot: number | null = null
  let toggling = false
  backend.onEvent((event) => {
    if (event.name !== 'gamepadHotkey' || toggling || !settings.get().gamepadHotkeyEnabled) return
    lastHotkeySlot = event.data.slot
    toggling = true
    logger.info(`Controller shortcut pressed on slot ${event.data.slot + 1}`)
    void automation
      .toggle()
      .then((result) => {
        if (result === 'nothing' || result === 'failed') {
          rumble(event.data.slot, 'error')
          if (result === 'nothing') notifier.nothingToStart()
        }
      })
      .catch((error: unknown) => logger.warn(`Controller shortcut failed: ${String(error)}`))
      .finally(() => {
        toggling = false
      })
  })

  // Vibration as feedback for the player, who may not see any screen showing InputSplit.
  const rumble = (slot: number | null, pattern: 'on' | 'off' | 'error') => {
    if (slot === null || !settings.get().rumbleFeedback) return
    if (backend.getState().status !== 'ready') return
    void backend.request('rumble', { slot, pattern }).catch(() => {})
  }
  const feedbackSlot = (view: IsolationView) =>
    view.controllerSlot ?? lastHotkeySlot ?? devices.connectedSlots()[0] ?? null

  let previousView = isolation.get()
  isolation.onChange((view) => {
    broadcast('isolation:changed', view)
    tray?.update(view)
    notifier.isolationChanged(view)
    if (view.phase !== previousView.phase) {
      if (view.phase === 'running') rumble(feedbackSlot(view), 'on')
      else if (view.phase === 'ended') rumble(feedbackSlot(previousView), 'off')
    }
    previousView = view
  })
  isolation.outcomes.on(({ exeName, outcome }) => {
    void compat
      .record(exeName, outcome)
      .catch((error: unknown) => logger.warn(`Compatibility memory: ${String(error)}`))
  })
  automation.changes.on((state) => broadcast('automation:changed', state))
  compat.changes.on((history) => broadcast('compat:changed', history))
  profiles.changes.on((list) => {
    broadcast('profiles:changed', list)
    tray?.setProfiles(profiles.recent())
  })
  updates.changes.on((state) => broadcast('updates:changed', state))
  updates.found.on((version) => notifier.updateAvailable(version))
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
  // Start with Windows: only the installed app registers itself (a dev build would register
  // electron.exe).
  const applyLoginItem = (enabled: boolean) => {
    if (!app.isPackaged || process.platform !== 'win32') return
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  }
  applyLoginItem(settings.get().launchAtLogin)
  // Only the installed app checks automatically; "Check now" works everywhere.
  updates.setAutomatic(app.isPackaged && settings.get().checkForUpdates)

  let previousSettings = settings.get()
  settings.onChange((next) => {
    applyTheme(next.theme)
    logger.setVerbose(next.verboseLogging)
    tray?.refresh()
    if (backend.getState().status === 'ready') {
      void backend.setEmergencyHotkey(next.emergencyHotkeyEnabled).catch(() => {})
    }
    if (next.gamepadHotkeyEnabled !== previousSettings.gamepadHotkeyEnabled) {
      setGamepadHotkey(next.gamepadHotkeyEnabled)
    }
    if (next.launchAtLogin !== previousSettings.launchAtLogin) applyLoginItem(next.launchAtLogin)
    if (next.checkForUpdates !== previousSettings.checkForUpdates) {
      updates.setAutomatic(app.isPackaged && next.checkForUpdates)
    }
    previousSettings = next
  })

  mainWindow = createMainWindow({
    show: !settings.get().startMinimized && !startedAtLogin,
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

  tray = new AppTray(texts, {
    show: () => showWindow(mainWindow),
    playProfile: (id) => {
      void automation.play(id, true).catch((error: unknown) => {
        logger.warn(`Tray: could not play profile: ${String(error)}`)
        // The reason is shown on the dashboard (automation state).
        showWindow(mainWindow)
        broadcast('app:navigate', 'dashboard')
      })
    },
    stopIsolation: () => void isolation.stop(),
    openSettings: () => {
      showWindow(mainWindow)
      broadcast('app:navigate', 'settings')
    },
    quit: () => app.quit(),
  })
  tray.setProfiles(profiles.recent())

  app.on('before-quit', (event) => {
    quitting = true
    if (shutdownDone) return
    event.preventDefault()
    void (async () => {
      try {
        automation.stopWatching()
        automation.cancel()
        updates.dispose()
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
  automation.startWatching()
}
