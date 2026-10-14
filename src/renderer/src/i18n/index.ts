import { createI18n } from 'vue-i18n'
import { resolveLocale, type LanguageSetting, type Locale } from '@shared/locales'
import { de } from './de'
import { en, type Messages } from './en'
import { es } from './es'
import { fr } from './fr'
import { ja } from './ja'
import { pl } from './pl'
import { ptBR } from './pt-BR'
import { ru } from './ru'
import { tr } from './tr'
import { uk } from './uk'
import { zhCN } from './zh-CN'

export const messages: Record<Locale, Messages> = {
  en,
  uk,
  ru,
  es,
  de,
  fr,
  'pt-BR': ptBR,
  pl,
  tr,
  'zh-CN': zhCN,
  ja,
}

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

// Windows' preferred languages from the main process (the tray uses the same list).
// `navigator.languages` only covers the Windows display language, so it is just a fallback.
let systemLanguages: readonly string[] = navigator.languages

export function setSystemLanguages(languages: readonly string[]): void {
  if (languages.length > 0) systemLanguages = languages
}

/** The locale "Same as Windows" stands for. */
export function systemLocale(): Locale {
  return resolveLocale('system', systemLanguages)
}

/** Switches the interface language; `lang` on <html> picks the right CJK font. */
export function applyLanguage(setting: LanguageSetting): void {
  const locale = setting === 'system' ? systemLocale() : setting
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
}

/** Translates an error code, falling back to the technical message. */
export function errorText(code: string, message?: string): string {
  const key = `errors.${code}`
  const t = i18n.global.t
  return i18n.global.te(key) ? t(key) : (message ?? t('errors.internalError'))
}
