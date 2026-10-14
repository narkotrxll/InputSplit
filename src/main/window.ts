import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeImage } from 'electron'
import { iconPath } from './paths'
import { rendererDevUrl } from './ipc/security'

const BACKGROUND = '#0b0c0f'

/** Colours of the native caption buttons, matched to the UI theme. */
export function titleBarColors(dark: boolean): { color: string; symbolColor: string } {
  return dark
    ? { color: BACKGROUND, symbolColor: '#a3a6ad' }
    : { color: '#f6f7f9', symbolColor: '#4b5059' }
}

export function createMainWindow(options: { show: boolean; dark: boolean }): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'InputSplit',
    backgroundColor: titleBarColors(options.dark).color,
    icon: nativeImage.createFromPath(iconPath('icon.png')),
    // Our own title bar with native Windows caption buttons (keeps Snap Layouts working).
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBarColors(options.dark), height: 40 },
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })

  window.once('ready-to-show', () => {
    if (options.show) window.show()
  })

  const devUrl = rendererDevUrl()
  if (devUrl !== null) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }
  return window
}

export function showWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
