/**
 * Application log: an in-memory ring buffer (for the Diagnostics panel) plus a local file.
 *
 * Privacy: callers log process names, PIDs, feature names and error codes. Never window
 * titles, typed text or file contents. Logs never leave the computer unless the user
 * exports them.
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream,
} from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '@shared/domain'
import { Emitter } from '../util/emitter'

const MAX_ENTRIES = 1000
const MAX_FILE_BYTES = 2 * 1024 * 1024

export class Logger {
  private readonly entries: LogEntry[] = []
  private readonly emitter = new Emitter<LogEntry>()
  private stream: WriteStream | null = null
  private verbose = false

  constructor(readonly directory: string | null) {
    if (directory === null) return
    try {
      mkdirSync(directory, { recursive: true })
      const file = join(directory, 'inputsplit.log')
      if (existsSync(file) && statSync(file).size > MAX_FILE_BYTES) {
        renameSync(file, join(directory, 'inputsplit.previous.log'))
      }
      this.stream = createWriteStream(file, { flags: 'a' })
    } catch (error) {
      console.error('Cannot open the log file', error)
    }
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose
  }

  log(level: LogLevel, source: LogEntry['source'], message: string): void {
    if (level === 'debug' && !this.verbose) return
    const entry: LogEntry = { time: Date.now(), level, source, message }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    this.stream?.write(
      `${new Date(entry.time).toISOString()} ${level.toUpperCase()} [${source}] ${message}\n`,
    )
    this.emitter.emit(entry)
  }

  debug(message: string): void {
    this.log('debug', 'app', message)
  }
  info(message: string): void {
    this.log('info', 'app', message)
  }
  warn(message: string): void {
    this.log('warn', 'app', message)
  }
  error(message: string): void {
    this.log('error', 'app', message)
  }

  all(): LogEntry[] {
    return [...this.entries]
  }

  onEntry(listener: (entry: LogEntry) => void): () => void {
    return this.emitter.on(listener)
  }

  close(): void {
    this.stream?.end()
    this.stream = null
  }
}
