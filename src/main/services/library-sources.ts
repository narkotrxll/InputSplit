/**
 * Finds installed games in the Steam, Epic Games and GOG Galaxy libraries, so a profile can
 * be created from a list instead of hunting for the right .exe.
 *
 * Only local files are read: Steam's library manifests, Epic's install manifests and the
 * GOG entries in the registry (read by LibraryService through PowerShell). Nothing is sent
 * anywhere and no store client has to be running.
 *
 * Steam does not record which executable starts a game, so `pickMainExe` guesses it from
 * the files in the install folder. The profile editor shows the result before it is saved.
 */
import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'
import type { LibraryStore } from '@shared/domain'

export interface FoundGame {
  store: LibraryStore
  /** The store's own id (Steam app id, Epic app name, GOG product id). */
  storeId: string
  name: string
  exePath: string
  /** A local cover image (Steam only), or null. */
  coverPath: string | null
}

// ---------------------------------------------------------------------------------------
// Valve KeyValues (.vdf / .acf): quoted keys and values, nested with braces

export interface Vdf {
  [key: string]: string | Vdf
}

/** Parses text KeyValues. Keys are lower-cased (Steam treats them case-insensitively). */
export function parseVdf(text: string): Vdf {
  const tokens: Array<string | '{' | '}'> = []
  const quoted: boolean[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '"') {
      let value = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1]!
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
        } else {
          value += text[i]
          i++
        }
      }
      i++
      tokens.push(value)
      quoted.push(true)
    } else if (c === '{' || c === '}') {
      tokens.push(c)
      quoted.push(false)
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (/\s/.test(c)) {
      i++
    } else {
      // Unquoted token (rare in Steam files).
      let value = ''
      while (i < text.length && !/[\s{}"]/.test(text[i]!)) value += text[i++]
      tokens.push(value)
      quoted.push(true)
    }
  }

  let position = 0
  const readObject = (): Vdf => {
    const object: Vdf = {}
    while (position < tokens.length) {
      const token = tokens[position]!
      if (token === '}' && !quoted[position]) {
        position++
        return object
      }
      position++
      const key = token.toLowerCase()
      const value = tokens[position]
      if (value === undefined) break
      if (value === '{' && !quoted[position]) {
        position++
        object[key] = readObject()
      } else {
        position++
        object[key] = value
      }
    }
    return object
  }
  return readObject()
}

function child(object: Vdf | undefined, key: string): Vdf | undefined {
  const value = object?.[key]
  return typeof value === 'object' ? value : undefined
}

function text(object: Vdf | undefined, key: string): string | undefined {
  const value = object?.[key]
  return typeof value === 'string' ? value : undefined
}

/** Library folders from `steamapps/libraryfolders.vdf` (both the old and the new layout). */
export function steamLibraryPaths(libraryFolders: string): string[] {
  const root = parseVdf(libraryFolders)
  const folders = child(root, 'libraryfolders')
  if (!folders) return []
  const paths: string[] = []
  for (const [key, value] of Object.entries(folders)) {
    if (!/^\d+$/.test(key)) continue
    if (typeof value === 'string') paths.push(value)
    else {
      const path = text(value, 'path')
      if (path) paths.push(path)
    }
  }
  return paths
}

/** Steamworks redistributables, Proton, runtimes: installed "apps" that are not games. */
const STEAM_NOT_GAMES = new Set(['228980', '1070560', '1391110', '1628350', '250820'])
const STEAM_NOT_GAME_NAME = /redistributable|steamvr|steam linux runtime|proton|dedicated server/i

export interface SteamApp {
  appId: string
  name: string
  installDir: string
}

/** An installed game from `appmanifest_<id>.acf`, or null for tools and partial installs. */
export function parseSteamManifest(acf: string): SteamApp | null {
  const state = child(parseVdf(acf), 'appstate')
  const appId = text(state, 'appid')
  const name = text(state, 'name')
  const installDir = text(state, 'installdir')
  if (!appId || !name || !installDir) return null
  if (STEAM_NOT_GAMES.has(appId) || STEAM_NOT_GAME_NAME.test(name)) return null
  // Bit 4 = fully installed (an update in progress keeps it set).
  const flags = Number(text(state, 'stateflags') ?? '4')
  if (Number.isFinite(flags) && (flags & 4) === 0) return null
  return { appId, name, installDir }
}

// ---------------------------------------------------------------------------------------
// Epic Games: one JSON manifest per installed item

export interface EpicItem {
  appName: string
  name: string
  installLocation: string
  launchExecutable: string
}

export function parseEpicManifest(json: string): EpicItem | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '')
  if (data['bIsIncompleteInstall'] === true) return null
  const categories = data['AppCategories']
  // The Unreal Engine and other tools are installed through the launcher too.
  if (Array.isArray(categories) && categories.length > 0 && !categories.includes('games')) {
    return null
  }
  const item = {
    appName: str('AppName') || str('MainGameAppName'),
    name: str('DisplayName'),
    installLocation: str('InstallLocation'),
    launchExecutable: str('LaunchExecutable'),
  }
  if (!item.appName || !item.name || !item.installLocation) return null
  return item
}

// ---------------------------------------------------------------------------------------
// GOG Galaxy: registry entries under HKLM\SOFTWARE\WOW6432Node\GOG.com\Games

export interface GogEntry {
  id: string
  name: string | null
  exe: string | null
  path: string | null
  /** Set for DLCs: they depend on the base game. */
  dependsOn: string | null
}

// ---------------------------------------------------------------------------------------
// Choosing the game's executable among the files of its install folder

const NOT_THE_GAME =
  /^(unins\d*|uninstall.*|setup.*|install.*|.*redist.*|dxsetup|dxwebsetup|dotnet.*|ndp\d.*|oalinst|physx.*|ue\d?prereq.*|.*crash.*|.*report.*|.*easyanticheat.*|eac.*|battleye.*|beservice.*|be_service|.*cefprocess.*|.*subprocess.*|.*helper.*|.*update.*|.*patch.*|.*touchup.*|activation.*|cleanup|7za?|python\w*|javaw?|node|ffmpeg|.*server.*|.*editor.*|.*config.*|.*settings.*|.*setting|.*benchmark.*|.*webhelper.*|.*dedicated.*|.*modmanager.*|.*mod_?tool.*|quicksfv|dosbox_?debug|.*vrmonitor.*|.*cleaner.*)$/i

const SKIPPED_FOLDERS =
  /^(_?commonredist|redist|redistributables?|__installer|_?installer|directx|dotnet|vcredist|prereqs?|prerequisites|_?support|crashreport\w*|easyanticheat|battleye|thirdparty|engine|tools?|sdk|mods?|logs?|__overlay|\.\w+)$/i

export interface ExeCandidate {
  /** Relative to the install folder, with `\` or `/` separators. */
  path: string
  size: number
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function initials(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word[0]))
    .join('')
}

/** The likeliest game executable, or null when the folder holds nothing that looks like one. */
export function pickMainExe(
  candidates: readonly ExeCandidate[],
  gameName: string,
  folderName: string,
): string | null {
  const game = normalize(gameName)
  const folder = normalize(folderName)
  const acronym = initials(gameName)
  let best: { path: string; score: number } | null = null
  for (const candidate of candidates) {
    const parts = candidate.path.split(/[\\/]/)
    const file = parts[parts.length - 1]!
    const base = file.replace(/\.exe$/i, '')
    if (!/\.exe$/i.test(file) || NOT_THE_GAME.test(base)) continue
    const name = normalize(base)
    const folders = parts.slice(0, -1).join('/').toLowerCase()
    let score = 0
    // Unreal games: the small exe at the top only starts this one, which owns the window.
    if (/-win(64|gdk)-shipping$/i.test(base)) score += 50
    if (name === game || name === folder) score += 40
    else if (name.length >= 3 && (game.includes(name) || name.includes(game))) score += 25
    else if (name.length >= 3 && (folder.includes(name) || name.includes(folder))) score += 20
    else if (acronym.length >= 2 && name.startsWith(acronym)) score += 30
    if (/launcher/i.test(base)) score -= 20
    if (/(^|\/)(win64|x64|bin64|binaries\/win64)(\/|$)/.test(folders)) score += 5
    if (/(^|\/)(win32|x86|bin32)(\/|$)/.test(folders)) score -= 5
    score += Math.max(0, 10 - (parts.length - 1) * 3)
    score += Math.min(20, Math.max(0, Math.log2(candidate.size / 100_000) * 2))
    if (best === null || score > best.score) best = { path: candidate.path, score }
  }
  return best?.path ?? null
}

/** Executables in a folder, a few levels deep, skipping redistributables and engine tools. */
export async function listExecutables(root: string, maxDepth = 4): Promise<ExeCandidate[]> {
  const found: ExeCandidate[] = []
  let visited = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (++visited > 4000 || found.length >= 200) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIPPED_FOLDERS.test(entry.name)) await walk(full, depth + 1)
      } else if (entry.isFile() && /\.exe$/i.test(entry.name)) {
        const size = await fs
          .stat(full)
          .then((s) => s.size)
          .catch(() => 0)
        found.push({ path: relative(root, full), size })
      }
    }
  }
  await walk(root, 0)
  return found
}

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function guessExe(installDir: string, name: string): Promise<string | null> {
  const picked = pickMainExe(await listExecutables(installDir), name, basename(installDir))
  return picked === null ? null : join(installDir, picked)
}

// ---------------------------------------------------------------------------------------
// Scanning

/** The portrait cover Steam keeps for its library view (layouts differ between versions). */
async function steamCover(steamPath: string, appId: string): Promise<string | null> {
  const cache = join(steamPath, 'appcache', 'librarycache')
  const flat = [`${appId}_library_600x900.jpg`, `${appId}_header.jpg`].map((f) => join(cache, f))
  for (const path of flat) if (await exists(path)) return path
  // Newer clients: librarycache/<appid>/[<hash>/]library_600x900.jpg
  const dir = join(cache, appId)
  for (const wanted of ['library_600x900.jpg', 'header.jpg']) {
    if (await exists(join(dir, wanted))) return join(dir, wanted)
    const subdirs = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const sub of subdirs) {
      if (sub.isDirectory() && (await exists(join(dir, sub.name, wanted)))) {
        return join(dir, sub.name, wanted)
      }
    }
  }
  return null
}

export async function scanSteam(steamPath: string): Promise<FoundGame[]> {
  const folders = await readText(join(steamPath, 'steamapps', 'libraryfolders.vdf'))
  const libraries = [steamPath, ...(folders ? steamLibraryPaths(folders) : [])]
  const seen = new Set<string>()
  const games: FoundGame[] = []
  for (const library of libraries) {
    const key = library.toLowerCase().replace(/[\\/]+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    const apps = join(library, 'steamapps')
    const files = await fs.readdir(apps).catch(() => [] as string[])
    for (const file of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue
      const acf = await readText(join(apps, file))
      const app = acf === null ? null : parseSteamManifest(acf)
      if (app === null) continue
      const installDir = join(apps, 'common', app.installDir)
      const exePath = await guessExe(installDir, app.name)
      if (exePath === null) continue
      games.push({
        store: 'steam',
        storeId: app.appId,
        name: app.name,
        exePath,
        coverPath: await steamCover(steamPath, app.appId),
      })
    }
  }
  return games
}

export async function scanEpic(manifestsDir: string): Promise<FoundGame[]> {
  const files = await fs.readdir(manifestsDir).catch(() => [] as string[])
  const games: FoundGame[] = []
  for (const file of files) {
    if (!/\.item$/i.test(file)) continue
    const json = await readText(join(manifestsDir, file))
    const item = json === null ? null : parseEpicManifest(json)
    if (item === null) continue
    const launch = item.launchExecutable
      ? join(item.installLocation, ...item.launchExecutable.split(/[\\/]/))
      : null
    // The launch file of an Unreal game is a stub; prefer the real game exe when present.
    let exePath = await guessExe(item.installLocation, item.name)
    if (launch !== null && /\.exe$/i.test(launch) && (await exists(launch))) {
      if (exePath === null || !/-win(64|gdk)-shipping\.exe$/i.test(exePath)) exePath = launch
    }
    if (exePath === null) continue
    games.push({ store: 'epic', storeId: item.appName, name: item.name, exePath, coverPath: null })
  }
  return games
}

export async function scanGog(entries: readonly GogEntry[]): Promise<FoundGame[]> {
  const games: FoundGame[] = []
  for (const entry of entries) {
    if (entry.dependsOn || !entry.name) continue
    let exePath =
      entry.exe && /\.exe$/i.test(entry.exe) && (await exists(entry.exe)) ? entry.exe : null
    if (exePath === null && entry.path) exePath = await guessExe(entry.path, entry.name)
    if (exePath === null) continue
    games.push({ store: 'gog', storeId: entry.id, name: entry.name, exePath, coverPath: null })
  }
  return games
}

/** One entry per executable (a game can be in two stores), sorted by name. */
export function mergeGames(lists: readonly FoundGame[][]): FoundGame[] {
  const byExe = new Map<string, FoundGame>()
  for (const game of lists.flat()) {
    const key = game.exePath.toLowerCase()
    if (!byExe.has(key)) byExe.set(key, game)
  }
  return [...byExe.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}
