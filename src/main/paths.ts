/**
 * Locations of bundled resources.
 *
 * Packaged app: native binaries and icons are copied next to `app.asar` (electron-builder
 * `extraResources`), because CreateProcess/LoadLibrary need real files on disk.
 * Development: they are taken from the repository.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export function resourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function helperExecutablePath(): string | null {
  if (app.isPackaged) return join(process.resourcesPath, 'native', 'inputsplit-helper.exe')
  const override = process.env['INPUTSPLIT_HELPER_PATH']
  if (override) return override
  const candidates = [
    join(app.getAppPath(), 'resources', 'native', 'inputsplit-helper.exe'),
    join(app.getAppPath(), 'native', 'build', 'bin', 'inputsplit-helper.exe'),
  ]
  return candidates.find((path) => existsSync(path)) ?? candidates[0] ?? null
}

export function iconPath(name: string): string {
  return join(resourcesRoot(), 'icons', name)
}
