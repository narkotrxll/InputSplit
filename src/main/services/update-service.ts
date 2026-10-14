/**
 * Update check against GitHub Releases (the release workflow publishes every version
 * there with `InputSplit-Setup-<version>.exe` and its `.sha256`).
 *
 * Nothing happens without the user's click: "install" downloads the installer into the
 * temp folder, verifies its SHA-256 checksum, starts it and quits InputSplit so the
 * installer can replace the files.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { UpdateState } from '@shared/domain'
import { AppException } from '@shared/errors'
import { Emitter } from '../util/emitter'
import type { Logger } from './logger'

export const RELEASES_API = 'https://api.github.com/repos/narkotrxll/InputSplit/releases/latest'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15_000

const ReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string().url(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(
    z.object({ name: z.string(), browser_download_url: z.string().url(), size: z.number() }),
  ),
})

/** Compares dotted versions numerically ("0.10.0" > "0.9.3"); pre-release tags rank lower. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = v.replace(/^v/i, '').split('-', 2)
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const diff = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  if (x.pre === y.pre) return 0
  if (x.pre === undefined) return 1
  if (y.pre === undefined) return -1
  return x.pre.localeCompare(y.pre)
}

interface Installer {
  url: string
  name: string
  size: number
  checksumUrl: string | null
}

export interface UpdateServiceOptions {
  currentVersion: string
  /** Packaged builds only: the installer replaces the installed app. */
  canInstall: boolean
  logger: Logger
  fetch?: typeof globalThis.fetch
  /** Runs the downloaded installer and quits the app. */
  runInstaller: (path: string) => Promise<void>
}

export class UpdateService {
  private state: UpdateState
  readonly changes = new Emitter<UpdateState>()
  /** Fires once per newly found version (for the Windows notification). */
  readonly found = new Emitter<string>()
  private installer: Installer | null = null
  private timer: NodeJS.Timeout | null = null
  private announced: string | null = null
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.state = {
      status: 'idle',
      currentVersion: options.currentVersion,
      latestVersion: null,
      releaseUrl: null,
      progress: null,
      canInstall: options.canInstall,
      checkedAt: null,
    }
  }

  get(): UpdateState {
    return this.state
  }

  /** Automatic checks: shortly after start, then once a day. */
  setAutomatic(enabled: boolean): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!enabled) return
    const schedule = (delay: number) => {
      this.timer = setTimeout(() => {
        void this.check().finally(() => schedule(CHECK_INTERVAL_MS))
      }, delay)
    }
    schedule(FIRST_CHECK_DELAY_MS)
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.state
    if (this.state.status === 'installing') return this.state
    this.set({ ...this.state, status: 'checking' })
    try {
      const response = await this.fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'InputSplit' },
      })
      if (response.status === 404) {
        // No published release yet.
        this.set({ ...this.state, status: 'upToDate', checkedAt: Date.now() })
        return this.state
      }
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      const release = ReleaseSchema.parse(await response.json())
      const latest = release.tag_name.replace(/^v/i, '')
      const newer =
        !release.draft &&
        !release.prerelease &&
        compareVersions(latest, this.options.currentVersion) > 0
      const exe = release.assets.find((a) => /^InputSplit-Setup-.*\.exe$/i.test(a.name))
      const sum = exe ? release.assets.find((a) => a.name === `${exe.name}.sha256`) : undefined
      this.installer = exe
        ? {
            url: exe.browser_download_url,
            name: exe.name,
            size: exe.size,
            checksumUrl: sum?.browser_download_url ?? null,
          }
        : null
      this.set({
        ...this.state,
        status: newer ? 'available' : 'upToDate',
        latestVersion: latest,
        releaseUrl: release.html_url,
        checkedAt: Date.now(),
      })
      if (newer && this.announced !== latest) {
        this.announced = latest
        this.options.logger.info(`Update available: ${latest}`)
        this.found.emit(latest)
      }
    } catch (error) {
      this.options.logger.warn(`Update check failed: ${String(error)}`)
      this.set({ ...this.state, status: 'error', checkedAt: Date.now() })
    }
    return this.state
  }

  async install(): Promise<void> {
    const installer = this.installer
    if (this.state.status !== 'available' || installer === null) {
      throw new AppException('updateUnavailable', 'No update is ready to install.')
    }
    if (!this.options.canInstall) {
      throw new AppException('updateDevBuild', 'Updates install only in the installed app.')
    }
    this.set({ ...this.state, status: 'downloading', progress: 0 })
    try {
      const folder = await mkdtemp(join(tmpdir(), 'inputsplit-update-'))
      const path = join(folder, installer.name)
      const hash = await this.download(installer, path)
      if (installer.checksumUrl !== null) {
        const response = await this.fetch(installer.checksumUrl)
        if (!response.ok) throw new Error(`Checksum download failed (${response.status})`)
        const expected = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase()
        if (expected !== hash) throw new Error('The installer checksum does not match')
      }
      this.options.logger.info(`Starting installer ${installer.name}`)
      this.set({ ...this.state, status: 'installing', progress: 100 })
      await this.options.runInstaller(path)
    } catch (error) {
      this.options.logger.error(`Update failed: ${String(error)}`)
      this.set({ ...this.state, status: 'available', progress: null })
      throw new AppException('updateFailed', String(error))
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  private async download(installer: Installer, path: string): Promise<string> {
    const response = await this.fetch(installer.url)
    if (!response.ok || response.body === null) {
      throw new Error(`Download failed (${response.status})`)
    }
    const hash = createHash('sha256')
    const file = createWriteStream(path)
    const total = Number(response.headers.get('content-length')) || installer.size
    let received = 0
    let lastPercent = -1
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        received += value.length
        if (!file.write(value))
          await new Promise<void>((resolve) => file.once('drain', () => resolve()))
        const percent = total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : null
        if (percent !== null && percent !== lastPercent) {
          lastPercent = percent
          this.set({ ...this.state, progress: percent })
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        file.end((error?: Error | null) => (error ? reject(error) : resolve())),
      )
    }
    return hash.digest('hex')
  }

  private set(state: UpdateState): void {
    this.state = state
    this.changes.emit(state)
  }
}
