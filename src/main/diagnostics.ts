/**
 * The diagnostics report (Settings → Export diagnostics) and "Report a problem", which
 * saves the same report and opens a pre-filled GitHub issue for it.
 *
 * Window titles are personal data: only executable names leave this PC.
 */
import type { BackendState, IsolationView, LogEntry, Settings } from '@shared/domain'

export interface ReportSources {
  appVersion: string
  electron: string
  platform: string
  backend: BackendState
  views: IsolationView[]
  settings: Settings
  logs: LogEntry[]
}

export function buildReport(sources: ReportSources, now = new Date()): string {
  const report = {
    generatedAt: now.toISOString(),
    app: {
      version: sources.appVersion,
      electron: sources.electron,
      platform: sources.platform,
    },
    backend: sources.backend,
    isolation: sources.views.map((view) => ({
      ...view,
      target: view.target ? { exeName: view.target.exeName } : null,
    })),
    settings: sources.settings,
    logs: sources.logs.map(
      (e) => `${new Date(e.time).toISOString()} ${e.level} [${e.source}] ${e.message}`,
    ),
  }
  return JSON.stringify(report, null, 2)
}

export interface IssueTexts {
  reportWhat: string
  reportExpected: string
  reportAttach: string
}

/** One line about the game a seat has (or last had), for the issue body. */
function sessionLine(view: IsolationView): string | null {
  if (view.target === null) return null
  const parts = [`\`${view.target.exeName}\``, view.phase]
  if (view.endedReason) parts.push(`ended: ${view.endedReason}`)
  if (view.error) parts.push(`error: ${view.error.code}`)
  const problems = view.features
    .filter((f) => f.state === 'failed' || f.state === 'unsupported')
    .map((f) => `${f.name} ${f.state}`)
  if (problems.length) parts.push(problems.join(', '))
  if (view.detectedApis.length) parts.push(`APIs: ${view.detectedApis.join(', ')}`)
  if (view.limitations.length) parts.push(`limits: ${view.limitations.join(', ')}`)
  return parts.join(' · ')
}

/** A GitHub "new issue" link with the title and body filled in (kept well under URL limits). */
export function issueUrl(
  repository: string,
  sources: Pick<ReportSources, 'appVersion' | 'backend' | 'views'>,
  fileName: string,
  texts: IssueTexts,
): string {
  const { backend } = sources
  const sessions = sources.views.map(sessionLine).filter((line) => line !== null)
  const game = sources.views.find((view) => view.target !== null)?.target?.exeName
  const system = [
    `InputSplit ${sources.appVersion}`,
    backend.windowsBuild ? `Windows build ${backend.windowsBuild}` : null,
    backend.helperVersion ? `helper ${backend.helperVersion}` : `helper: ${backend.status}`,
    backend.simulated ? 'simulated backend' : null,
    backend.isElevated ? 'running as administrator' : null,
  ].filter(Boolean)
  const body = [
    `### ${texts.reportWhat}`,
    '',
    '',
    `### ${texts.reportExpected}`,
    '',
    '',
    '### Details',
    '',
    `- ${system.join(' · ')}`,
    ...sessions.map((line) => `- ${line}`),
    '',
    `> ${texts.reportAttach.replace('{file}', `\`${fileName}\``)}`,
  ].join('\n')
  const title = game ? `Problem with ${game}` : 'Problem report'
  const params = new URLSearchParams({ title, body: body.slice(0, 6000) })
  return `${repository}/issues/new?${params.toString()}`
}
