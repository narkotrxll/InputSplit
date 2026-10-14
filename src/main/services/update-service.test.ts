import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

function release(tag: string) {
  return {
    tag_name: tag,
    html_url: `https://github.com/narkotrxll/InputSplit/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `InputSplit-Setup-${tag.slice(1)}.exe`,
        browser_download_url: 'https://example.test/setup.exe',
        size: installer.length,
      },
      {
        name: `InputSplit-Setup-${tag.slice(1)}.exe.sha256`,
        browser_download_url: 'https://example.test/setup.exe.sha256',
        size: 64,
      },
    ],
  }
}

function fakeFetch(tag: string, checksum = sha) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    if (href === RELEASES_API) return Response.json(release(tag))
    if (href.endsWith('.sha256')) return new Response(`${checksum}  setup.exe\n`)
    return new Response(installer)
  }) as unknown as typeof fetch
}

function service(tag: string, checksum?: string) {
  const runInstaller = vi.fn(async (_path: string) => {})
  const updates = new UpdateService({
    currentVersion: '0.1.0',
    canInstall: true,
    logger: new Logger(null),
    fetch: fakeFetch(tag, checksum),
    runInstaller,
  })
  return { updates, runInstaller }
}

describe('UpdateService', () => {
  it('finds a newer release once', async () => {
    const { updates } = service('v0.2.0')
    const found: string[] = []
    updates.found.on((v) => found.push(v))
    expect((await updates.check()).status).toBe('available')
    await updates.check()
    expect(updates.get().latestVersion).toBe('0.2.0')
    expect(found).toEqual(['0.2.0'])
  })

  it('reports up to date for the same version', async () => {
    const { updates } = service('v0.1.0')
    expect((await updates.check()).status).toBe('upToDate')
  })

  it('downloads, verifies the checksum and runs the installer', async () => {
    const { updates, runInstaller } = service('v0.2.0')
    await updates.check()
    await updates.install()
    const path = runInstaller.mock.calls[0]?.[0]
    expect(path).toMatch(/InputSplit-Setup-0\.2\.0\.exe$/)
    expect(await readFile(path!)).toEqual(installer)
    expect(updates.get().status).toBe('installing')
  })

  it('refuses an installer whose checksum does not match', async () => {
    const { updates, runInstaller } = service('v0.2.0', '0'.repeat(64))
    await updates.check()
    await expect(updates.install()).rejects.toMatchObject({ code: 'updateFailed' })
    expect(runInstaller).not.toHaveBeenCalled()
    expect(updates.get().status).toBe('available')
  })
})
