/**
 * Updates from GitHub Releases (the release workflow publishes every version there as
 * `InputSplit.exe` with its `.sha256`).
 *
 * In the installed app a check that finds a newer version downloads its installer in the
 * background and verifies its SHA-256 checksum; the state is then `ready`. Nothing is
 * installed until InputSplit restarts: "Restart and update" quits, runs the installer
 * silently and starts the new version, and a plain quit installs it on the way out.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { UpdateState } from '@shared/domain'
import { AppException } from '@shared/errors'
import { Emitter } from '../util/emitter'
import type { Logger } from './logger'

export const RELEASES_API = 'https://api.github.com/repos/narkotrxll/InputSplit/releases/latest'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15_000

/** `InputSplit.exe`; releases up to 0.1.4 called it `InputSplit-Setup-<version>.exe`. */
const INSTALLER_ASSET = /^InputSplit(-Setup-[\w.-]+)?\.exe$/i

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
  /** Where installers are downloaded (emptied before each download). */
  downloadDir?: string
  /** Quits the app and runs the downloaded installer, which starts the new version. */
  runInstaller: (path: string) => Promise<void>
}

/** Fired once per version: when it is downloaded (`ready`), or found by a dev build. */
export interface UpdateFound {
  version: string
  ready: boolean
}

export class UpdateService {
  private state: UpdateState
  readonly changes = new Emitter<UpdateState>()
  /** For the Windows notification. */
  readonly found = new Emitter<UpdateFound>()
  private installer: Installer | null = null
  /** The verified installer on disk and its version. */
  private downloaded: { path: string; version: string } | null = null
  private timer: NodeJS.Timeout | null = null
  private announced: string | null = null
  private readonly fetch: typeof globalThis.fetch
  private readonly downloadDir: string

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.downloadDir = options.downloadDir ?? join(tmpdir(), 'InputSplit-update')
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

  /** The verified installer of a newer version, when one is waiting to be installed. */
  readyInstaller(): string | null {
    return this.state.status === 'ready' ? (this.downloaded?.path ?? null) : null
  }

  /** Automatic checks: shortly after start, then every few hours. */
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

  /** Looks for a newer release and, in the installed app, downloads it right away. */
  async check(): Promise<UpdateState> {
    const { status } = this.state
    if (status === 'checking' || status === 'downloading' || status === 'installing') {
      return this.state
    }
    this.set({ ...this.state, status: 'checking' })
    try {
      const response = await this.fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'InputSplit' },
      })
      if (response.status === 404) {
        // No published release yet, or the repository is not public.
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
      const exe = release.assets.find((a) => INSTALLER_ASSET.test(a.name))
      const sum = exe ? release.assets.find((a) => a.name === `${exe.name}.sha256`) : undefined
      this.installer = exe
        ? {
            url: exe.browser_download_url,
            name: exe.name,
            size: exe.size,
            checksumUrl: sum?.browser_download_url ?? null,
          }
        : null
      const alreadyReady = newer && this.downloaded?.version === latest
      this.set({
        ...this.state,
        status: alreadyReady ? 'ready' : newer ? 'available' : 'upToDate',
        latestVersion: latest,
        releaseUrl: release.html_url,
        checkedAt: Date.now(),
      })
      if (!newer && this.options.canInstall) {
        // The installer of an update that has been installed since.
        this.downloaded = null
        await rm(this.downloadDir, { recursive: true, force: true }).catch(() => {})
      }
      if (newer && !alreadyReady) {
        this.options.logger.info(`Update available: ${latest}`)
        if (this.options.canInstall && this.installer !== null) {
          // A failure leaves the state `available`; the next check or a click retries.
          await this.download(latest).catch(() => {})
        }
        this.announce(latest)
      }
    } catch (error) {
      this.options.logger.warn(`Update check failed: ${String(error)}`)
      // An update that is already downloaded stays ready.
      const next = this.downloaded !== null ? 'ready' : 'error'
      this.set({ ...this.state, status: next, checkedAt: Date.now() })
    }
    return this.state
  }

  /**
   * "Restart and update": quits and runs the downloaded installer. Downloads it first when
   * the background download has not happened or failed.
   */
  async install(): Promise<void> {
    if (!this.options.canInstall) {
      throw new AppException('updateDevBuild', 'Updates install only in the installed app.')
    }
    if (this.state.status === 'available' && this.installer !== null) {
      try {
        await this.download(this.state.latestVersion ?? '')
      } catch (error) {
        throw new AppException('updateFailed', String(error))
      }
    }
    const path = this.readyInstaller()
    if (path === null) {
      throw new AppException('updateUnavailable', 'No update is ready to install.')
    }
    this.options.logger.info(`Restarting to install ${this.state.latestVersion ?? ''}`)
    this.set({ ...this.state, status: 'installing', progress: null })
    try {
      await this.options.runInstaller(path)
    } catch (error) {
      this.options.logger.error(`Update failed: ${String(error)}`)
      this.set({ ...this.state, status: 'ready' })
      throw new AppException('updateFailed', String(error))
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  private announce(version: string): void {
    if (this.announced === version) return
    const ready = this.state.status === 'ready'
    // The installed app speaks up once the update is downloaded; a failed download stays
    // quiet until a later check gets it.
    if (!ready && this.options.canInstall) return
    this.announced = version
    this.found.emit({ version, ready })
  }

  /** Downloads and verifies the installer: `ready` on success, back to `available` if not. */
  private async download(version: string): Promise<void> {
    const installer = this.installer
    if (installer === null) throw new Error('The release has no installer')
    this.set({ ...this.state, status: 'downloading', progress: 0 })
    try {
      await rm(this.downloadDir, { recursive: true, force: true })
      await mkdir(this.downloadDir, { recursive: true })
      const path = join(this.downloadDir, installer.name)
      const hash = await this.fetchTo(installer, path)
      if (installer.checksumUrl !== null) {
        const response = await this.fetch(installer.checksumUrl)
        if (!response.ok) throw new Error(`Checksum download failed (${response.status})`)
        const expected = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase()
        if (expected !== hash) throw new Error('The installer checksum does not match')
      }
      this.downloaded = { path, version }
      this.options.logger.info(`Update ${version} downloaded and verified`)
      this.set({ ...this.state, status: 'ready', progress: null })
    } catch (error) {
      this.downloaded = null
      this.options.logger.warn(`Update download failed: ${String(error)}`)
      this.set({ ...this.state, status: 'available', progress: null })
      throw error
    }
  }

  private async fetchTo(installer: Installer, path: string): Promise<string> {
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
