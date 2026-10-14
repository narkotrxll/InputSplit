/**
 * Starts and supervises inputsplit-helper.exe.
 *
 * Supervision rules (docs/ARCHITECTURE.md §3):
 *  - ping every 5 s; two missed pings → the helper is considered hung and is killed;
 *  - an unexpected exit is restarted with back-off (1 s, 2 s, 4 s); more than three
 *    restarts within a minute → status "crashed", the user can retry from the UI;
 *  - when the helper dies, the hook DLL in the game detects the broken pipe and disables
 *    itself, so a crash never leaves a game half-isolated.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { BackendState } from '@shared/domain'
import { AppException } from '@shared/errors'
import { Emitter } from '../util/emitter'
import type { Logger } from '../services/logger'
import { initialBackendState, type NativeBackend } from './backend'
import {
  HELPER_PROTOCOL_VERSION,
  LineSplitter,
  helperMethods,
  parseHelperEvent,
  parseHelperLine,
  type HelperEvent,
  type HelperMethod,
  type HelperParams,
  type HelperResult,
} from './protocol'

interface Pending {
  method: HelperMethod
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface HelperClientOptions {
  executablePath: string | null
  logger: Logger
  platform?: NodeJS.Platform
  spawnProcess?: (path: string) => ChildProcessWithoutNullStreams
  pingIntervalMs?: number
  requestTimeoutMs?: number
}

const RESTART_WINDOW_MS = 60_000
const MAX_RESTARTS = 3

export class HelperClient implements NativeBackend {
  readonly simulated = false
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private state: BackendState = initialBackendState(false)
  private readonly events = new Emitter<HelperEvent>()
  private readonly states = new Emitter<BackendState>()
  private restartTimes: number[] = []
  private stopping = false
  private pingTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private missedPings = 0

  constructor(private readonly options: HelperClientOptions) {}

  getState(): BackendState {
    return this.state
  }

  onEvent(listener: (event: HelperEvent) => void): () => void {
    return this.events.on(listener)
  }

  onState(listener: (state: BackendState) => void): () => void {
    return this.states.on(listener)
  }

  async start(): Promise<void> {
    this.stopping = false
    const platform = this.options.platform ?? process.platform
    if (platform !== 'win32') {
      this.setState({ status: 'unavailable', reason: 'unsupportedPlatform' })
      return
    }
    const path = this.options.executablePath
    if (path === null || !existsSync(path)) {
      this.options.logger.error(`Helper not found at ${path ?? '(no path)'}`)
      this.setState({ status: 'unavailable', reason: 'helperMissing' })
      return
    }
    await this.launch(path)
  }

  async restart(): Promise<void> {
    this.restartTimes = []
    await this.stop()
    await this.start()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.clearTimers()
    const child = this.child
    if (child === null) return
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill()
        resolve()
      }, 4000)
      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
      try {
        // The helper stops every session, answers, and exits. Closing stdin has the same
        // effect, so even if the write fails the helper still shuts down.
        child.stdin.write(`${JSON.stringify({ id: 0, method: 'shutdown' })}\n`)
        child.stdin.end()
      } catch {
        child.kill()
      }
    })
  }

  request<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    timeoutMs = this.options.requestTimeoutMs ?? 15_000,
  ): Promise<HelperResult<M>> {
    const child = this.child
    if (child === null || (this.state.status !== 'ready' && method !== 'hello')) {
      return Promise.reject(new AppException('backendUnavailable', 'The native helper is not running.'))
    }
    const id = this.nextId++
    return new Promise<HelperResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppException('helperTimeout', `The helper did not answer "${method}" in time.`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  // -------------------------------------------------------------------------------------

  private async launch(path: string): Promise<void> {
    this.setState({ status: this.restartTimes.length > 0 ? 'restarting' : 'starting', reason: null })
    const child = this.options.spawnProcess
      ? this.options.spawnProcess(path)
      : spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const splitter = new LineSplitter()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of splitter.push(chunk)) this.handleLine(line)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => this.options.logger.log('warn', 'helper', chunk.trim()))
    child.on('error', (error) => this.options.logger.error(`Helper process error: ${error.message}`))
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))
    child.stdin.on('error', () => {}) // EPIPE after the helper died; handled by 'exit'

    try {
      const hello = await this.request('hello', {}, 10_000)
      if (hello.protocolVersion !== HELPER_PROTOCOL_VERSION) {
        throw new AppException('protocolMismatch', `Helper protocol ${hello.protocolVersion}`)
      }
      this.options.logger.info(
        `Helper ${hello.helperVersion} ready (Windows build ${hello.windowsBuild}, elevated: ${hello.isElevated})`,
      )
      this.setState({
        status: 'ready',
        reason: hello.hookDllFound ? null : 'hookMissing',
        helperVersion: hello.helperVersion,
        windowsBuild: hello.windowsBuild,
        isElevated: hello.isElevated,
        hookDllFound: hello.hookDllFound,
        emergencyHotkey: hello.emergencyHotkey,
      })
      this.startPing()
    } catch (error) {
      const code = error instanceof AppException ? error.code : 'helperStartFailed'
      this.options.logger.error(`Helper handshake failed: ${String(error)}`)
      this.setState({ status: 'crashed', reason: code })
      child.kill()
    }
  }

  private handleLine(line: string): void {
    const message = parseHelperLine(line)
    if (message === null) {
      this.options.logger.log('warn', 'helper', `Unreadable output: ${line.slice(0, 200)}`)
      return
    }
    if ('event' in message) {
      const event = parseHelperEvent(message.event, message.data)
      if (event === null) {
        this.options.logger.debug(`Ignored helper event "${message.event}"`)
        return
      }
      if (event.name === 'log') {
        this.options.logger.log(event.data.level, event.data.source, event.data.message)
      }
      this.events.emit(event)
      return
    }
    if (message.id === null) return
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if ('error' in message) {
      pending.reject(new AppException(message.error.code, message.error.message))
      return
    }
    const parsed = helperMethods[pending.method].result.safeParse(message.result)
    if (parsed.success) {
      pending.resolve(parsed.data)
    } else {
      this.options.logger.error(`Helper answer to ${pending.method} has an unexpected shape`)
      pending.reject(new AppException('protocolMismatch', `Unexpected answer to ${pending.method}`))
    }
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.child !== child) return
    this.child = null
    this.clearTimers()
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new AppException('helperExited', 'The native helper exited.'))
    }
    this.pending.clear()

    if (this.stopping) {
      this.setState({ status: 'unavailable', reason: 'stopped' })
      return
    }
    this.options.logger.error(`Helper exited unexpectedly (code ${code}, signal ${signal})`)
    const now = Date.now()
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS)
    if (this.restartTimes.length >= MAX_RESTARTS) {
      this.setState({ status: 'crashed', reason: 'helperCrashLoop' })
      return
    }
    this.restartTimes.push(now)
    const delay = 1000 * 2 ** (this.restartTimes.length - 1)
    this.setState({ status: 'restarting', reason: 'helperExited' })
    this.restartTimer = setTimeout(() => {
      const path = this.options.executablePath
      if (path !== null && !this.stopping) void this.launch(path)
    }, delay)
  }

  private startPing(): void {
    this.missedPings = 0
    this.pingTimer = setInterval(() => {
      this.request('ping', {}, 4000)
        .then(() => {
          this.missedPings = 0
        })
        .catch(() => {
          this.missedPings += 1
          if (this.missedPings >= 2) {
            this.options.logger.error('Helper is not responding; restarting it')
            this.child?.kill()
          }
        })
    }, this.options.pingIntervalMs ?? 5000)
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer)
    if (this.restartTimer !== null) clearTimeout(this.restartTimer)
    this.pingTimer = null
    this.restartTimer = null
  }

  private setState(patch: Partial<BackendState>): void {
    this.state = { ...this.state, ...patch }
    this.states.emit(this.state)
  }

  async setEmergencyHotkey(enabled: boolean): Promise<void> {
    const result = await this.request('setEmergencyHotkey', { enabled })
    this.setState({ emergencyHotkeyRegistered: result.registered })
  }
}
