/**
 * DEVELOPMENT ONLY. A stand-in for the native helper so the UI can be built and tested on
 * macOS/Linux. It is created only when the app is NOT packaged and the environment variable
 * INPUTSPLIT_SIMULATED_BACKEND=1 is set (see src/main/index.ts); the UI then shows a
 * permanent "Simulated backend" banner. Production builds never contain fake data.
 *
 * It follows the real protocol: same methods, same result shapes, same events.
 */
import type { BackendState, Controller, Display, SessionStatus, WindowInfo } from '@shared/domain'
import { AppException } from '@shared/errors'
import { Emitter } from '../util/emitter'
import { initialBackendState, type NativeBackend } from './backend'
import type { HelperEvent, HelperMethod, HelperParams, HelperResult } from './protocol'

const WINDOWS: WindowInfo[] = [
  win(4001, 'Red Dead Redemption 2', 'RDR2.exe', 'D:\\Games\\Steam\\steamapps\\common\\Red Dead Redemption 2\\RDR2.exe', 7, ['steam', 'steamworks', 'xinput', 'gpu', 'fullscreenWindow'], '\\\\.\\DISPLAY3'),
  win(4002, 'Hollow Knight', 'hollow_knight.exe', 'D:\\Games\\Steam\\steamapps\\common\\Hollow Knight\\hollow_knight.exe', 7, ['steam', 'unity', 'steamworks', 'gpu'], '\\\\.\\DISPLAY3'),
  win(4003, 'Fortnite', 'FortniteClient-Win64-Shipping.exe', 'C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe', 6, ['epic', 'unreal', 'gpu'], '\\\\.\\DISPLAY1'),
  win(4010, 'inputsplit — Visual Studio Code', 'Code.exe', 'C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', 0, [], '\\\\.\\DISPLAY1'),
  win(4011, 'Google Chrome', 'chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 0, [], '\\\\.\\DISPLAY2'),
  win(4012, 'Telegram', 'Telegram.exe', 'C:\\Users\\dev\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe', 0, [], '\\\\.\\DISPLAY2'),
]

const DISPLAYS: Display[] = [
  display('\\\\.\\DISPLAY1', 'DELL U2723QE', true, 0, 0, 2560, 1440, 120, 'displayport', false, 144),
  display('\\\\.\\DISPLAY2', 'LG 27GP850', false, 2560, 0, 2560, 1440, 100, 'displayport', false, 165),
  display('\\\\.\\DISPLAY3', 'LG TV SSCR2', false, -3840, -400, 3840, 2160, 150, 'hdmi', true, 60),
]

function win(
  pid: number,
  title: string,
  exeName: string,
  exePath: string,
  score: number,
  hints: string[],
  monitor: string,
): WindowInfo {
  return {
    hwnd: pid * 16,
    title,
    className: 'SimulatedWindow',
    pid,
    exePath,
    exeName,
    architecture: 'x64',
    accessible: true,
    elevated: false,
    isMinimized: false,
    isForeground: false,
    rect: { x: 0, y: 0, width: 1920, height: 1080 },
    monitor,
    gameScore: score,
    isLikelyGame: score >= 3,
    hints,
  }
}

function display(
  id: string,
  name: string,
  isPrimary: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
  scalePercent: number,
  connection: string,
  isLikelyTv: boolean,
  refreshRate: number,
): Display {
  const bounds = { x, y, width, height }
  return {
    id,
    name,
    isPrimary,
    bounds,
    workArea: { ...bounds, height: height - 48 },
    dpi: Math.round((96 * scalePercent) / 100),
    scale: scalePercent / 100,
    refreshRate,
    connection,
    isLikelyTv,
  }
}

export class SimulatedBackend implements NativeBackend {
  readonly simulated = true
  private state: BackendState = initialBackendState(true)
  private readonly events = new Emitter<HelperEvent>()
  private readonly states = new Emitter<BackendState>()
  private controllers: Controller[] = [
    { slot: 0, connected: true, kind: 'gamepad', wireless: true, battery: { type: 'nimh', level: 'medium' } },
    { slot: 1, connected: false, kind: 'unknown', wireless: null, battery: null },
    { slot: 2, connected: false, kind: 'unknown', wireless: null, battery: null },
    { slot: 3, connected: false, kind: 'unknown', wireless: null, battery: null },
  ]
  private session: SessionStatus | null = null
  private sessionTimer: NodeJS.Timeout | null = null
  private testTimer: NodeJS.Timeout | null = null

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
    await delay(400)
    this.state = {
      ...this.state,
      status: 'ready',
      helperVersion: 'simulated',
      windowsBuild: 26100,
      hookDllFound: true,
      emergencyHotkey: 'Ctrl+Alt+Shift+Q',
    }
    this.states.emit(this.state)
  }

  async stop(): Promise<void> {
    this.stopSession('helperShutdown')
    if (this.testTimer) clearInterval(this.testTimer)
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async setEmergencyHotkey(enabled: boolean): Promise<void> {
    this.state = { ...this.state, emergencyHotkeyRegistered: enabled }
    this.states.emit(this.state)
  }

  async request<M extends HelperMethod>(method: M, params: HelperParams<M>): Promise<HelperResult<M>> {
    await delay(method === 'startIsolation' ? 900 : 120)
    return this.handle(method, params) as HelperResult<M>
  }

  private handle(method: HelperMethod, params: unknown): unknown {
    const p = params as Record<string, unknown>
    switch (method) {
      case 'ping':
        return { uptimeMs: 1 }
      case 'listWindows':
        return { windows: WINDOWS }
      case 'listControllers':
        return { controllers: this.controllers }
      case 'listDisplays':
        return { displays: DISPLAYS }
      case 'checkTarget': {
        const target = WINDOWS.find((w) => w.pid === p['pid'])
        const blockers =
          target?.exeName.startsWith('Fortnite')
            ? [{ code: 'antiCheat', message: 'Protected by Easy Anti-Cheat.' }]
            : []
        return {
          pid: p['pid'],
          exePath: target?.exePath ?? null,
          architecture: 'x64',
          blockers,
          warnings: target?.hints.includes('steam')
            ? [{ code: 'steamInput', message: 'Steam is running.' }]
            : [],
          antiCheat: blockers.length > 0 ? 'Easy Anti-Cheat' : null,
        }
      }
      case 'startIsolation':
        return this.startSession(p)
      case 'stopIsolation':
        this.stopSession('stopped')
        return {}
      case 'updateIsolation':
        return {}
      case 'moveWindow':
        return {
          previous: { x: 0, y: 0, width: 1920, height: 1080 },
          current: { x: -3840, y: -400, width: 3840, height: 2160 },
        }
      case 'restoreWindowRect':
        return { restored: true }
      case 'startControllerTest':
        this.startTest(Number(p['slot']))
        return {}
      case 'stopControllerTest':
        if (this.testTimer) clearInterval(this.testTimer)
        return {}
      case 'setEmergencyHotkey':
        return { registered: true, accelerator: 'Ctrl+Alt+Shift+Q' }
      case 'setGamepadHotkey':
      case 'rumble':
        return {}
      case 'hello':
        return {}
    }
  }

  private startSession(p: Record<string, unknown>): SessionStatus {
    if (this.session !== null) throw new AppException('alreadyIsolated', 'Simulated: already running')
    const features = p['features'] as Record<string, boolean>
    const requested = Object.keys(features).filter((k) => features[k]) as SessionStatus['requested']
    const isUnity = WINDOWS.find((w) => w.pid === p['pid'])?.hints.includes('unity') ?? false
    this.session = {
      sessionId: 1,
      pid: Number(p['pid']),
      architectureBits: 64,
      requested,
      active: requested,
      failed: [],
      detectedApis: isUnity ? ['xinput', 'unity', 'steamApi'] : ['xinput', 'steamApi'],
      gameWindow: Number(p['hwnd'] ?? 0),
      subclassedWindows: 1,
      xinputSlot: (p['xinputSlot'] as number | null) ?? null,
      counters: {
        xinputReads: 0,
        blockedKeyboard: 0,
        blockedMouse: 0,
        swallowedFocusEvents: 0,
        blockedCursorCalls: 0,
        xinputEnableBlocked: 0,
      },
      updatedAt: Date.now(),
    }
    this.sessionTimer = setInterval(() => {
      if (this.session === null) return
      const c = this.session.counters
      this.session = {
        ...this.session,
        counters: {
          ...c,
          xinputReads: c.xinputReads + 60,
          blockedKeyboard: c.blockedKeyboard + Math.floor(Math.random() * 6),
          blockedMouse: c.blockedMouse + Math.floor(Math.random() * 20),
          swallowedFocusEvents: c.swallowedFocusEvents + (Math.random() < 0.2 ? 3 : 0),
          blockedCursorCalls: c.blockedCursorCalls + (Math.random() < 0.5 ? 60 : 0),
        },
        updatedAt: Date.now(),
      }
      this.events.emit({ name: 'sessionStatus', data: this.session })
    }, 1000)
    return this.session
  }

  private stopSession(reason: 'stopped' | 'helperShutdown'): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer)
    this.sessionTimer = null
    if (this.session === null) return
    const { sessionId, pid } = this.session
    this.session = null
    setTimeout(() => this.events.emit({ name: 'sessionEnded', data: { sessionId, pid, reason } }), 50)
  }

  private startTest(slot: number): void {
    if (this.testTimer) clearInterval(this.testTimer)
    let packet = 0
    const started = Date.now()
    this.testTimer = setInterval(() => {
      const t = (Date.now() - started) / 1000
      const connected = this.controllers[slot]?.connected ?? false
      if (!connected) {
        this.events.emit({ name: 'controllerState', data: { slot, connected: false } })
        return
      }
      packet += 1
      const phase = Math.floor(t) % 4
      this.events.emit({
        name: 'controllerState',
        data: {
          slot,
          connected: true,
          packet,
          buttons: [0x1000, 0x2000, 0x4000, 0x8000][phase] ?? 0,
          guide: false,
          leftTrigger: Math.round(127 + 127 * Math.sin(t * 2)),
          rightTrigger: Math.round(127 + 127 * Math.cos(t * 2)),
          thumbLX: Math.round(26000 * Math.cos(t * 1.7)),
          thumbLY: Math.round(26000 * Math.sin(t * 1.7)),
          thumbRX: Math.round(18000 * Math.sin(t * 0.9)),
          thumbRY: Math.round(18000 * Math.cos(t * 1.3)),
        },
      })
    }, 1000 / 30)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
