/**
 * Remembers how each game behaved the last time it was isolated on this PC, so the game
 * picker can say "worked last time" before anything is started. Keyed by executable name;
 * window titles and paths are never stored.
 */
import { z } from 'zod'
import { CompatHistorySchema, type CompatHistory } from '@shared/domain'
import type { CompatOutcome } from '@shared/compatibility'
import { Emitter } from '../util/emitter'
import { JsonFileStore } from './json-store'

const FileSchema = z.object({ version: z.literal(1), games: CompatHistorySchema })

/** Enough for anyone's library; the oldest entries are dropped beyond this. */
const MAX_GAMES = 500

export class CompatHistoryService {
  private games: CompatHistory = {}
  private readonly store: JsonFileStore<typeof FileSchema>
  readonly changes = new Emitter<CompatHistory>()

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

  get(): CompatHistory {
    return this.games
  }

  async record(exeName: string, outcome: CompatOutcome): Promise<void> {
    const entries = Object.entries({
      ...this.games,
      [exeName.toLowerCase()]: { outcome, at: this.now().toISOString() },
    })
      .sort(([, a], [, b]) => b.at.localeCompare(a.at))
      .slice(0, MAX_GAMES)
    const games = Object.fromEntries(entries)
    await this.store.write({ version: 1, games })
    this.games = games
    this.changes.emit(games)
  }
}
