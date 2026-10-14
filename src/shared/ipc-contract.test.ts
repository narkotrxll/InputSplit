import { describe, expect, it } from 'vitest'
import { EVENT_CHANNEL_NAMES, INVOKE_CHANNEL_NAMES } from './channels'
import { EVENT_CHANNELS, INVOKE_CHANNELS, invokeContract } from './ipc-contract'

describe('IPC contract', () => {
  it('lists exactly the same channels as the preload whitelist', () => {
    expect([...INVOKE_CHANNEL_NAMES].sort()).toEqual([...INVOKE_CHANNELS].sort())
    expect([...EVENT_CHANNEL_NAMES].sort()).toEqual([...EVENT_CHANNELS].sort())
  })

  it('rejects malformed input for sensitive channels', () => {
    expect(invokeContract['windows:checkTarget'].input.safeParse(-1).success).toBe(false)
    expect(invokeContract['controllers:startTest'].input.safeParse(4).success).toBe(false)
    expect(invokeContract['app:openExternal'].input.safeParse('https://evil.example').success).toBe(
      false,
    )
    expect(invokeContract['settings:update'].input.safeParse({ closeToTray: 'yes' }).success).toBe(
      false,
    )
    expect(invokeContract['isolation:start'].input.safeParse({ target: {} }).success).toBe(false)
  })

  it('accepts channels without input only when nothing is passed', () => {
    expect(invokeContract['windows:list'].input.safeParse(undefined).success).toBe(true)
    expect(invokeContract['windows:list'].input.safeParse({ any: 1 }).success).toBe(false)
  })
})

describe('settings patches', () => {
  it('never fills in defaults for settings the patch does not mention', () => {
    const patch = invokeContract['settings:update'].input.parse({ theme: 'light' })
    expect(patch).toEqual({ theme: 'light' })
  })
})
