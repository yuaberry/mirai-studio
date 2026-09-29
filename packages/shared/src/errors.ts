/**
 * Mirai Studio error model.
 *
 * Every failure that crosses a boundary (IPC, job runner, providers) is
 * serialized as an {@link ErrorPayload}: a code, a human message, whether the
 * operation can be retried and optional structured details.
 * The renderer must NEVER render a generic "Something went wrong" —
 * it always has code + message + retryable to build useful actions.
 */
import { z, ZodError } from 'zod'

export const MIRAI_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'IO_ERROR',
  'DB_ERROR',
  'JOB_FAILED',
  'JOB_NOT_CANCELLABLE',
  'CREDENTIALS_UNAVAILABLE',
  'SECURE_STORAGE_UNAVAILABLE',
  'AI_PROVIDER_ERROR',
  'AI_OFFLINE',
  'PROJECT_INVALID',
  'PATH_INVALID',
  'CANCELLED',
  'INTERNAL',
] as const

export type MiraiErrorCode = (typeof MIRAI_ERROR_CODES)[number]

export const zMiraiErrorCode = z.enum(MIRAI_ERROR_CODES)

/** Serializable representation of an error. */
export interface ErrorPayload {
  code: MiraiErrorCode
  message: string
  retryable: boolean
  details?: unknown
}

export const zErrorPayload: z.ZodType<ErrorPayload> = z.object({
  code: zMiraiErrorCode,
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
})

/** Error carrying a machine-readable code. */
export class MiraiError extends Error {
  readonly code: MiraiErrorCode
  readonly retryable: boolean
  readonly details?: unknown

  constructor(
    code: MiraiErrorCode,
    message: string,
    opts: { retryable?: boolean; details?: unknown; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'MiraiError'
    this.code = code
    this.retryable = opts.retryable ?? false
    this.details = opts.details
    if (opts.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = opts.cause
    }
  }
}

/** Convert any thrown value into a serializable payload. */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof MiraiError) {
    return { code: err.code, message: err.message, retryable: err.retryable, details: err.details }
  }
  if (err instanceof ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      retryable: false,
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }
  }
  if (err instanceof Error) {
    const retryable = isRetryableByMessage(err.message)
    return { code: 'INTERNAL', message: err.message, retryable }
  }
  return { code: 'INTERNAL', message: String(err), retryable: false }
}

/** Re-hydrate a payload into a proper Error (renderer side). */
export function fromErrorPayload(payload: ErrorPayload): MiraiError {
  return new MiraiError(payload.code, payload.message, {
    retryable: payload.retryable,
    details: payload.details,
  })
}

function isRetryableByMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('temporarily') ||
    lower.includes('busy')
  )
}
