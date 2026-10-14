import { createI18n } from 'vue-i18n'
import { en } from './en'

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
  missingWarn: false,
  fallbackWarn: false,
})

/** Translates an error code, falling back to the technical message. */
export function errorText(code: string, message?: string): string {
  const key = `errors.${code}`
  const t = i18n.global.t
  return i18n.global.te(key) ? t(key) : (message ?? t('errors.internalError'))
}
