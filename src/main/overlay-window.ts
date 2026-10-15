/**
 * The FPS overlay windows: one small, transparent, click-through window per player, in the
 * top-left corner of the monitor that shows the game. They never take focus, so the game
 * and the desktop user's window both keep theirs.
 *
 * A game in exclusive fullscreen covers every window; the overlay is visible over windowed
 * and borderless games.
 */
import { BrowserWindow, screen } from 'electron'
import type { Rect, Seat } from '@shared/domain'
import type { OverlayContent, OverlayScreen } from './services/overlay-service'

const WIDTH = 340
const HEIGHT = 180
const MARGIN = 16

// No preload and no IPC: main pushes each refresh with executeJavaScript, and the page only
// sets textContent (nothing it receives is parsed as HTML).
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; background: transparent; overflow: hidden; user-select: none; }
  #panel { display: none; position: absolute; left: 0; top: 0; max-width: ${WIDTH - 2}px;
    padding: 8px 12px; border-radius: 8px; background: rgba(8, 9, 12, 0.72);
    font: 600 15px/1.45 "Segoe UI", system-ui, sans-serif; color: #f2f3f5;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9); }
  .row { display: flex; gap: 10px; white-space: nowrap; }
  .label { color: #a9adb6; font-weight: 500; }
  .good { color: #6ee7a0; } .warn { color: #fcd34d; } .bad { color: #fb7185; }
  #note { margin-top: 3px; font: 400 11px/1.3 "Segoe UI", system-ui, sans-serif; color: #8d929c;
    white-space: normal; }
</style></head>
<body><div id="panel"><div id="rows"></div><div id="note"></div></div>
<script>
  window.render = (content) => {
    const rows = document.getElementById('rows')
    rows.replaceChildren(...content.lines.map((line) => {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = line.label
      const value = document.createElement('span')
      if (line.tone) value.className = line.tone
      value.textContent = line.value
      row.append(label, value)
      return row
    }))
    document.getElementById('note').textContent = content.note
    document.getElementById('panel').style.display = 'block'
  }
</script></body></html>`

interface OverlayWindow {
  window: BrowserWindow
  loaded: boolean
  pending: OverlayContent | null
}

export class OverlayWindows implements OverlayScreen {
  private readonly windows = new Map<Seat, OverlayWindow>()

  show(seat: Seat, monitor: Rect | null): number | null {
    const display =
      monitor === null
        ? screen.getPrimaryDisplay()
        : screen.getDisplayMatching(
            // The helper reports physical pixels; Electron places windows in DIPs.
            process.platform === 'win32' ? screen.screenToDipRect(null, monitor) : monitor,
          )
    const entry = this.windows.get(seat) ?? this.create(seat)
    entry.window.setBounds({
      x: display.bounds.x + MARGIN,
      y: display.bounds.y + MARGIN,
      width: WIDTH,
      height: HEIGHT,
    })
    // Re-asserted every time: a borderless game may put itself on top as well.
    entry.window.setAlwaysOnTop(true, 'screen-saver')
    if (!entry.window.isVisible()) entry.window.showInactive()
    return display.displayFrequency > 0 ? display.displayFrequency : null
  }

  update(seat: Seat, content: OverlayContent): void {
    const entry = this.windows.get(seat)
    if (entry === undefined || entry.window.isDestroyed()) return
    if (!entry.loaded) {
      entry.pending = content
      return
    }
    void entry.window.webContents
      .executeJavaScript(`window.render(${JSON.stringify(content)})`)
      .catch(() => {})
  }

  hide(seat: Seat): void {
    const entry = this.windows.get(seat)
    this.windows.delete(seat)
    if (entry !== undefined && !entry.window.isDestroyed()) entry.window.destroy()
  }

  private create(seat: Seat): OverlayWindow {
    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'InputSplit FPS',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        devTools: false,
        backgroundThrottling: false,
      },
    })
    window.setIgnoreMouseEvents(true)
    window.setMenu(null)
    const entry: OverlayWindow = { window, loaded: false, pending: null }
    window.webContents.once('did-finish-load', () => {
      entry.loaded = true
      if (entry.pending !== null) this.update(seat, entry.pending)
      entry.pending = null
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    this.windows.set(seat, entry)
    return entry
  }
}
