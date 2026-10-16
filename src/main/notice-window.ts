/**
 * Short messages on the game's screen ("Controller disconnected"), for the player on the
 * TV who does not look at the PC. A click-through, never-focused banner at the top of the
 * monitor that closes itself after a few seconds; like the FPS overlay it is visible over
 * windowed and borderless games.
 */
import { BrowserWindow, screen } from 'electron'
import type { Rect } from '@shared/domain'

const WIDTH = 560
const HEIGHT = 96
const SHOW_MS = 6000

const page = (text: string, tone: 'warn' | 'good') => `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; user-select: none; }
  div { margin: 8px auto 0; width: fit-content; max-width: ${WIDTH - 32}px; padding: 12px 20px;
    border-radius: 10px; background: rgba(8, 9, 12, 0.82); text-align: center;
    border: 1px solid ${tone === 'warn' ? 'rgba(252, 211, 77, 0.55)' : 'rgba(110, 231, 160, 0.5)'};
    font: 600 18px/1.35 "Segoe UI", system-ui, sans-serif; color: #f2f3f5;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9); }
</style></head><body><div>${escapeHtml(text)}</div></body></html>`

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

export class NoticeWindows {
  private current: BrowserWindow | null = null
  private timer: NodeJS.Timeout | null = null

  /** Shows `text` on the monitor at `monitor` (physical pixels; null: primary monitor). */
  show(monitor: Rect | null, text: string, tone: 'warn' | 'good'): void {
    this.close()
    const display =
      monitor === null
        ? screen.getPrimaryDisplay()
        : screen.getDisplayMatching(
            process.platform === 'win32' ? screen.screenToDipRect(null, monitor) : monitor,
          )
    const window = new BrowserWindow({
      x: Math.round(display.bounds.x + (display.bounds.width - WIDTH) / 2),
      y: display.bounds.y + 24,
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'InputSplit',
      webPreferences: { contextIsolation: true, sandbox: true, javascript: false, devTools: false },
    })
    window.setIgnoreMouseEvents(true)
    window.setAlwaysOnTop(true, 'screen-saver')
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed()) window.showInactive()
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(text, tone))}`)
    this.current = window
    this.timer = setTimeout(() => this.close(), SHOW_MS)
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.current !== null && !this.current.isDestroyed()) this.current.destroy()
    this.current = null
  }
}
