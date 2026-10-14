/**
 * Typed access to the main process. All calls go through the preload bridge
 * (`window.inputsplit`); failures become `ApiError` with a stable `code`.
 */
import type {
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeInput,
  InvokeOutput,
} from '@shared/ipc-contract'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function bridge() {
  if (typeof window === 'undefined' || window.inputsplit === undefined) {
    throw new ApiError('noBridge', 'InputSplit must run inside its desktop app.')
  }
  return window.inputsplit
}

export async function call<C extends InvokeChannel>(
  channel: C,
  ...input: InvokeInput<C> extends undefined ? [] : [InvokeInput<C>]
): Promise<InvokeOutput<C>> {
  // Vue reactive proxies cannot cross the context bridge; send a plain JSON copy.
  const plain = input.map((value) => JSON.parse(JSON.stringify(value)) as unknown) as typeof input
  const result = await bridge().invoke(channel, ...plain)
  if (result.ok) return result.data
  throw new ApiError(result.error.code, result.error.message)
}

export function subscribe<E extends EventChannel>(
  event: E,
  listener: (payload: EventPayload<E>) => void,
): () => void {
  return bridge().on(event, listener)
}

export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'internalError'
}
