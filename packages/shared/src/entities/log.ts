/**
 * Log entries — structured, categorized, kept in a ring buffer and on disk.
 */
import { z } from 'zod'
import { zLogCategory, zLogLevel } from '../status'

export const LogEntry = z.object({
  /** Epoch milliseconds. */
  ts: z.number(),
  level: zLogLevel,
  category: zLogCategory,
  message: z.string(),
  data: z.unknown().optional(),
})
export type LogEntry = z.infer<typeof LogEntry>

export interface LogQuery {
  limit?: number
  level?: string
  category?: string
  search?: string
}
