/**
 * A JSON file validated by a Zod schema, written atomically.
 *
 * Atomic write = write a temporary file next to the target, then rename it over the target.
 * A crash in the middle therefore never leaves a half-written settings file behind.
 * A file that does not match the schema is kept as `<name>.corrupt-<time>.json` for
 * inspection and replaced by defaults, instead of crashing the app.
 */
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { z } from 'zod'

export class JsonFileStore<S extends z.ZodType> {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly schema: S,
    private readonly defaults: () => z.output<S>,
    private readonly onWarning: (message: string) => void = () => {},
  ) {}

  async read(): Promise<z.output<S>> {
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults()
      throw error
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return this.quarantine('is not valid JSON')
    }
    const parsed = this.schema.safeParse(json)
    if (!parsed.success) return this.quarantine('does not match the expected format')
    return parsed.data
  }

  /** Writes are serialised so two quick saves can never interleave. */
  write(value: z.output<S>): Promise<void> {
    const data = this.schema.parse(value)
    const task = this.writeQueue.then(async () => {
      await fs.mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid}.tmp`
      await fs.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(temporary, this.path)
    })
    this.writeQueue = task.catch(() => {})
    return task
  }

  private async quarantine(problem: string): Promise<z.output<S>> {
    const backup = this.path.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`
    await fs.rename(this.path, backup).catch(() => {})
    this.onWarning(`${this.path} ${problem}; using defaults (kept a copy at ${backup})`)
    return this.defaults()
  }
}
