/** Formatting helpers (locale-aware where it matters). */

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const plain = new Intl.NumberFormat('en')

export function formatCount(value: number): string {
  return value >= 10_000 ? compact.format(value) : plain.format(value)
}

export function formatRelativeDate(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
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
