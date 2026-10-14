import { describe, expect, it } from 'vitest'
import { LineSplitter, helperMethods, parseHelperEvent, parseHelperLine } from './protocol'

describe('LineSplitter', () => {
  it('joins partial chunks and drops empty lines', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('{"a":')).toEqual([])
    expect(splitter.push('1}\n\n{"b":2}\r\n{"c"')).toEqual(['{"a":1}', '{"b":2}'])
    expect(splitter.push(':3}\n')).toEqual(['{"c":3}'])
  })
})

describe('parseHelperLine', () => {
  it('recognises results, errors and events', () => {
    expect(parseHelperLine('{"id":1,"result":{"uptimeMs":5}}')).toEqual({
      id: 1,
      result: { uptimeMs: 5 },
    })
    expect(parseHelperLine('{"id":2,"error":{"code":"antiCheat","message":"x"}}')).toEqual({
      id: 2,
      error: { code: 'antiCheat', message: 'x' },
    })
    expect(parseHelperLine('{"event":"ready","data":{"helperVersion":"1","pid":3}}')).toEqual({
      event: 'ready',
      data: { helperVersion: '1', pid: 3 },
    })
  })

  it('rejects garbage', () => {
    expect(parseHelperLine('not json')).toBeNull()
    expect(parseHelperLine('[1,2]')).toBeNull()
  })
})

describe('helper schemas', () => {
  it('accept a real startIsolation result captured from the helper', () => {
    // Captured from the Wine smoke test (docs/TESTING.md).
    const result = {
      active: ['activationShield', 'focusSpoof', 'xinputBackground', 'xinputSlotLock'],
      architectureBits: 64,
      counters: {
        blockedCursorCalls: 0,
        blockedKeyboard: 0,
        blockedMouse: 0,
        swallowedFocusEvents: 0,
        xinputEnableBlocked: 0,
        xinputReads: 0,
      },
      detectedApis: ['xinput'],
      failed: [],
      gameWindow: 65622,
      pid: 32,
      requested: ['activationShield', 'focusSpoof', 'xinputBackground', 'xinputSlotLock'],
      sessionId: 1,
      subclassedWindows: 1,
      updatedAt: 1791987128542,
      xinputSlot: 0,
    }
    expect(helperMethods.startIsolation.result.safeParse(result).success).toBe(true)
  })

  it('validates event payloads and ignores unknown events', () => {
    expect(parseHelperEvent('emergencyStop', { stoppedSessions: 1 })).toEqual({
      name: 'emergencyStop',
      data: { stoppedSessions: 1 },
    })
    expect(parseHelperEvent('emergencyStop', { stoppedSessions: 'x' })).toBeNull()
    expect(parseHelperEvent('somethingNew', {})).toBeNull()
  })
})
