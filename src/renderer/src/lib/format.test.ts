import { describe, expect, it } from 'vitest'
import { formatCount, formatDuration, formatPlaytime, formatRelativeDate } from './format'

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(4_200)).toBe('4s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_725_000)).toBe('1h 02m')
  })

  it('formats play time in hours and minutes', () => {
    expect(formatPlaytime(20_000)).toBe('1m')
    expect(formatPlaytime(45 * 60_000)).toBe('45m')
    expect(formatPlaytime(3 * 3_600_000)).toBe('3h')
    expect(formatPlaytime(12 * 3_600_000 + 5 * 60_000)).toBe('12h 5m')
  })

  it('formats counts', () => {
    expect(formatCount(1234)).toBe('1,234')
    expect(formatCount(25_300)).toBe('25.3K')
  })

  it('formats relative dates', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')
    expect(formatRelativeDate('2026-10-14T11:55:00Z', now)).toBe('5 minutes ago')
    expect(formatRelativeDate('2026-10-12T12:00:00Z', now)).toBe('2 days ago')
  })

  it('uses the UI locale', () => {
    expect(formatCount(1234, 'de')).toBe('1.234')
    expect(formatDuration(125_000, 'ru')).toBe('2 мин 05 с')
    const now = Date.parse('2026-10-14T12:00:00Z')
    expect(formatRelativeDate('2026-10-12T12:00:00Z', now, 'es')).toBe('anteayer')
  })
})
