import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Logger } from '../services/logger'
import { HelperClient } from './helper-client'

const fixture = fileURLToPath(new URL('./__fixtures__/fake-helper.mjs', import.meta.url))
const clients: HelperClient[] = []

function makeClient(mode: string, logger = new Logger(null)) {
  const client = new HelperClient({
    executablePath: fixture,
    logger,
    platform: 'win32',
    spawnProcess: () =>
      spawn(process.execPath, [fixture], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FAKE_MODE: mode },
      }),
    pingIntervalMs: 60_000,
  })
  clients.push(client)
  return client
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.stop()))
})

describe('HelperClient', () => {
  it('is unavailable on non-Windows platforms without spawning anything', async () => {
    const client = new HelperClient({ executablePath: fixture, logger: new Logger(null), platform: 'linux' })
    await client.start()
    expect(client.getState()).toMatchObject({ status: 'unavailable', reason: 'unsupportedPlatform' })
  })

  it('reports a missing helper executable', async () => {
    const client = new HelperClient({
      executablePath: 'C:\\does\\not\\exist.exe',
      logger: new Logger(null),
      platform: 'win32',
    })
    await client.start()
    expect(client.getState()).toMatchObject({ status: 'unavailable', reason: 'helperMissing' })
  })

  it('performs the handshake and exposes helper facts', async () => {
    const client = makeClient('normal')
    await client.start()
    expect(client.getState()).toMatchObject({
      status: 'ready',
      helperVersion: 'fake',
      windowsBuild: 26100,
      emergencyHotkey: 'Ctrl+Alt+Shift+Q',
    })
    expect(await client.request('ping', {})).toEqual({ uptimeMs: 1 })
  })

  it('keeps error codes from the helper', async () => {
    const client = makeClient('normal')
    await client.start()
    await expect(client.request('checkTarget', { pid: 1 })).rejects.toMatchObject({ code: 'antiCheat' })
  })

  it('rejects answers with an unexpected shape and forwards log events', async () => {
    const logger = new Logger(null)
    const client = makeClient('normal', logger)
    await client.start()
    await expect(client.request('listControllers', {})).rejects.toMatchObject({ code: 'protocolMismatch' })
    expect(logger.all().some((e) => e.source === 'helper' && e.message === 'listing')).toBe(true)
  })

  it('marks the backend crashed when the handshake is invalid', async () => {
    const client = makeClient('badHello')
    await client.start()
    expect(client.getState().status).toBe('crashed')
  })

  it('restarts the helper after an unexpected exit', async () => {
    const client = makeClient('crash')
    const states: string[] = []
    client.onState((s) => states.push(s.status))
    await client.start()
    await vi.waitFor(() => expect(states).toContain('restarting'), { timeout: 3000 })
    await vi.waitFor(() => expect(states.filter((s) => s === 'ready').length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    })
  })
})
