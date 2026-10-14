import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { SettingsService } from './settings-service'

function makeService(saved?: object) {
  const path = join(mkdtempSync(join(tmpdir(), 'inputsplit-settings-')), 'settings.json')
  if (saved) writeFileSync(path, JSON.stringify(saved))
  return { path, service: new SettingsService(path, () => {}) }
}

describe('SettingsService language', () => {
  it('follows Windows on a fresh install', async () => {
    const { service } = makeService()
    expect((await service.load()).language).toBe('system')
  })

  it('switches English saved by versions without languages to Windows', async () => {
    const { languageChosen: _, ...old } = DEFAULT_SETTINGS
    const { path, service } = makeService({ ...old, language: 'en' })
    expect((await service.load()).language).toBe('system')
    expect(JSON.parse(readFileSync(path, 'utf8')).language).toBe('system')
  })

  it('keeps a language picked in Settings, English included', async () => {
    const { path, service } = makeService()
    await service.load()
    await service.update({ language: 'en' })
    const again = new SettingsService(path, () => {})
    expect((await again.load()).language).toBe('en')
  })

  it('keeps any other saved language', async () => {
    const { service } = makeService({ ...DEFAULT_SETTINGS, language: 'ru' })
    expect((await service.load()).language).toBe('ru')
  })
})
