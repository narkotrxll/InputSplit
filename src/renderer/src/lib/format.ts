/** Formatting helpers. Each takes the UI locale; English is the default for tests. */

function unit(locale: string, value: number, name: 'hour' | 'minute' | 'second', pad = false) {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: name,
    unitDisplay: 'narrow',
    minimumIntegerDigits: pad ? 2 : 1,
  }).format(value)
}

export function formatDuration(ms: number, locale = 'en'): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${unit(locale, hours, 'hour')} ${unit(locale, minutes, 'minute', true)}`
  if (minutes > 0) {
    return `${unit(locale, minutes, 'minute')} ${unit(locale, seconds, 'second', true)}`
  }
  return unit(locale, seconds, 'second')
}

export function formatCount(value: number, locale = 'en'): string {
  return value >= 10_000
    ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat(locale).format(value)
}

export function formatRelativeDate(iso: string, now = Date.now(), locale = 'en'): string {
  const diff = now - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round(diff / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.round(hours / 24), 'day')
}

/** Strips the " — App name" suffix many windows have, for compact display. */
export function shortTitle(title: string): string {
  return title.length > 64 ? `${title.slice(0, 61)}…` : title
}
