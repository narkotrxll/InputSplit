/**
 * Electron hardening that applies to every window and web contents.
 */
import { app, session, type WebContents, type WebFrameMain } from 'electron'

/** URL the renderer is loaded from: the Vite dev server in development, a file otherwise. */
export function rendererDevUrl(): string | null {
  return !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null
}

export function isAppUrl(url: string): boolean {
  const devUrl = rendererDevUrl()
  if (devUrl !== null) return url.startsWith(new URL(devUrl).origin)
  return url.startsWith('file://')
}

/**
 * IPC is accepted only from the top-level frame of our own page. A sub-frame or any page
 * that somehow got loaded from elsewhere cannot call into the main process.
 */
export function isTrustedSender(frame: WebFrameMain | null | undefined): boolean {
  if (!frame || frame.parent !== null) return false
  return isAppUrl(frame.url)
}

export function hardenApp(): void {
  // No permission (camera, notifications, geolocation, …) is ever needed by the UI.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
