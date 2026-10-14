/**
 * Interface languages. The renderer holds the full texts (src/renderer/src/i18n); the main
 * process only needs a handful for the tray and file dialogs (src/main/i18n.ts).
 */

export const LOCALES = [
  'en',
  'uk',
  'ru',
  'es',
  'de',
  'fr',
  'pt-BR',
  'pl',
  'tr',
  'zh-CN',
  'ja',
] as const
export type Locale = (typeof LOCALES)[number]

/** The language setting: a fixed locale or "follow Windows". */
export const LANGUAGE_SETTINGS = ['system', ...LOCALES] as const
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number]

/** Each language's name in that language, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  uk: 'Українська',
  ru: 'Русский',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  'pt-BR': 'Português (Brasil)',
  pl: 'Polski',
  tr: 'Türkçe',
  'zh-CN': '简体中文',
  ja: '日本語',
}

/** Maps one BCP 47 tag ("ru-RU", "pt-PT", "zh-Hans-CN") to a supported locale, if any. */
export function matchLocale(tag: string): Locale | null {
  const lower = tag.toLowerCase().replace(/_/g, '-')
  const exact = LOCALES.find((locale) => locale.toLowerCase() === lower)
  if (exact) return exact
  const language = lower.split('-')[0]
  if (language === 'zh') {
    // Only Simplified Chinese exists; Traditional-script regions fall back to English.
    return /hant|-tw|-hk|-mo/.test(lower) ? null : 'zh-CN'
  }
  if (language === 'pt') return 'pt-BR'
  return LOCALES.find((locale) => locale === language) ?? null
}

/** Resolves the setting against the system's preferred languages (most preferred first). */
export function resolveLocale(
  setting: LanguageSetting,
  systemLanguages: readonly string[],
): Locale {
  if (setting !== 'system') return setting
  for (const tag of systemLanguages) {
    const locale = matchLocale(tag)
    if (locale) return locale
  }
  return 'en'
}
