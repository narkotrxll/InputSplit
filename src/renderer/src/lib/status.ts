import type { UiStatus } from '@shared/domain'

export interface StatusStyle {
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'orange'
  dot: string
  text: string
  pulse: boolean
}

export const STATUS_STYLE: Record<UiStatus, StatusStyle> = {
  notConfigured: { tone: 'neutral', dot: 'bg-text-faint', text: 'text-text-muted', pulse: false },
  ready: { tone: 'accent', dot: 'bg-accent', text: 'text-accent', pulse: false },
  isolating: { tone: 'info', dot: 'bg-info', text: 'text-info', pulse: true },
  active: { tone: 'success', dot: 'bg-success', text: 'text-success', pulse: true },
  limited: { tone: 'warning', dot: 'bg-warning', text: 'text-warning', pulse: false },
  error: { tone: 'danger', dot: 'bg-danger', text: 'text-danger', pulse: false },
  disconnected: { tone: 'orange', dot: 'bg-orange', text: 'text-orange', pulse: false },
}
