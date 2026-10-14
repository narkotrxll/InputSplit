// Walks every screen in every interface language with the simulated backend and reports
// text that spills out of (or is cut off by) its button, badge or panel.
// Usage: npm run build && xvfb-run -a node scripts/check-layout.mjs [--locales ru,de] [--shots dir]
// Exit code 1 when something overflows.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const shotsDir = option('--shots') ? resolve(option('--shots')) : null

// The locale files are TypeScript; bundle them once so this script can read the texts.
const work = mkdtempSync(join(tmpdir(), 'inputsplit-layout-'))
const bundle = join(work, 'texts.mjs')
await build({
  stdin: {
    // Only the plain text modules: index.ts would drag in vue-i18n.
    contents: `${['en', 'uk', 'ru', 'es', 'de', 'fr', 'pt-BR', 'pl', 'tr', 'zh-CN', 'ja']
      .map((l) => `export * from './src/renderer/src/i18n/${l}.ts'`)
      .join('\n')}
      export { LOCALES, LOCALE_NAMES } from './src/shared/locales.ts'`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  alias: { '@shared': './src/shared' },
  logLevel: 'error',
})
const texts = await import(pathToFileURL(bundle).href)
const messages = Object.fromEntries(
  texts.LOCALES.map((locale) => [locale, texts[locale.replace('-', '')]]),
)
const locales = option('--locales')?.split(',') ?? texts.LOCALES
const viewports = [
  { width: 960, height: 640 }, // the window's minimum size
  { width: 1280, height: 820 },
]

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const exact = (text) => new RegExp(`^\\s*${escape(text)}\\s*$`)
const contains = (text) => new RegExp(escape(text))

/** Runs in the page: every visible element whose content is wider/taller than its box. */
function findOverflow() {
  const problems = []
  const describe = (el) => {
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')
    return `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 80)}"> ${text.slice(0, 90)}`
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, .sr-only') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    const scrollsX = ['auto', 'scroll'].includes(style.overflowX)
    const scrollsY = ['auto', 'scroll'].includes(style.overflowY)
    // Ellipsis is a deliberate cut for user data (window titles, paths), not for our texts.
    const ellipsis = style.textOverflow === 'ellipsis'
    if (!scrollsX && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      problems.push({
        kind: ellipsis ? 'truncated' : 'overflow-x',
        by: el.scrollWidth - el.clientWidth,
        what: describe(el),
      })
    }
    // Text that wrapped inside a fixed-height row (buttons, nav items) spills downwards;
    // a few pixels are tall glyphs in tight line heights.
    if (!scrollsY && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0) {
      problems.push({
        kind: 'overflow-y',
        by: el.scrollHeight - el.clientHeight,
        what: describe(el),
      })
    }
  }
  if (document.documentElement.scrollWidth > window.innerWidth) {
    problems.push({
      kind: 'page-x',
      by: document.documentElement.scrollWidth - window.innerWidth,
      what: 'page',
    })
  }
  return problems
}

const report = new Map() // "kind what" -> { kind, by, what, where: Set }
let failures = 0

for (const viewport of viewports) {
  for (const locale of locales) {
    const m = messages[locale]
    const userData = join(work, `${locale}-${viewport.width}`)
    const app = await electron.launch({
      args: ['.', '--no-sandbox', `--user-data-dir=${userData}`, `--lang=${locale}`],
      env: { ...process.env, INPUTSPLIT_SIMULATED_BACKEND: '1', ELECTRON_DISABLE_GPU: '1' },
    })
    const page = await app.firstWindow()
    await page.setViewportSize(viewport)
    await page.waitForSelector('#app nav', { timeout: 20_000 })
    await page.evaluate(
      (language) => window.inputsplit.invoke('settings:update', { language }),
      locale,
    )
    await page.reload()
    await page.waitForSelector('#app nav')
    await page.waitForTimeout(800)

    const check = async (state) => {
      await page.waitForTimeout(450)
      const where = `${locale} ${viewport.width}px ${state}`
      for (const problem of await page.evaluate(findOverflow)) {
        const key = `${problem.kind} ${problem.what}`
        const entry = report.get(key) ?? { ...problem, where: new Set() }
        entry.by = Math.max(entry.by, problem.by)
        entry.where.add(where)
        report.set(key, entry)
      }
      if (shotsDir) {
        const dir = join(shotsDir, `${viewport.width}`, locale)
        mkdirSync(dir, { recursive: true })
        await page.screenshot({ path: join(dir, `${state}.png`) })
      }
    }
    const button = (name) => page.getByRole('button', { name }).first()

    try {
      await check('01-onboarding')
      await button(exact(m.common.next)).click()
      await check('02-onboarding-risks')
      await page.getByText(m.onboarding.risks.acknowledge).click()
      await button(exact(m.common.next)).click()
      await check('03-onboarding-tips')
      await button(exact(m.onboarding.tips.finish)).click()
      await page.waitForTimeout(400)
      await check('04-dashboard-empty')

      await button(contains(m.dashboard.chooseGame)).click()
      await page.waitForTimeout(600)
      await check('05-game-picker')
      await page.getByRole('option', { name: /Red Dead Redemption 2/ }).click()
      await page.waitForTimeout(600)
      await button(contains(m.dashboard.controller)).click()
      await page.waitForTimeout(400)
      await check('06-controller-picker')
      await button(contains(m.common.slot.replace('{n}', '1'))).click()
      await page.waitForTimeout(300)
      await button(contains(m.dashboard.display)).click()
      await page.waitForTimeout(500)
      await check('07-display-picker')
      await page.getByRole('button', { name: /LG TV SSCR2/ }).click()
      await page.keyboard.press('Escape')
      await check('08-dashboard-ready')

      await button(exact(m.dashboard.start)).click()
      await page.waitForTimeout(4500)
      await check('09-dashboard-active')
      await page.mouse.wheel(0, 2000)
      await check('10-dashboard-active-bottom')
      await button(exact(m.dashboard.openDiagnostics)).click()
      await check('11-diagnostics')
      await page.keyboard.press('Escape')

      await page.keyboard.press('Control+2')
      await page.waitForTimeout(800)
      await check('12-applications')
      await button(exact(m.apps.filterAll)).click()
      await check('13-applications-all')

      await page.keyboard.press('Control+3')
      await page.waitForTimeout(1500)
      await check('14-controllers')
      // The selected controller starts its test by itself; start it only if it did not.
      const test = page.getByRole('button', { name: exact(m.controllers.test) })
      if (await test.count()) await test.first().click()
      await page.waitForTimeout(800)
      await check('15-controller-test')

      await page.keyboard.press('Control+4')
      await check('16-profiles-empty')
      await button(exact(m.profiles.new)).click()
      await page.waitForTimeout(500)
      await check('17-profile-editor')
      await page.keyboard.press('Escape')

      await page.keyboard.press('Control+1')
      await button(exact(m.dashboard.saveProfile)).click()
      await page.waitForTimeout(500)
      await button(exact(m.common.save)).click()
      await page.waitForTimeout(600)
      await page.keyboard.press('Control+4')
      await check('18-profiles')

      await page.keyboard.press('Control+5')
      await check('19-settings')
      await page.getByRole('combobox').first().click()
      await page.waitForTimeout(300)
      await check('20-language-menu')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+6')
      await check('21-about')

      await page.keyboard.press('Control+1')
      await button(exact(m.dashboard.stop)).click()
      await page.waitForTimeout(1500)
      await check('22-stopped')
    } catch (error) {
      failures++
      console.error(`${locale} ${viewport.width}px: walk failed: ${error.message.split('\n')[0]}`)
      if (shotsDir)
        await page.screenshot({ path: join(shotsDir, `failed-${locale}-${viewport.width}.png`) })
    }
    await app.close()
  }
}
rmSync(work, { recursive: true, force: true })

const problems = [...report.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.by - a.by)
for (const p of problems) {
  const where = [...p.where]
  console.log(
    `${p.kind} +${p.by}px ${p.what}\n    in ${where.length}: ${where.slice(0, 6).join(', ')}${where.length > 6 ? ' …' : ''}`,
  )
}
const real = problems.filter((p) => p.kind !== 'truncated')
console.log(
  `\n${real.length} overflow(s), ${problems.length - real.length} truncation(s), ${failures} failed walk(s)`,
)
process.exit(real.length > 0 || failures > 0 ? 1 : 0)
