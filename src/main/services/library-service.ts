/**
 * Installed games from Steam, Epic Games and GOG Galaxy (see library-sources.ts), with
 * their covers. The renderer only ever names a game by id; paths stay in this process.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import type { LibraryGame } from '@shared/domain'
import type { Logger } from './logger'
import {
  mergeGames,
  scanEpic,
  scanGog,
  scanSteam,
  type FoundGame,
  type GogEntry,
} from './library-sources'

/** Reads the Steam folder and the GOG entries from the registry in one go, as UTF-8 JSON. */
const REGISTRY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$steam = (Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam').SteamPath
if (-not $steam) { $steam = (Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam').InstallPath }
$gog = @(Get-ChildItem 'HKLM:\\SOFTWARE\\WOW6432Node\\GOG.com\\Games' | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  [pscustomobject]@{ id = $_.PSChildName; name = $p.gameName; exe = $p.exe; path = $p.path; dependsOn = $p.dependsOn }
})
ConvertTo-Json -Compress -Depth 3 -InputObject @{ steam = $steam; gog = $gog }
`

interface RegistryInfo {
  steam: string | null
  gog: GogEntry[]
}

function readRegistry(): Promise<RegistryInfo> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', REGISTRY_SCRIPT],
      { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve({ steam: null, gog: [] })
        try {
          const data = JSON.parse(stdout.trim()) as { steam?: unknown; gog?: unknown }
          const str = (value: unknown) =>
            typeof value === 'string' && value.trim() ? value.trim() : null
          const gog = (Array.isArray(data.gog) ? data.gog : []).map((raw: unknown) => {
            const entry = (raw ?? {}) as Record<string, unknown>
            return {
              id: String(entry['id'] ?? ''),
              name: str(entry['name']),
              exe: str(entry['exe']),
              path: str(entry['path']),
              dependsOn: str(entry['dependsOn']),
            }
          })
          // Steam writes the path with forward slashes.
          resolve({ steam: str(data.steam)?.replace(/\//g, '\\') ?? null, gog })
        } catch {
          resolve({ steam: null, gog: [] })
        }
      },
    )
  })
}

/** Shown with the simulated backend so the screens can be checked off Windows. */
const SIMULATED: FoundGame[] = [
  [
    'steam',
    '367520',
    'Hollow Knight',
    'C:\\Steam\\steamapps\\common\\Hollow Knight\\hollow_knight.exe',
  ],
  [
    'steam',
    '1174180',
    'Red Dead Redemption 2',
    'C:\\Steam\\steamapps\\common\\Red Dead Redemption 2\\RDR2.exe',
  ],
  [
    'steam',
    '1426210',
    'It Takes Two',
    'C:\\Steam\\steamapps\\common\\ItTakesTwo\\Nuts\\Binaries\\Win64\\ItTakesTwo.exe',
  ],
  ['epic', 'Salt', 'Celeste', 'C:\\Program Files\\Epic Games\\Celeste\\Celeste.exe'],
  [
    'epic',
    'Fortnite',
    'Rocket League',
    'C:\\Program Files\\Epic Games\\rocketleague\\Binaries\\Win64\\RocketLeague.exe',
  ],
  [
    'gog',
    '1207664663',
    'The Witcher 3: Wild Hunt',
    'C:\\GOG Games\\The Witcher 3 Wild Hunt\\bin\\x64\\witcher3.exe',
  ],
  ['gog', '1990222347', 'Cuphead', 'C:\\GOG Games\\Cuphead\\Cuphead.exe'],
].map(([store, storeId, name, exePath]) => ({
  store: store as FoundGame['store'],
  storeId: storeId!,
  name: name!,
  exePath: exePath!,
  coverPath: null,
}))

export class LibraryService {
  private covers = new Map<string, string>()
  private readonly coverCache = new Map<string, Promise<string | null>>()

  constructor(
    private readonly logger: Logger,
    private readonly simulated: boolean,
  ) {}

  async scan(): Promise<LibraryGame[]> {
    const started = Date.now()
    let found: FoundGame[]
    if (this.simulated) found = SIMULATED
    else if (process.platform !== 'win32') found = []
    else {
      const registry = await readRegistry()
      const steamPath = registry.steam ?? 'C:\\Program Files (x86)\\Steam'
      const epicDir = join(
        process.env['PROGRAMDATA'] ?? 'C:\\ProgramData',
        'Epic',
        'EpicGamesLauncher',
        'Data',
        'Manifests',
      )
      const results = await Promise.all([
        scanSteam(steamPath).catch(() => []),
        scanEpic(epicDir).catch(() => []),
        scanGog(registry.gog).catch(() => []),
      ])
      found = mergeGames(results)
    }
    this.covers = new Map()
    this.coverCache.clear()
    const games = found.map((game) => {
      const id = `${game.store}:${game.storeId}`
      if (game.coverPath !== null) this.covers.set(id, game.coverPath)
      const exeName = game.exePath.split('\\').pop() ?? game.exePath
      return {
        id,
        store: game.store,
        name: game.name,
        exeName,
        exePath: game.exePath,
        hasCover: game.coverPath !== null,
      }
    })
    this.logger.info(`Game library: ${games.length} installed games (${Date.now() - started} ms)`)
    return games
  }

  /** A small cover as a data URL, for a game from the last scan. */
  cover(id: string): Promise<string | null> {
    const path = this.covers.get(id)
    if (path === undefined) return Promise.resolve(null)
    let cover = this.coverCache.get(id)
    if (cover === undefined) {
      cover = Promise.resolve()
        .then(() => {
          const image = nativeImage.createFromPath(path)
          return image.isEmpty() ? null : image.resize({ height: 144, quality: 'good' }).toDataURL()
        })
        .catch(() => null)
      this.coverCache.set(id, cover)
    }
    return cover
  }
}
