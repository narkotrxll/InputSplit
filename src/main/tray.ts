/**
 * System tray: InputSplit keeps running here while a game is isolated, so the window can
 * be closed without stopping anything. The menu always offers "Stop isolation".
 */
import { Menu, nativeImage, Tray } from 'electron'
import type { IsolationView } from '@shared/domain'
import { isSessionLive } from '@shared/support'
import { iconPath } from './paths'

export interface TrayActions {
  show: () => void
  stopIsolation: () => void
  openSettings: () => void
  quit: () => void
}

export class AppTray {
  private readonly tray: Tray
  private readonly idleIcon = nativeImage.createFromPath(iconPath('tray.png'))
  private readonly activeIcon = nativeImage.createFromPath(iconPath('tray-active.png'))
  private view: IsolationView | null = null

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.idleIcon)
    this.tray.on('click', () => actions.show())
    this.tray.on('double-click', () => actions.show())
    this.update(null)
  }

  update(view: IsolationView | null): void {
    this.view = view
    const live = view !== null && isSessionLive(view)
    const game = view?.target?.exeName ?? null
    this.tray.setImage(live ? this.activeIcon : this.idleIcon)
    this.tray.setToolTip(live && game ? `InputSplit — isolating ${game}` : 'InputSplit')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: live && game ? `Isolating ${game}` : 'Not isolating', enabled: false },
        { type: 'separator' },
        { label: 'Open InputSplit', click: () => this.actions.show() },
        { label: 'Stop isolation', enabled: live, click: () => this.actions.stopIsolation() },
        { label: 'Settings', click: () => this.actions.openSettings() },
        { type: 'separator' },
        { label: 'Quit InputSplit', click: () => this.actions.quit() },
      ]),
    )
  }

  notifyStillRunning(): void {
    // Windows balloon notification; silently ignored on other platforms.
    this.tray.displayBalloon?.({
      title: 'InputSplit is still running',
      content:
        this.view && isSessionLive(this.view)
          ? 'The game stays isolated. Use the tray icon to open InputSplit or stop isolation.'
          : 'InputSplit keeps running in the notification area.',
      iconType: 'info',
    })
  }

  destroy(): void {
    this.tray.destroy()
  }
}
