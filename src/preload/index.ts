/**
 * The only bridge between the web page and Electron.
 *
 * The page gets `window.inputsplit` with two functions: `invoke` for the whitelisted
 * request channels and `on` for the whitelisted events. No Node.js, no `ipcRenderer`,
 * no arbitrary channels.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNEL_NAMES, INVOKE_CHANNEL_NAMES } from '../shared/channels'

const invokeChannels = new Set<string>(INVOKE_CHANNEL_NAMES)
const eventChannels = new Set<string>(EVENT_CHANNEL_NAMES)

type Result = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }

const api = {
  // Returns `{ ok, data }` / `{ ok: false, error }` as a plain object: custom Error
  // properties (like `code`) do not survive the context bridge, plain objects do.
  async invoke(channel: string, input?: unknown): Promise<Result> {
    if (!invokeChannels.has(channel)) {
      return { ok: false, error: { code: 'forbidden', message: `Unknown channel ${channel}` } }
    }
    return (await ipcRenderer.invoke(channel, input)) as Result
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!eventChannels.has(channel)) throw new Error(`Unknown event ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('inputsplit', api)
