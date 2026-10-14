/** An error that carries a stable code for the UI to translate (`errors.<code>`). */
export class AppException extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppException'
  }
}

export function toAppError(error: unknown): { code: string; message: string } {
  if (error instanceof AppException) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    const name = error.name === 'ZodError' ? 'invalidInput' : 'internalError'
    return { code: name, message: error.message }
  }
  return { code: 'internalError', message: String(error) }
}
