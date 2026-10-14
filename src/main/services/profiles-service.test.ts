import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURES, type ProfileInput } from '@shared/domain'
import { ProfilesService, validateExecutable } from './profiles-service'

function input(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    id: null,
    name: 'Red Dead Redemption 2',
    exeName: 'RDR2.exe',
    exePath: 'D:\\Games\\RDR2\\RDR2.exe',
    controllerSlot: 0,
    displayId: '\\\\.\\DISPLAY3',
    displayName: 'LG TV',
    moveWindow: true,
    restoreOnExit: true,
    features: DEFAULT_FEATURES,
    autoStart: false,
    ...overrides,
  }
}

function makeService() {
  const path = join(mkdtempSync(join(tmpdir(), 'inputsplit-profiles-')), 'profiles.json')
  return { path, service: new ProfilesService(path, () => {}) }
}

describe('validateExecutable', () => {
  it('accepts a matching name and absolute path', () => {
    expect(() => validateExecutable('RDR2.exe', 'D:\\Games\\RDR2\\RDR2.exe')).not.toThrow()
    expect(() => validateExecutable('game.EXE', null)).not.toThrow()
  })

  it('rejects anything that is not an absolute .exe path', () => {
    expect(() => validateExecutable('RDR2.exe', 'RDR2.exe')).toThrow()
    expect(() => validateExecutable('RDR2.exe', '\\\\server\\share\\RDR2.exe')).toThrow()
    expect(() => validateExecutable('RDR2.exe', 'D:\\Games\\RDR2\\run.bat')).toThrow()
    expect(() => validateExecutable('script.bat', null)).toThrow()
    expect(() => validateExecutable('a/b.exe', null)).toThrow()
  })

  it('rejects a name that does not match the path', () => {
    expect(() => validateExecutable('Other.exe', 'D:\\Games\\RDR2\\RDR2.exe')).toThrow()
  })
})

describe('ProfilesService', () => {
  it('creates, persists and reloads profiles', async () => {
    const { path, service } = makeService()
    const saved = await service.save(input())
    expect(saved.id).toMatch(/[0-9a-f-]{36}/)
    const reloaded = new ProfilesService(path, () => {})
    expect(await reloaded.load()).toEqual([saved])
  })

  it('updates in place and keeps createdAt', async () => {
    const { service } = makeService()
    const saved = await service.save(input())
    const updated = await service.save(input({ id: saved.id, controllerSlot: 2 }))
    expect(updated.createdAt).toBe(saved.createdAt)
    expect(updated.controllerSlot).toBe(2)
    expect(service.list()).toHaveLength(1)
  })

  it('refuses duplicate names and unknown ids', async () => {
    const { service } = makeService()
    await service.save(input())
    await expect(service.save(input({ name: ' red dead redemption 2 ' }))).rejects.toMatchObject({
      code: 'profileNameTaken',
    })
    await expect(service.save(input({ id: 'missing', name: 'X' }))).rejects.toMatchObject({
      code: 'profileNotFound',
    })
  })

  it('deletes and marks profiles as used', async () => {
    const { service } = makeService()
    const a = await service.save(input())
    const b = await service.save(
      input({ name: 'Hollow Knight', exeName: 'hollow_knight.exe', exePath: null }),
    )
    await service.markUsed(b.id)
    expect(service.list().find((p) => p.id === b.id)?.lastUsedAt).not.toBeNull()
    await service.delete(a.id)
    expect(service.list().map((p) => p.name)).toEqual(['Hollow Knight'])
  })
})

describe('ProfilesService.importMany', () => {
  it('adds new profiles, updates same-named ones and skips invalid ones', async () => {
    const { service } = makeService()
    const existing = await service.save(input())
    const other = await service.save(
      input({ name: 'Celeste', exeName: 'Celeste.exe', exePath: null }),
    )
    const incoming = [
      { ...existing, id: 'from-other-pc', controllerSlot: 2 },
      { ...other, id: other.id, name: 'Hollow Knight', exeName: 'hollow_knight.exe' },
      { ...other, id: 'bad', name: 'Bad', exeName: 'run.bat' },
    ]
    const result = await service.importMany(incoming)
    expect(result).toEqual({ added: 1, updated: 1, skipped: 1 })
    const list = service.list()
    expect(list.map((p) => p.name)).toEqual(['Celeste', 'Hollow Knight', 'Red Dead Redemption 2'])
    const updated = list.find((p) => p.name === 'Red Dead Redemption 2')!
    expect(updated.id).toBe(existing.id)
    expect(updated.controllerSlot).toBe(2)
    // The added profile's id clashed with Celeste's, so it got a new one.
    expect(new Set(list.map((p) => p.id)).size).toBe(3)
  })
})
