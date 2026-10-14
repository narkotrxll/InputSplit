import { describe, expect, it } from 'vitest'
import { IDLE_VIEW, type BackendState } from '@shared/domain'
import { buildReport, issueUrl } from './diagnostics'

const backend: BackendState = {
  status: 'ready',
  reason: null,
  simulated: false,
  helperVersion: '0.1.0',
  windowsBuild: 26100,
  isElevated: false,
  hookDllFound: true,
  emergencyHotkey: 'Ctrl+Alt+Shift+F12',
  emergencyHotkeyRegistered: true,
}
const view = {
  ...IDLE_VIEW,
  phase: 'ended' as const,
  target: { pid: 1, hwnd: 2, title: 'Secret window title', exeName: 'Celeste.exe', exePath: null },
  endedReason: 'processExited' as const,
  detectedApis: ['xinput' as const],
}
const texts = { reportWhat: 'What?', reportExpected: 'Expected?', reportAttach: 'Attach {file}.' }

describe('problem reports', () => {
  it('pre-fills a GitHub issue without window titles', () => {
    const url = new URL(
      issueUrl(
        'https://github.com/o/r',
        { appVersion: '1.2.3', backend, views: [view, IDLE_VIEW] },
        'report.txt',
        texts,
      ),
    )
    expect(url.pathname).toBe('/o/r/issues/new')
    expect(url.searchParams.get('title')).toBe('Problem with Celeste.exe')
    const body = url.searchParams.get('body')!
    expect(body).toContain('### What?')
    expect(body).toContain('InputSplit 1.2.3 · Windows build 26100 · helper 0.1.0')
    expect(body).toContain('`Celeste.exe` · ended · ended: processExited · APIs: xinput')
    expect(body).toContain('Attach `report.txt`.')
    expect(body).not.toContain('Secret')
  })

  it('keeps only the executable name of the game in the report file', () => {
    const report = buildReport({
      appVersion: '1.2.3',
      electron: '38',
      platform: 'win32',
      backend,
      views: [view],
      settings: {} as never,
      logs: [],
    })
    expect(report).toContain('Celeste.exe')
    expect(report).not.toContain('Secret')
  })
})
