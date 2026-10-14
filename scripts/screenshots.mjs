// Captures UI screenshots with the development-only simulated backend.
// Usage: npm run build && xvfb-run -a node scripts/screenshots.mjs [outDir]
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const outDir = resolve(process.argv[2] ?? 'docs/screenshots')
mkdirSync(outDir, { recursive: true })
const userData = join(tmpdir(), `inputsplit-shots-${Date.now()}`)

const app = await electron.launch({
  args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
  env: { ...process.env, INPUTSPLIT_SIMULATED_BACKEND: '1', ELECTRON_DISABLE_GPU: '1' },
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1280, height: 820 })
await page.waitForSelector('#app nav', { timeout: 20_000 })
await page.waitForTimeout(1200)
const shot = async (name) => {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  console.log(`saved ${name}.png`)
}

const theme = process.env.SHOT_THEME
// Onboarding (first run)
await shot('01-onboarding')
await page.getByRole('button', { name: 'Next' }).click()
await shot('02-onboarding-risks')
await page.getByText('I understand').click()
await page.getByRole('button', { name: 'Next' }).click()
await page.getByRole('button', { name: 'Get started' }).click()
await page.waitForTimeout(400)
if (theme === 'light') {
  await page.evaluate(() => window.inputsplit.invoke('settings:update', { theme: 'light' }))
  await page.reload()
  await page.waitForSelector('#app nav')
}

await shot('03-dashboard-empty')

// Choose a game from the picker
await page.getByRole('button', { name: /Choose a game/ }).click()
await page.waitForTimeout(600)
await shot('04-game-picker')
await page.getByRole('option', { name: /Red Dead Redemption 2/ }).click()
await page.waitForTimeout(600)

// Controller + display
await page
  .getByRole('button', { name: /Controller/ })
  .first()
  .click()
await page.waitForTimeout(400)
await page
  .getByRole('button', { name: /Slot 1/ })
  .first()
  .click()
await page.waitForTimeout(300)
await page
  .getByRole('button', { name: /Screen/ })
  .first()
  .click()
await page.waitForTimeout(500)
await shot('05-display-picker')
await page.getByRole('button', { name: /LG TV SSCR2/ }).click()
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await shot('06-dashboard-ready')

await page.getByRole('button', { name: 'Start isolation' }).click()
await page.waitForTimeout(4500)
await shot('07-dashboard-active')

await page.keyboard.press('Control+2')
await page.waitForTimeout(800)
await shot('08-applications')
await page.getByRole('button', { name: 'All windows' }).click()
await shot('09-applications-all')

await page.keyboard.press('Control+3')
await page.waitForTimeout(1500)
await shot('10-controllers')

await page.keyboard.press('Control+4')
await shot('11-profiles-empty')

await page.keyboard.press('Control+5')
await shot('12-settings')
await page.keyboard.press('Control+6')
await shot('13-about')

await page.keyboard.press('Control+1')
await page.getByRole('button', { name: 'Diagnostics' }).click()
await shot('14-diagnostics')
await page.keyboard.press('Escape')

// Refused game (anti-cheat)
await page.getByRole('button', { name: 'Stop isolation' }).click()
await page.waitForTimeout(1500)
await shot('15-stopped')

await app.close()
rmSync(userData, { recursive: true, force: true })
