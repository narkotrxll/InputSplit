/**
 * System tray: InputSplit keeps running here while a game is isolated, so the window can
 * be closed without stopping anything. The menu always offers "Stop isolation".
 */
import { Menu, nativeImage, Tray } from 'electron'
import type { IsolationView, Profile } from '@shared/domain'
import type { MainTexts } from './i18n'
import { isSessionLive } from '@shared/support'
import { iconPath } from './paths'

/** How many profiles the tray offers (most recently used first). */
const TRAY_PROFILES = 6

export interface TrayActions {
  show: () => void
  playProfile: (id: string) => void
  stopIsolation: () => void
  openSettings: () => void
  quit: () => void
}

export class AppTray {
  private readonly tray: Tray
  private readonly idleIcon = nativeImage.createFromPath(iconPath('tray.png'))
  private readonly activeIcon = nativeImage.createFromPath(iconPath('tray-active.png'))
  private view: IsolationView | null = null
  private profiles: Profile[] = []

  constructor(
    private readonly texts: () => MainTexts,
    private readonly actions: TrayActions,
  ) {
    this.tray = new Tray(this.idleIcon)
    this.tray.on('click', () => actions.show())
    this.tray.on('double-click', () => actions.show())
    this.update(null)
  }

  /** `profiles` most recently used first. */
  setProfiles(profiles: Profile[]): void {
    this.profiles = profiles.slice(0, TRAY_PROFILES)
    this.refresh()
  }

  /** Rebuilds the menu, e.g. after the language changed. */
  refresh(): void {
    this.update(this.view)
  }

  update(view: IsolationView | null): void {
    this.view = view
    const text = this.texts()
    const live = view !== null && isSessionLive(view)
    const game = view?.target?.exeName ?? null
    this.tray.setImage(live ? this.activeIcon : this.idleIcon)
    const isolating = game ? text.trayIsolating.replace('{game}', game) : ''
    this.tray.setToolTip(live && game ? `InputSplit — ${isolating}` : 'InputSplit')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: live && game ? isolating : text.trayNotIsolating, enabled: false },
        { type: 'separator' },
        { label: text.trayOpen, click: () => this.actions.show() },
        {
          label: text.trayPlay,
          enabled: !live,
          submenu:
            this.profiles.length > 0
              ? this.profiles.map((profile) => ({
                  // "&" would become a keyboard accelerator in Windows menus.
                  label: profile.name.replace(/&/g, '&&'),
                  click: () => this.actions.playProfile(profile.id),
                }))
              : [{ label: text.trayNoProfiles, enabled: false }],
        },
        { label: text.trayStop, enabled: live, click: () => this.actions.stopIsolation() },
        { label: text.traySettings, click: () => this.actions.openSettings() },
        { type: 'separator' },
        { label: text.trayQuit, click: () => this.actions.quit() },
      ]),
    )
  }

  notifyStillRunning(): void {
    // Windows balloon notification; silently ignored on other platforms.
    const text = this.texts()
    this.tray.displayBalloon?.({
      title: text.balloonTitle,
      content: this.view && isSessionLive(this.view) ? text.balloonIsolating : text.balloonIdle,
      iconType: 'info',
    })
  }

  destroy(): void {
    this.tray.destroy()
  }
}
