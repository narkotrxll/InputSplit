/**
 * Built-in compatibility knowledge, keyed by executable name. Zod-free so the renderer can
 * use it to label windows before anything is started.
 *
 * - `launcher`  a store or launcher window: isolating it does nothing for the game.
 * - `online`    an online game: InputSplit is meant for single-player and offline play.
 * - `blocked`   refused before anything is injected. Used for games whose anti-cheat the
 *               helper cannot see on disk (VAC lives in Steam, not in the game folder).
 *
 * `features` holds per-game protection presets, applied when the game is chosen. Only add a
 * preset after it was verified on real hardware and recorded in docs/COMPATIBILITY.md.
 */
import type { FeatureFlags } from './domain'

export type CompatKind = 'launcher' | 'online' | 'blocked'

export interface CompatEntry {
  kind?: CompatKind
  /** Which anti-cheat makes a `blocked` game unsafe, shown in the refusal. */
  antiCheat?: string
  features?: Partial<FeatureFlags>
}

const LAUNCHERS = [
  'steam.exe',
  'steamwebhelper.exe',
  'epicgameslauncher.exe',
  'battle.net.exe',
  'eadesktop.exe',
  'origin.exe',
  'upc.exe',
  'ubisoftconnect.exe',
  'galaxyclient.exe',
  'riotclientservices.exe',
  'riotclientux.exe',
  'xboxpcapp.exe',
  'minecraftlauncher.exe',
  'playnite.desktopapp.exe',
  'playnite.fullscreenapp.exe',
  'heroic.exe',
  'itch.exe',
]

/** Online games without anti-cheat files the helper would find in their folder. */
const ONLINE = [
  'among us.exe',
  'left4dead2.exe',
  'warframe.x64.exe',
  'pathofexile_x64.exe',
  'pathofexilesteam.exe',
  'pathofexile_x64steam.exe',
  'wow.exe',
  'overwatch.exe',
  'ffxiv_dx11.exe',
  'gw2-64.exe',
]

/** Valve Anti-Cheat games: VAC bans for injected modules, and nothing on disk shows it. */
const VAC = ['cs2.exe', 'csgo.exe', 'dota2.exe', 'tf_win64.exe', 'deadlock.exe', 'project8.exe']

const ENTRIES = new Map<string, CompatEntry>([
  ['robloxplayerbeta.exe', { kind: 'blocked', antiCheat: 'Hyperion' }],
  ...LAUNCHERS.map((exe): [string, CompatEntry] => [exe, { kind: 'launcher' }]),
  ...ONLINE.map((exe): [string, CompatEntry] => [exe, { kind: 'online' }]),
  ...VAC.map((exe): [string, CompatEntry] => [
    exe,
    { kind: 'blocked', antiCheat: 'Valve Anti-Cheat (VAC)' },
  ]),
])

export function lookupCompat(exeName: string): CompatEntry | null {
  return ENTRIES.get(exeName.toLowerCase()) ?? null
}

/** What happened the last time a game was isolated on this PC (compat-history.json). */
export type CompatOutcome = 'works' | 'limited' | 'failed'
