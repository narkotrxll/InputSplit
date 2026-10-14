// Picks the version for an automatic release from main.
//
// The major.minor line comes from package.json; the patch number counts up from the existing
// `v<major>.<minor>.*` tags. So with package.json at 0.1.0 the releases are v0.1.0, v0.1.1,
// v0.1.2, … and bumping package.json to 0.2.0 starts a new line at v0.2.0.
//
// Usage: git tag --list 'v*' | node scripts/release-version.mjs   → prints e.g. 0.1.3
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function nextVersion(packageVersion, tags) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageVersion)
  if (!match) throw new Error(`package.json version "${packageVersion}" is not x.y.z`)
  const [, major, minor, patch] = match.map(Number)
  const line = new RegExp(`^v${major}\\.${minor}\\.(\\d+)$`)
  const taken = tags.map((tag) => line.exec(tag.trim())).filter(Boolean)
  if (taken.length === 0) return `${major}.${minor}.${patch}`
  const highest = Math.max(...taken.map((m) => Number(m[1])))
  return `${major}.${minor}.${Math.max(highest + 1, patch)}`
}

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))
const tags = readFileSync(0, 'utf8').split('\n').filter(Boolean)
process.stdout.write(nextVersion(pkg.version, tags))
