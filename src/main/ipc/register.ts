/**
 * Registers every invoke channel of the IPC contract.
 *
 * For each call: (1) the sender must be our own top-level page, (2) the payload is parsed
 * with the channel's Zod schema, (3) the handler runs, (4) the result is wrapped as
 * `{ ok, data }` / `{ ok: false, error: { code, message } }` so error codes survive IPC.
 */
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import type { z } from 'zod'
import { AppException, toAppError } from '@shared/errors'
import {
  invokeContract,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type InvokeOutput,
  type IpcResult,
} from '@shared/ipc-contract'
import type { MainTexts } from '../i18n'
import type { NativeBackend } from '../native/backend'
import type { AutomationService } from '../services/automation-service'
import type { CompatHistoryService } from '../services/compat-history-service'
import type { DeviceService } from '../services/device-service'
import type { IconService } from '../services/icon-service'
import type { Logger } from '../services/logger'
import type { ProfilesService } from '../services/profiles-service'
import type { SeatsService } from '../services/seats-service'
import type { SettingsService } from '../services/settings-service'
import type { UpdateService } from '../services/update-service'
import { isTrustedSender } from './security'

export interface IpcDependencies {
  getWindow: () => BrowserWindow | null
  backend: NativeBackend
  seats: SeatsService
  devices: DeviceService
  profiles: ProfilesService
  settings: SettingsService
  icons: IconService
  logger: Logger
  texts: () => MainTexts
  automation: AutomationService
  compat: CompatHistoryService
  updates: UpdateService
}

type ParsedInput<C extends InvokeChannel> = z.output<(typeof invokeContract)[C]['input']>
type Handler<C extends InvokeChannel> = (
  input: ParsedInput<C>,
) => Promise<InvokeOutput<C>> | InvokeOutput<C>

const EXTERNAL_LINKS = {
  repository: 'https://github.com/narkotrxll/InputSplit',
  issues: 'https://github.com/narkotrxll/InputSplit/issues',
  license: 'https://github.com/narkotrxll/InputSplit/blob/main/LICENSE',
  docs: 'https://github.com/narkotrxll/InputSplit/tree/main/docs',
} as const

export function registerIpc(deps: IpcDependencies): void {
  const { backend, seats, devices, profiles, settings, icons, logger, texts } = deps
  const { automation, compat, updates } = deps

  function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<InvokeOutput<C>>> => {
      if (!isTrustedSender(event.senderFrame)) {
        logger.warn(`Rejected IPC "${channel}" from an untrusted frame`)
        return { ok: false, error: { code: 'forbidden', message: 'Untrusted sender' } }
      }
      try {
        const input = invokeContract[channel].input.parse(raw) as ParsedInput<C>
        return { ok: true, data: await handler(input) }
      } catch (error) {
        const appError = toAppError(error)
        if (appError.code === 'internalError' || appError.code === 'invalidInput') {
          logger.error(`IPC ${channel} failed: ${appError.message}`)
        }
        return { ok: false, error: appError }
      }
    })
  }

  const ok = { ok: true as const }

  handle('app:getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
  }))
  handle('app:openExternal', async (link) => {
    await shell.openExternal(EXTERNAL_LINKS[link])
    return ok
  })

  handle('backend:getState', () => backend.getState())
  handle('backend:restart', async () => {
    await seats.stopAll()
    await backend.restart()
    return ok
  })

  handle('windows:list', async () => {
    if (backend.getState().status !== 'ready') return []
    // Never offer InputSplit's own processes as targets.
    const excludePids = app.getAppMetrics().map((metric) => metric.pid)
    return (await backend.request('listWindows', { excludePids })).windows
  })
  handle('windows:icon', (exePath) => icons.get(exePath))
  handle('windows:checkTarget', (pid) => backend.request('checkTarget', { pid }))

  handle('controllers:list', () => devices.listControllers())
  handle('controllers:startTest', async (slot) => {
    await backend.request('startControllerTest', { slot })
    return ok
  })
  handle('controllers:stopTest', async () => {
    if (backend.getState().status === 'ready') await backend.request('stopControllerTest', {})
    return ok
  })

  handle('displays:list', () => devices.listDisplays())

  handle('isolation:get', () => seats.all())
  handle('isolation:start', (input) => seats.start(input))
  handle('isolation:stop', (seat) => seats.stop(seat))
  handle('isolation:dismiss', (seat) => seats.dismiss(seat))

  handle('profiles:list', () => profiles.list())
  handle('profiles:save', (input) => profiles.save(input))
  handle('profiles:delete', async (id) => {
    await profiles.delete(id)
    return ok
  })
  handle('profiles:markUsed', async (id) => {
    await profiles.markUsed(id)
    return ok
  })
  handle('profiles:play', async ({ id, launch }) => {
    await automation.play(id, launch)
    return ok
  })
  handle('profiles:pickExecutable', async () => {
    const window = deps.getWindow()
    const options = {
      title: texts().pickExeTitle,
      properties: ['openFile' as const],
      filters: [{ name: texts().pickExeFilter, extensions: ['exe'] }],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const exePath = result.filePaths[0]
    if (result.canceled || exePath === undefined) return null
    if (!/\.exe$/i.test(exePath))
      throw new AppException('invalidExecutable', 'Please choose an .exe file.')
    return { exePath, exeName: basename(exePath) }
  })

  handle('automation:get', () => automation.get())
  handle('automation:cancel', () => {
    automation.cancel()
    return ok
  })

  handle('compat:history', () => compat.get())

  handle('updates:get', () => updates.get())
  handle('updates:check', () => updates.check())
  handle('updates:install', async () => {
    await updates.install()
    return ok
  })
  handle('updates:openRelease', async () => {
    const url = updates.get().releaseUrl
    // Only our own repository's release pages, never a URL from elsewhere.
    if (url !== null && url.startsWith(`${EXTERNAL_LINKS.repository}/releases/`)) {
      await shell.openExternal(url)
    }
    return ok
  })

  handle('settings:get', () => settings.get())
  handle('settings:update', (patch) => settings.update(patch))

  handle('diagnostics:getLogs', () => logger.all())
  handle('diagnostics:openLogFolder', async () => {
    if (logger.directory !== null) await shell.openPath(logger.directory)
    return ok
  })
  handle('diagnostics:export', async () => {
    const window = deps.getWindow()
    const options = {
      title: texts().exportTitle,
      defaultPath: `inputsplit-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: texts().exportFilter, extensions: ['txt'] }],
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false }
    const report = {
      generatedAt: new Date().toISOString(),
      app: {
        version: app.getVersion(),
        electron: process.versions.electron,
        platform: process.platform,
      },
      backend: backend.getState(),
      // Window titles are personal data; only the executable name is exported.
      isolation: seats.all().map((view) => ({
        ...view,
        target: view.target ? { exeName: view.target.exeName } : null,
      })),
      settings: settings.get(),
      logs: logger
        .all()
        .map((e) => `${new Date(e.time).toISOString()} ${e.level} [${e.source}] ${e.message}`),
    }
    await writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8')
    return { saved: true }
  })
}

/** Sends an event to the renderer (if the window exists). */
export function createBroadcaster(getWindow: () => BrowserWindow | null) {
  return <E extends EventChannel>(event: E, payload: EventPayload<E>): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(event, payload)
  }
}
