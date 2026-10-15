import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Logger } from './logger'
import { compareVersions, RELEASES_API, UpdateService } from './update-service'

describe('compareVersions', () => {
  it('compares numerically and ranks pre-releases lower', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1)
    expect(compareVersions('v1.2.0', '1.2')).toBe(0)
    expect(compareVersions('1.2.0-beta', '1.2.0')).toBe(-1)
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1)
  })
})

const installer = Buffer.from('fake installer bytes')
const sha = createHash('sha256').update(installer).digest('hex')

function release(tag: string, installerName = 'InputSplit.exe') {
  return {
    tag_name: tag,
    html_url: `https://github.com/narkotrxll/InputSplit/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: installerName,
        browser_download_url: 'https://example.test/setup.exe',
        size: installer.length,
      },
      {
        name: `${installerName}.sha256`,
        browser_download_url: 'https://example.test/setup.exe.sha256',
        size: 64,
      },
    ],
  }
}

interface Fake {
  tag: string
  /** The releases API answers with this status instead of a release. */
  apiStatus?: number
  checksum?: string
  installerName?: string
  canInstall?: boolean
}

function fakeFetch({ tag, checksum = sha, installerName, apiStatus }: Fake) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    if (href === RELEASES_API) {
      if (apiStatus !== undefined) return new Response('{}', { status: apiStatus })
      return Response.json(release(tag, installerName))
    }
    if (href.endsWith('.sha256')) return new Response(`${checksum}  setup.exe\n`)
    return new Response(installer)
  }) as unknown as typeof fetch
}

async function service(fake: Fake) {
  const runInstaller = vi.fn(async (_path: string) => {})
  const fetch = fakeFetch(fake)
  const updates = new UpdateService({
    currentVersion: '0.1.0',
    canInstall: fake.canInstall ?? true,
    logger: new Logger(null),
    fetch,
    downloadDir: await mkdtemp(join(tmpdir(), 'inputsplit-update-test-')),
    runInstaller,
  })
  return { updates, runInstaller, fetch }
}

describe('UpdateService', () => {
  it('downloads a newer release in the background and announces it once', async () => {
    const { updates, runInstaller } = await service({ tag: 'v0.2.0' })
    const found: unknown[] = []
    updates.found.on((v) => found.push(v))
    expect((await updates.check()).status).toBe('ready')
    expect(await readFile(updates.readyInstaller()!)).toEqual(installer)
    expect(updates.readyInstaller()).toMatch(/InputSplit\.exe$/)
    await updates.check()
    expect(updates.get().status).toBe('ready')
    expect(updates.get().latestVersion).toBe('0.2.0')
    expect(found).toEqual([{ version: '0.2.0', ready: true }])
    expect(runInstaller).not.toHaveBeenCalled()
  })

  it('downloads only once per version', async () => {
    const { updates, fetch } = await service({ tag: 'v0.2.0' })
    await updates.check()
    await updates.check()
    const downloads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('.exe'))
    expect(downloads).toHaveLength(1)
  })

  it('still finds installers with the old InputSplit-Setup-<version>.exe name', async () => {
    const { updates } = await service({
      tag: 'v0.2.0',
      installerName: 'InputSplit-Setup-0.2.0.exe',
    })
    expect((await updates.check()).status).toBe('ready')
    expect(updates.readyInstaller()).toMatch(/InputSplit-Setup-0\.2\.0\.exe$/)
  })

  it('reports up to date for the same version', async () => {
    const { updates } = await service({ tag: 'v0.1.0' })
    expect((await updates.check()).status).toBe('upToDate')
    expect(updates.readyInstaller()).toBeNull()
  })

  it('reports a failure, not "up to date", when GitHub has no public release', async () => {
    const { updates } = await service({ tag: 'v0.2.0', apiStatus: 404 })
    const state = await updates.check()
    expect(state.status).toBe('error')
    expect(state.errorReason).toBe('unreachable')
    expect(state.latestVersion).toBeNull()
  })

  it('tells a rate limit apart from a network failure', async () => {
    expect(
      (await (await service({ tag: 'v0.2.0', apiStatus: 403 })).updates.check()).errorReason,
    ).toBe('rateLimited')
    expect(
      (await (await service({ tag: 'v0.2.0', apiStatus: 502 })).updates.check()).errorReason,
    ).toBe('network')
  })

  it('runs the downloaded installer on "Restart and update"', async () => {
    const { updates, runInstaller } = await service({ tag: 'v0.2.0' })
    await updates.check()
    const path = updates.readyInstaller()
    await updates.install()
    expect(runInstaller).toHaveBeenCalledWith(path)
    expect(updates.get().status).toBe('installing')
  })

  it('keeps an installer whose checksum does not match from being ready', async () => {
    const { updates, runInstaller } = await service({ tag: 'v0.2.0', checksum: '0'.repeat(64) })
    const found: unknown[] = []
    updates.found.on((v) => found.push(v))
    expect((await updates.check()).status).toBe('available')
    expect(updates.readyInstaller()).toBeNull()
    await expect(updates.install()).rejects.toMatchObject({ code: 'updateFailed' })
    expect(runInstaller).not.toHaveBeenCalled()
    expect(updates.get().status).toBe('available')
    expect(found).toEqual([])
  })

  it('only reports a new version in a development build', async () => {
    const { updates } = await service({ tag: 'v0.2.0', canInstall: false })
    const found: unknown[] = []
    updates.found.on((v) => found.push(v))
    expect((await updates.check()).status).toBe('available')
    expect(found).toEqual([{ version: '0.2.0', ready: false }])
    await expect(updates.install()).rejects.toMatchObject({ code: 'updateDevBuild' })
  })
})
