import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GameBarGuard, parseRegDword, type GameBarSetting } from './game-bar-guard'

class FakeSetting implements GameBarSetting {
  constructor(public value: number | null) {}
  writes: (number | null)[] = []
  async read() {
    return this.value
  }
  async write(value: number | null) {
    this.value = value
    this.writes.push(value)
  }
}

const file = () => join(mkdtempSync(join(tmpdir(), 'gamebar-')), 'restore.json')

describe('GameBarGuard', () => {
  it('turns the shortcut off during isolation and puts the old value back', async () => {
    const setting = new FakeSetting(1)
    const guard = new GameBarGuard(setting, file())
    await guard.set(true)
    expect(setting.value).toBe(0)
    await guard.set(true)
    await guard.set(false)
    expect(setting.value).toBe(1)
    expect(setting.writes).toEqual([0, 1])
  })

  it('restores a missing value as missing, and leaves an already-off setting alone', async () => {
    const missing = new FakeSetting(null)
    const guard = new GameBarGuard(missing, file())
    await guard.set(true)
    await guard.set(false)
    expect(missing.writes).toEqual([0, null])

    const off = new FakeSetting(0)
    const other = new GameBarGuard(off, file())
    await other.set(true)
    await other.set(false)
    expect(off.writes).toEqual([])
  })

  it('recovers the old value after a crash', async () => {
    const path = file()
    const setting = new FakeSetting(1)
    await new GameBarGuard(setting, path).set(true)
    expect(setting.value).toBe(0)
    await new GameBarGuard(setting, path).recover()
    expect(setting.value).toBe(1)
    setting.writes = []
    await new GameBarGuard(setting, path).recover()
    expect(setting.writes).toEqual([])
  })
})

describe('parseRegDword', () => {
  it('reads reg query output', () => {
    const out =
      '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\GameBar\r\n    UseNexusForGameBarEnabled    REG_DWORD    0x1\r\n'
    expect(parseRegDword(out)).toBe(1)
    expect(parseRegDword('')).toBeNull()
  })
})
