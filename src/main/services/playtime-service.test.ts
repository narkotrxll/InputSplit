import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlaytimeService } from './playtime-service'

function makeService() {
  const path = join(mkdtempSync(join(tmpdir(), 'inputsplit-playtime-')), 'playtime.json')
  const now = new Date('2026-10-14T20:00:00Z')
  return {
    path,
    service: new PlaytimeService(
      path,
      () => {},
      () => now,
    ),
  }
}

describe('PlaytimeService', () => {
  it('adds up sessions per executable and survives a restart', async () => {
    const { path, service } = makeService()
    await service.record('Celeste.exe', 30 * 60_000)
    await service.record('celeste.EXE', 15 * 60_000)
    await service.record('Celeste.exe', 3_000) // a start that was stopped right away
    expect(service.get()['celeste.exe']).toEqual({
      totalMs: 45 * 60_000,
      sessions: 2,
      lastPlayedAt: '2026-10-14T20:00:00.000Z',
    })
    const reloaded = new PlaytimeService(path, () => {})
    await reloaded.load()
    expect(reloaded.get()['celeste.exe']?.totalMs).toBe(45 * 60_000)
  })

  it('never counts a backup twice', async () => {
    const { service } = makeService()
    await service.record('a.exe', 60_000)
    const backup = {
      'a.exe': { totalMs: 120_000, sessions: 3, lastPlayedAt: '2026-01-01T00:00:00.000Z' },
      'b.exe': { totalMs: 60_000, sessions: 1, lastPlayedAt: '2026-01-01T00:00:00.000Z' },
    }
    await service.merge(backup)
    await service.merge(backup)
    expect(service.get()['a.exe']).toEqual({
      totalMs: 120_000,
      sessions: 3,
      lastPlayedAt: '2026-10-14T20:00:00.000Z',
    })
    expect(service.get()['b.exe']?.totalMs).toBe(60_000)
  })
})
