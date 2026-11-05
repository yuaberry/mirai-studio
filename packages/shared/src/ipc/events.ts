/**
 * Push events: main → renderer. Typed the same way as request channels.
 */
import { z } from 'zod'
import { JobRecord } from '../entities/job'
import { LogEntry } from '../entities/log'
import { OpenedProject } from '../entities/project'
import { zErrorPayload } from '../errors'

export const ipcEventPayloads = {
  /** A job record changed state (queued/running/progress/completed/...). */
  'jobs:updated': z.object({ job: JobRecord }),
  /** Batch of new log entries (throttled). */
  'logs:appended': z.object({ entries: z.array(LogEntry) }),
  /** User-facing notification. */
  notify: z.object({
    kind: z.enum(['info', 'success', 'warning', 'error', 'recovered']),
    title: z.string(),
    description: z.string().optional(),
  }),
  /** The active project changed (opened/closed/config-updated). */
  'project:changed': z.object({ project: OpenedProject.nullable() }),

  /** AI streaming: one or more tokens for an active request. */
  'ai:chunk': z.object({ requestId: z.string(), delta: z.string() }),
  /** AI streaming finished successfully. */
  'ai:done': z.object({
    requestId: z.string(),
    content: z.string(),
    model: z.string(),
    durationMs: z.number().int().min(0),
    /** Estimated USD cost from catalog pricing; null when unavailable. */
    costUsd: z.number().nullable(),
  }),
  /** AI streaming failed (auth, network, provider…). */
  'ai:error': z.object({ requestId: z.string(), error: zErrorPayload }),
} as const

export type IpcEventChannel = keyof typeof ipcEventPayloads
export const IPC_EVENT_CHANNELS = Object.keys(ipcEventPayloads) as IpcEventChannel[]

export type IpcEventPayload<C extends IpcEventChannel> = z.infer<(typeof ipcEventPayloads)[C]>
