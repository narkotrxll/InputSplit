import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mergeGames,
  parseEpicManifest,
  parseSteamManifest,
  parseVdf,
  pickMainExe,
  scanEpic,
  scanSteam,
  steamLibraryPaths,
} from './library-sources'

const LIBRARY_FOLDERS = `
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
		"apps"
		{
			"228980"		"0"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
	}
}`

const MANIFEST = (id: string, name: string, dir: string, flags = '4') => `
"AppState"
{
	"appid"		"${id}"
	"Universe"		"1"
	"name"		"${name}"
	"StateFlags"		"${flags}"
	"installdir"		"${dir}"
}`

describe('parseVdf', () => {
  it('reads nested keys, lower-cases them and unescapes backslashes', () => {
    const vdf = parseVdf('"A" { "Key" "C:\\\\Games" // comment\n "sub" { "x" "1" } }')
    expect(vdf).toEqual({ a: { key: 'C:\\Games', sub: { x: '1' } } })
  })

  it('finds every Steam library folder', () => {
    expect(steamLibraryPaths(LIBRARY_FOLDERS)).toEqual([
      'C:\\Program Files (x86)\\Steam',
      'D:\\SteamLibrary',
    ])
    // The layout before 2021: "1" "D:\\SteamLibrary"
    expect(
      steamLibraryPaths('"LibraryFolders" { "TimeNextStatsReport" "1" "1" "E:\\\\Lib" }'),
    ).toEqual(['E:\\Lib'])
  })
})

describe('parseSteamManifest', () => {
  it('returns installed games only', () => {
    expect(parseSteamManifest(MANIFEST('367520', 'Hollow Knight', 'Hollow Knight'))).toEqual({
      appId: '367520',
      name: 'Hollow Knight',
      installDir: 'Hollow Knight',
    })
    expect(parseSteamManifest(MANIFEST('367520', 'Hollow Knight', 'HK', '1026'))).toBeNull()
    expect(
      parseSteamManifest(MANIFEST('228980', 'Steamworks Common Redistributables', 'x')),
    ).toBeNull()
    expect(parseSteamManifest(MANIFEST('1493710', 'Proton Experimental', 'x'))).toBeNull()
  })
})

describe('parseEpicManifest', () => {
  const item = (extra: object) =>
    JSON.stringify({
      AppName: 'Salt',
      DisplayName: 'Celeste',
      InstallLocation: 'C:\\Epic\\Celeste',
      LaunchExecutable: 'Celeste.exe',
      AppCategories: ['public', 'games', 'applications'],
      ...extra,
    })

  it('reads games and skips tools and partial installs', () => {
    expect(parseEpicManifest(item({}))).toEqual({
      appName: 'Salt',
      name: 'Celeste',
      installLocation: 'C:\\Epic\\Celeste',
      launchExecutable: 'Celeste.exe',
    })
    expect(parseEpicManifest(item({ bIsIncompleteInstall: true }))).toBeNull()
    expect(parseEpicManifest(item({ AppCategories: ['engines'] }))).toBeNull()
    expect(parseEpicManifest('not json')).toBeNull()
  })
})

describe('pickMainExe', () => {
  const exe = (path: string, size = 5_000_000) => ({ path, size })

  it('prefers the executable named like the game', () => {
    expect(
      pickMainExe(
        [exe('UnityCrashHandler64.exe'), exe('hollow_knight.exe', 650_000), exe('unins000.exe')],
        'Hollow Knight',
        'Hollow Knight',
      ),
    ).toBe('hollow_knight.exe')
  })

  it('matches initials such as RDR2', () => {
    expect(
      pickMainExe(
        [exe('PlayRDR2.exe', 3_000_000), exe('RDR2.exe', 90_000_000), exe('dxwebsetup.exe')],
        'Red Dead Redemption 2',
        'Red Dead Redemption 2',
      ),
    ).toBe('RDR2.exe')
  })

  it('takes the Unreal shipping executable over the small starter', () => {
    expect(
      pickMainExe(
        [
          exe('Stray.exe', 200_000),
          exe('Hk_project\\Binaries\\Win64\\Stray-Win64-Shipping.exe', 90_000_000),
          exe('Engine\\Binaries\\Win64\\CrashReportClient.exe'),
        ],
        'Stray',
        'Stray',
      ),
    ).toBe('Hk_project\\Binaries\\Win64\\Stray-Win64-Shipping.exe')
  })

  it('returns null when only installers and tools are left', () => {
    expect(pickMainExe([exe('vc_redist.x64.exe'), exe('UnityCrashHandler64.exe')], 'X', 'X')).toBe(
      null,
    )
  })
})

describe('scanning folders', () => {
  it('finds Steam games in every library with their executable and cover', async () => {
    const root = mkdtempSync(join(tmpdir(), 'inputsplit-steam-'))
    const steam = join(root, 'Steam')
    const second = join(root, 'Library2')
    mkdirSync(join(steam, 'steamapps', 'common', 'Hollow Knight'), { recursive: true })
    mkdirSync(join(second, 'steamapps', 'common', 'Celeste'), { recursive: true })
    mkdirSync(join(steam, 'appcache', 'librarycache', '367520'), { recursive: true })
    writeFileSync(
      join(steam, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders" { "0" { "path" "${steam.replace(/\\/g, '\\\\')}" } "1" { "path" "${second.replace(/\\/g, '\\\\')}" } }`,
    )
    writeFileSync(
      join(steam, 'steamapps', 'appmanifest_367520.acf'),
      MANIFEST('367520', 'Hollow Knight', 'Hollow Knight'),
    )
    writeFileSync(join(steam, 'steamapps', 'common', 'Hollow Knight', 'hollow_knight.exe'), 'x')
    writeFileSync(join(steam, 'steamapps', 'common', 'Hollow Knight', 'unins000.exe'), 'x')
    writeFileSync(join(steam, 'appcache', 'librarycache', '367520', 'library_600x900.jpg'), 'x')
    writeFileSync(
      join(second, 'steamapps', 'appmanifest_504230.acf'),
      MANIFEST('504230', 'Celeste', 'Celeste'),
    )
    writeFileSync(join(second, 'steamapps', 'common', 'Celeste', 'Celeste.exe'), 'x')

    const games = mergeGames([await scanSteam(steam)])
    expect(games.map((g) => [g.name, g.exePath, g.coverPath])).toEqual([
      ['Celeste', join(second, 'steamapps', 'common', 'Celeste', 'Celeste.exe'), null],
      [
        'Hollow Knight',
        join(steam, 'steamapps', 'common', 'Hollow Knight', 'hollow_knight.exe'),
        join(steam, 'appcache', 'librarycache', '367520', 'library_600x900.jpg'),
      ],
    ])
  })

  it('uses the launch executable from Epic manifests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'inputsplit-epic-'))
    const manifests = join(root, 'Manifests')
    const game = join(root, 'Celeste')
    mkdirSync(manifests)
    mkdirSync(game)
    writeFileSync(join(game, 'Celeste.exe'), 'x')
    writeFileSync(
      join(manifests, 'A1.item'),
      JSON.stringify({
        AppName: 'Salt',
        DisplayName: 'Celeste',
        InstallLocation: game,
        LaunchExecutable: 'Celeste.exe',
      }),
    )
    const games = await scanEpic(manifests)
    expect(games).toEqual([
      {
        store: 'epic',
        storeId: 'Salt',
        name: 'Celeste',
        exePath: join(game, 'Celeste.exe'),
        coverPath: null,
      },
    ])
  })

  it('lists a game found in two stores once', () => {
    const game = {
      store: 'steam' as const,
      storeId: '1',
      name: 'A',
      exePath: 'C:\\A\\a.exe',
      coverPath: null,
    }
    expect(mergeGames([[game], [{ ...game, store: 'gog', exePath: 'c:\\a\\A.EXE' }]])).toHaveLength(
      1,
    )
  })
})
