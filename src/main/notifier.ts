/**
 * Windows notifications for what happens while InputSplit is in the background: isolation
 * started or ended (the game is often on another screen, started by a profile or by the
 * controller shortcut), and new versions. Nothing is shown while the InputSplit window has
 * focus: the dashboard already says it.
 */
import { Notification, nativeImage } from 'electron'
import type { IsolationView, Seat } from '@shared/domain'
import type { MainTexts } from './i18n'
import { iconPath } from './paths'

export interface NotifierOptions {
  texts: () => MainTexts
  enabled: () => boolean
  /** True while the user is looking at InputSplit itself. */
  windowFocused: () => boolean
  onClick: () => void
}

export class Notifier {
  private readonly previous = new Map<Seat, IsolationView>()
  private readonly icon = nativeImage.createFromPath(iconPath('icon.png'))

  constructor(private readonly options: NotifierOptions) {}

  /** Call with every isolation view of each seat; notifies on the transitions that matter. */
  isolationChanged(seat: Seat, view: IsolationView): void {
    const previous = this.previous.get(seat)
    this.previous.set(seat, view)
    if (previous === undefined || previous.phase === view.phase) return
    const text = this.options.texts()
    const game = gameName(view)
    if (view.phase === 'running') {
      this.show(text.notifyStartedTitle, fill(text.notifyStartedBody, { game }))
    } else if (view.phase === 'ended' && previous.phase !== 'idle') {
      const body =
        view.endedReason === 'processExited' ? text.notifyGameClosed : text.notifyEndedBody
      this.show(text.notifyEndedTitle, fill(body, { game }))
    } else if (view.phase === 'failed') {
      this.show(fill(text.notifyFailedTitle, { game }), text.notifyFailedBody)
    }
  }

  nothingToStart(): void {
    const text = this.options.texts()
    this.show(text.notifyNothingTitle, text.notifyNothingBody, true)
  }

  updateAvailable(version: string): void {
    const text = this.options.texts()
    this.show(fill(text.notifyUpdateTitle, { version }), text.notifyUpdateBody, true)
  }

  private show(title: string, body: string, evenWhenFocused = false): void {
    if (!this.options.enabled() || !Notification.isSupported()) return
    if (!evenWhenFocused && this.options.windowFocused()) return
    const notification = new Notification({ title, body, icon: this.icon, silent: true })
    notification.on('click', () => this.options.onClick())
    notification.show()
  }
}

function gameName(view: IsolationView): string {
  const target = view.target
  if (target === null) return 'InputSplit'
  const title = target.title.trim()
  return title.length > 0 && title.length <= 60 ? title : target.exeName.replace(/\.exe$/i, '')
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
