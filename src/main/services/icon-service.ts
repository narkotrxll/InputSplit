/**
 * Application icons for the window list, extracted by Electron from the executable
 * (`app.getFileIcon`) in the main process and cached, so the renderer never touches files.
 */
import { existsSync } from 'node:fs'
import { app } from 'electron'

const WINDOWS_ABSOLUTE_EXE = /^[a-zA-Z]:\\[^\0<>"|?*]+\.exe$/i

export class IconService {
  private readonly cache = new Map<string, Promise<string | null>>()

  get(exePath: string): Promise<string | null> {
    // Missing files would give a generic icon; the UI shows a monogram instead.
    if (!WINDOWS_ABSOLUTE_EXE.test(exePath) || !existsSync(exePath)) return Promise.resolve(null)
    const key = exePath.toLowerCase()
    let icon = this.cache.get(key)
    if (icon === undefined) {
      icon = app
        .getFileIcon(exePath, { size: 'large' })
        .then((image) => (image.isEmpty() ? null : image.toDataURL()))
        .catch(() => null)
      this.cache.set(key, icon)
    }
    return icon
  }
}
