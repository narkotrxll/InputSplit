// Collects the license texts of every npm package bundled into the app (plus the native
// libraries) into resources/licenses/THIRD_PARTY_LICENSES.txt, which ships with the installer.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
// Packages whose code ends up in the bundles (see the renderer/main imports).
const ROOTS = [
  'vue',
  'vue-router',
  'pinia',
  'vue-i18n',
  'reka-ui',
  '@lucide/vue',
  'zod',
  'tailwindcss',
  '@fontsource-variable/inter',
  '@fontsource-variable/jetbrains-mono',
]

function packageDir(name, from) {
  let dir = from
  while (true) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const seen = new Map()
function visit(name, from) {
  const dir = packageDir(name, from)
  if (!dir || seen.has(dir)) return
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  seen.set(dir, {
    name: pkg.name,
    version: pkg.version,
    license:
      typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'UNKNOWN'),
    text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : null,
  })
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir)
}
for (const name of ROOTS) visit(name, root)

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
const sections = entries.map(
  (e) =>
    `${e.name}@${e.version} — ${e.license}\n${'-'.repeat(72)}\n${e.text ?? '(no license file in the package; see its package.json)'}\n`,
)
const native = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
const out = join(root, 'resources', 'licenses')
mkdirSync(out, { recursive: true })
writeFileSync(
  join(out, 'THIRD_PARTY_LICENSES.txt'),
  `InputSplit third-party licenses\n${'='.repeat(72)}\n\n${native}\n\n${'='.repeat(72)}\nnpm packages bundled into the app\n${'='.repeat(72)}\n\n${sections.join('\n')}`,
)
console.log(
  `Wrote ${entries.length} package licenses to resources/licenses/THIRD_PARTY_LICENSES.txt`,
)
const unknown = entries.filter((e) => !e.text)
if (unknown.length) console.warn(`No license file in: ${unknown.map((e) => e.name).join(', ')}`)
