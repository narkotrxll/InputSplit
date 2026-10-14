import { describe, expect, it } from 'vitest'
import { matchLocale, resolveLocale } from './locales'

describe('locales', () => {
  it('matches system language tags', () => {
    expect(matchLocale('ru-RU')).toBe('ru')
    expect(matchLocale('uk')).toBe('uk')
    expect(matchLocale('pt-PT')).toBe('pt-BR')
    expect(matchLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(matchLocale('zh-TW')).toBeNull()
    expect(matchLocale('en_GB')).toBe('en')
    expect(matchLocale('ko-KR')).toBeNull()
  })

  it('resolves "system" to the first supported preference', () => {
    expect(resolveLocale('system', ['ko-KR', 'de-AT', 'en-US'])).toBe('de')
    expect(resolveLocale('system', ['ko-KR'])).toBe('en')
    expect(resolveLocale('system', [])).toBe('en')
    expect(resolveLocale('es', ['ru-RU'])).toBe('es')
  })
})
