/**
 * Electron main process entry point: wires services together and owns the app lifecycle.
 *
 * Shutdown order matters: stop isolation (the game returns to normal), then stop the
 * helper, then quit. Even if this sequence is interrupted, the helper's stdin closes when
 * this process dies and the fail-safe chain takes over (docs/ARCHITECTURE.md §3).
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app, dialog, nativeTheme, net, type BrowserWindow } from 'electron'
import { controllerAlerts, type ControllerAlert } from '@shared/controller-alerts'
import type { Controller, IsolationView } from '@shared/domain'
import { resolveLocale } from '@shared/locales'
import { isDefaultTuning, toHelperTuning } from '@shared/tuning'
import { isSessionLive } from '@shared/support'
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
import type { RiskInfo } from './services/isolation-service'
import { LibraryService } from './services/library-service'
import { PlaytimeService } from './services/playtime-service'
import { SeatsService } from './services/seats-service'
import { Logger } from './services/logger'
import { ProfilesService } from './services/profiles-service'
import { SettingsService } from './services/settings-service'
import { UpdateService } from './services/update-service'
import { mainTexts } from './i18n'
import { Notifier } from './notifier'
import { NoticeWindows } from './notice-window'
import { OverlayWindows } from './overlay-window'
import { OverlayService } from './services/overlay-service'
import { GameBarGuard, windowsGameBarSetting } from './services/game-bar-guard'
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
/** Windows is logging off or shutting down: no update is started then. */
let sessionEnding = false
/** "Restart and update" was clicked. */
let installOnExit: { path: string; relaunch: boolean } | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('io.github.narkotrxll.inputsplit')
  app.on('second-instance', () => showWindow(mainWindow))
  void app.whenReady().then(main)
}

/**
 * Runs a downloaded update as InputSplit exits: silently (`/S`) into the existing install
 * folder, and starting the new version afterwards after "Restart and update".
 */
function startPendingUpdate(updates: UpdateService, logger: Logger): void {
  const pending =
    installOnExit ?? (sessionEnding ? null : { path: updates.readyInstaller(), relaunch: false })
  if (!pending?.path) return
  const args = ['/S', '--updated', ...(pending.relaunch ? ['--force-run'] : [])]
  try {
    const child = spawn(pending.path, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    logger.info(`Installing the update (${pending.relaunch ? 'restart' : 'on exit'})`)
  } catch (error) {
    logger.error(`Could not start the update: ${String(error)}`)
  }
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
  const playtime = new PlaytimeService(join(userData, 'playtime.json'), (w) => logger.warn(w))
  await Promise.all([settings.load(), profiles.load(), compat.load(), playtime.load()])
  logger.setVerbose(settings.get().verboseLogging)
  const texts = () =>
    mainTexts(resolveLocale(settings.get().language, app.getPreferredSystemLanguages()))

  const backend: NativeBackend = useSimulatedBackend
    ? new SimulatedBackend()
    : new HelperClient({ executablePath: helperExecutablePath(), logger })
  if (useSimulatedBackend) logger.warn('Using the SIMULATED backend (development only)')

  /** Asked before every online or anti-cheat game while anti-cheat protection is off. */
  const confirmRisk = async ({ game, antiCheat }: RiskInfo): Promise<boolean> => {
    const t = texts()
    const options = {
      type: 'warning' as const,
      title: t.riskTitle,
      message: t.riskMessage.replace('{game}', game),
      detail: [antiCheat ? t.riskAntiCheat.replace('{name}', antiCheat) : '', t.riskDetail]
        .filter(Boolean)
        .join('\n\n'),
      buttons: [t.riskCancel, t.riskContinue],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }
    // A hidden window (tray, automatic start) would hide its modal dialog too.
    const parent = mainWindow?.isVisible() ? mainWindow : null
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    return response === 1
  }
  const seats = new SeatsService(
    backend,
    logger,
    () => settings.get().twoPlayers,
    { protection: () => settings.get().antiCheatProtection, confirmRisk },
    Date.now,
    () => settings.get().gameAudioToDisplay,
  )
  const devices = new DeviceService(backend)
  const icons = new IconService()
  const library = new LibraryService(logger, useSimulatedBackend)
  const getWindow = () => mainWindow
  const broadcast = createBroadcaster(getWindow)
  const ownPids = () => app.getAppMetrics().map((metric) => metric.pid)
  const automation = new AutomationService({ backend, seats, profiles, logger, ownPids })
  const overlay = new OverlayService({
    backend,
    seats,
    screen: new OverlayWindows(),
    texts,
    logger,
  })
  const updates = new UpdateService({
    currentVersion: app.getVersion(),
    canInstall: app.isPackaged && process.platform === 'win32',
    logger,
    // Chromium's network stack: uses the Windows proxy settings and certificate store.
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    runInstaller: async (path) => {
      // The installer replaces this app, so it runs once InputSplit has shut down.
      installOnExit = { path, relaunch: true }
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
    seats,
    devices,
    profiles,
    settings,
    icons,
    logger,
    texts,
    automation,
    compat,
    updates,
    library,
    playtime,
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
      setOverlayHotkey(settings.get().overlayHotkeyEnabled)
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
      .toggle(event.data.slot)
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

  // Overlay shortcut (LB + RB + Menu held): FPS and input latency on the game's screen.
  const setOverlayHotkey = (enabled: boolean) => {
    if (backend.getState().status !== 'ready') return
    void backend
      .request('setOverlayHotkey', { enabled })
      .catch((error: unknown) => logger.warn(`Overlay shortcut: ${String(error)}`))
  }
  backend.onEvent((event) => {
    if (event.name !== 'overlayHotkey' || !settings.get().overlayHotkeyEnabled) return
    const { slot } = event.data
    void overlay
      .toggle(slot)
      .then((result) => rumble(slot, result === 'nothing' ? 'error' : result))
      .catch((error: unknown) => logger.warn(`Overlay shortcut failed: ${String(error)}`))
  })

  // Vibration as feedback for the player, who may not see any screen showing InputSplit.
  const rumble = (slot: number | null, pattern: 'on' | 'off' | 'error') => {
    if (slot === null || !settings.get().rumbleFeedback) return
    if (backend.getState().status !== 'ready') return
    void backend.request('rumble', { slot, pattern }).catch(() => {})
  }
  const feedbackSlot = (view: IsolationView) =>
    view.controllerSlot ?? lastHotkeySlot ?? devices.connectedSlots()[0] ?? null

  // Dead zones and button remapping (Controllers page), sent to each game that starts.
  const sendTuning = (view: IsolationView, evenIfDefault: boolean) => {
    const tuning = settings.get().gamepadTuning
    if (view.phase !== 'running' || view.sessionId === null) return
    if (!evenIfDefault && isDefaultTuning(tuning)) return
    void backend
      .request('setTuning', { sessionId: view.sessionId, ...toHelperTuning(tuning) })
      .catch((error: unknown) => logger.warn(`Controller tuning: ${String(error)}`))
  }
  const gameBar = new GameBarGuard(
    windowsGameBarSetting,
    join(userData, 'gamebar-restore.json'),
    (w) => logger.warn(w),
  )
  const syncGameBar = () => {
    if (process.platform !== 'win32') return Promise.resolve()
    return gameBar.set(settings.get().blockGameBarButton && seats.all().some(isSessionLive))
  }
  if (process.platform === 'win32') void gameBar.recover()

  const previousViews = seats.all()
  const updateTray = () => tray?.update(seats.all(), seats.freeSeat() !== null)
  seats.changes.on(({ seat, view }) => {
    broadcast('isolation:changed', { seat, view })
    updateTray()
    notifier.isolationChanged(seat, view)
    const previousView = previousViews[seat]!
    // Play time: counted from the start of isolation until it stops for any reason.
    if (
      previousView.phase === 'running' &&
      view.phase !== 'running' &&
      previousView.startedAt !== null &&
      previousView.target !== null
    ) {
      void playtime
        .record(previousView.target.exeName, Date.now() - previousView.startedAt)
        .catch((error: unknown) => logger.warn(`Play time: ${String(error)}`))
    }
    if (view.phase !== previousView.phase) {
      if (view.phase === 'running') {
        rumble(feedbackSlot(view), 'on')
        sendTuning(view, false)
      } else if (view.phase === 'ended') rumble(feedbackSlot(previousView), 'off')
    }
    previousViews[seat] = view
    void syncGameBar()
  })
  seats.outcomes.on(({ exeName, outcome }) => {
    void compat
      .record(exeName, outcome)
      .catch((error: unknown) => logger.warn(`Compatibility memory: ${String(error)}`))
  })
  automation.changes.on((state) => broadcast('automation:changed', state))
  compat.changes.on((history) => broadcast('compat:changed', history))
  playtime.changes.on((games) => broadcast('playtime:changed', games))
  profiles.changes.on((list) => {
    broadcast('profiles:changed', list)
    tray?.setProfiles(profiles.recent())
  })
  updates.changes.on((state) => broadcast('updates:changed', state))
  updates.found.on(({ version, ready }) =>
    ready ? notifier.updateReady(version) : notifier.updateAvailable(version),
  )
  devices.controllersChanged.on((list) => broadcast('controllers:changed', list))

  // A controller of a running game disconnects, comes back or runs low: say so on the game's
  // screen (the player there does not look at the PC) and in a Windows notification.
  const notices = new NoticeWindows()
  let lastControllers: Controller[] = []
  const showControllerAlert = async (view: IsolationView, alert: ControllerAlert) => {
    const t = texts()
    const template = {
      disconnected: t.noticeDisconnected,
      reconnected: t.noticeReconnected,
      lowBattery: t.noticeLowBattery,
    }[alert.kind]
    const text = template.replace('{n}', String(alert.slot + 1))
    let monitor = null
    if (view.target !== null) {
      monitor = await backend
        .request('windowMonitor', { hwnd: view.target.hwnd })
        .then((r) => r.bounds)
        .catch(() => null)
    }
    notices.show(monitor, text, alert.kind === 'reconnected' ? 'good' : 'warn')
    notifier.controllerAlert(text, view)
  }
  devices.controllersChanged.on((list) => {
    const previous = lastControllers
    lastControllers = list
    if (!settings.get().controllerAlerts) return
    const running = seats.all().filter((view) => view.phase === 'running')
    if (running.length === 0) return
    const watched = new Set<number>()
    for (const view of running) {
      if (view.controllerSlot !== null) watched.add(view.controllerSlot)
      else for (const c of previous) if (c.connected) watched.add(c.slot)
    }
    for (const alert of controllerAlerts(previous, list, watched)) {
      const view = running.find((v) => v.controllerSlot === alert.slot) ?? running[0]!
      void showControllerAlert(view, alert)
    }
  })
  devices.displaysChanged.on((list) => broadcast('displays:changed', list))
  devices.controllerState.on((state) => broadcast('controllers:state', state))
  devices.pollingRate.on((rate) => broadcast('controllers:pollingRate', rate))
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
    if (next.twoPlayers !== previousSettings.twoPlayers) updateTray()
    else tray?.refresh()
    if (backend.getState().status === 'ready') {
      void backend.setEmergencyHotkey(next.emergencyHotkeyEnabled).catch(() => {})
    }
    if (next.gamepadHotkeyEnabled !== previousSettings.gamepadHotkeyEnabled) {
      setGamepadHotkey(next.gamepadHotkeyEnabled)
    }
    if (next.overlayHotkeyEnabled !== previousSettings.overlayHotkeyEnabled) {
      setOverlayHotkey(next.overlayHotkeyEnabled)
      if (!next.overlayHotkeyEnabled) overlay.closeAll()
    }
    if (JSON.stringify(next.gamepadTuning) !== JSON.stringify(previousSettings.gamepadTuning)) {
      for (const view of seats.all()) sendTuning(view, true)
    }
    if (next.blockGameBarButton !== previousSettings.blockGameBarButton) void syncGameBar()
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
  mainWindow.on('session-end', () => {
    sessionEnding = true
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
    stopIsolation: () => void seats.stopAll(),
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
        overlay.closeAll()
        notices.close()
        await seats.stopAll()
        await syncGameBar()
        await backend.stop()
      } catch (error) {
        logger.error(`Shutdown problem: ${String(error)}`)
      } finally {
        shutdownDone = true
        startPendingUpdate(updates, logger)
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
