/**
 * JobRecord — unit of asynchronous work persisted in the Project DB.
 * Heavy operations (AI, render, import, analysis) MUST go through the queue
 * so the UI never blocks and interrupted work can be recovered (spec §8, §43).
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { zErrorPayload } from '../errors'
import { zJobStatus } from '../status'

/** Job types shipped with the current phase. Providers add more later. */
export const BUILTIN_JOB_TYPES = ['project.validate'] as const
export type BuiltinJobType = (typeof BUILTIN_JOB_TYPES)[number]

export const JobRecord = z.object({
  id: zEntityId,
  type: z.string().min(1),
  status: zJobStatus,
  /** Higher runs first. 0–10. */
  priority: z.number().int().min(0).max(10).default(5),
  payload: z.unknown().optional(),
  result: z.unknown().optional(),
  error: zErrorPayload.optional(),
  /** 0–100, optional progress report from the handler. */
  progress: z.number().int().min(0).max(100).optional(),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  /** ISO date when the job may next run (used by retry backoff). */
  scheduledAt: zIsoDate,
  startedAt: zIsoDate.nullable().default(null),
  finishedAt: zIsoDate.nullable().default(null),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
  /** True when the app was closed while this job was mid-flight. */
  interrupted: z.boolean().default(false),
})
export type JobRecord = z.infer<typeof JobRecord>

export function jobIsActive(job: JobRecord): boolean {
  return job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'RETRYING'
}
