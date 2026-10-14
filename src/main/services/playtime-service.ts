/**
 * Play time per game: how long each game was isolated, summed over sessions. Keyed by
 * lower-case executable name, like the compatibility memory, so it survives renaming or
 * re-creating a profile.
 */
import { z } from 'zod'
import { PlaytimeSchema, type Playtime } from '@shared/domain'
import { Emitter } from '../util/emitter'
import { JsonFileStore } from './json-store'

const FileSchema = z.object({ version: z.literal(1), games: PlaytimeSchema })

/** Shorter sessions are a start that was stopped again right away, not play. */
export const MIN_SESSION_MS = 10_000
const MAX_GAMES = 1000

export class PlaytimeService {
  private games: Playtime = {}
  private readonly store: JsonFileStore<typeof FileSchema>
  readonly changes = new Emitter<Playtime>()

  constructor(
    path: string,
    onWarning: (message: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new JsonFileStore(path, FileSchema, () => ({ version: 1, games: {} }), onWarning)
  }

  async load(): Promise<void> {
    this.games = (await this.store.read()).games
  }

  get(): Playtime {
    return this.games
  }

  async record(exeName: string, durationMs: number): Promise<void> {
    if (!(durationMs >= MIN_SESSION_MS)) return
    const key = exeName.toLowerCase()
    const previous = this.games[key]
    await this.persist({
      ...this.games,
      [key]: {
        totalMs: (previous?.totalMs ?? 0) + Math.round(durationMs),
        sessions: (previous?.sessions ?? 0) + 1,
        lastPlayedAt: this.now().toISOString(),
      },
    })
  }

  /**
   * Adds play time from a backup. Per game the larger total wins, so importing the same
   * backup twice (or into the PC it came from) never counts anything twice.
   */
  async merge(incoming: Playtime): Promise<void> {
    const games = { ...this.games }
    for (const [exe, record] of Object.entries(incoming)) {
      const key = exe.toLowerCase()
      const current = games[key]
      if (current === undefined || record.totalMs > current.totalMs) {
        games[key] = {
          ...record,
          lastPlayedAt:
            current && current.lastPlayedAt > record.lastPlayedAt
              ? current.lastPlayedAt
              : record.lastPlayedAt,
        }
      }
    }
    await this.persist(games)
  }

  private async persist(next: Playtime): Promise<void> {
    const games = Object.fromEntries(
      Object.entries(next)
        .sort(([, a], [, b]) => b.lastPlayedAt.localeCompare(a.lastPlayedAt))
        .slice(0, MAX_GAMES),
    )
    await this.store.write({ version: 1, games })
    this.games = games
    this.changes.emit(games)
  }
}
