/**
 * The Xbox button opens Game Bar wherever the keyboard focus is: during isolation that is
 * the other person's screen. While a game is isolated we turn off Windows' "Open Xbox Game
 * Bar using this button on a controller" and put the old value back afterwards.
 *
 * The old value is also written to a file first, so a crash or a power cut cannot leave the
 * setting changed: `recover()` restores it on the next start.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'

const KEY = 'HKCU\\Software\\Microsoft\\GameBar'
const VALUE = 'UseNexusForGameBarEnabled'

/** The registry value: a number, or null when it is not set (Windows then treats it as on). */
export interface GameBarSetting {
  read(): Promise<number | null>
  write(value: number | null): Promise<void>
}

function reg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    )
  })
}

/** Parses `reg query` output; null when the value is missing. */
export function parseRegDword(output: string): number | null {
  const match = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(output)
  return match ? parseInt(match[1]!, 16) : null
}

export const windowsGameBarSetting: GameBarSetting = {
  async read() {
    try {
      return parseRegDword(await reg(['query', KEY, '/v', VALUE]))
    } catch {
      return null // the value (or the key) does not exist
    }
  },
  async write(value) {
    if (value === null) {
      await reg(['delete', KEY, '/v', VALUE, '/f']).catch(() => {})
    } else {
      await reg(['add', KEY, '/v', VALUE, '/t', 'REG_DWORD', '/d', String(value), '/f'])
    }
  },
}

export class GameBarGuard {
  /** True while the setting is ours to put back. */
  private applied = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly setting: GameBarSetting,
    /** Holds the old value while the setting is changed. */
    private readonly restoreFile: string,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  /** Puts back a value left over from a run that did not finish. */
  recover(): Promise<void> {
    return this.enqueue(async () => {
      const saved = await this.readSaved()
      if (saved === undefined) return
      await this.setting.write(saved)
      await fs.rm(this.restoreFile, { force: true })
    })
  }

  /** Turns the Xbox button's Game Bar shortcut off while `blocked`, and back afterwards. */
  set(blocked: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (blocked && !this.applied) {
        const previous = await this.setting.read()
        if (previous === 0) return // already off: nothing to undo later
        await fs.writeFile(this.restoreFile, JSON.stringify({ previous }), 'utf8')
        await this.setting.write(0)
        this.applied = true
      } else if (!blocked && this.applied) {
        const saved = await this.readSaved()
        await this.setting.write(saved === undefined ? null : saved)
        await fs.rm(this.restoreFile, { force: true })
        this.applied = false
      }
    })
  }

  private async readSaved(): Promise<number | null | undefined> {
    try {
      const data = JSON.parse(await fs.readFile(this.restoreFile, 'utf8')) as { previous?: unknown }
      return typeof data.previous === 'number' ? data.previous : null
    } catch {
      return undefined
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue
      .then(task)
      .catch((error: unknown) => this.warn(`Game Bar setting: ${String(error)}`))
    return this.queue
  }
}
