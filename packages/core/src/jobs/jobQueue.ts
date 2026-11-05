/**
 * JobQueue — persistent asynchronous work queue (spec §8, §43).
 *
 * Every heavy operation (AI generation, render, import, analysis) runs through
 * this queue. Jobs are persisted in the Project DB so an app crash never loses
 * them: on next open, `pauseInterrupted()` marks mid-flight jobs as PAUSED and
 * the UI offers [Resume] [Discard] (spec §43 "Recovered Jobs").
 *
 * Handlers are cooperative: long work should poll `ctx.signal.aborted`.
 */
import {
  JobRecord,
  type JobStatus,
  type EntityId,
  MiraiError,
  toErrorPayload,
  type ErrorPayload,
  type LogLevel,
  type LogCategory,
} from '@mirai/shared'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId, parseJson } from '../types'

export interface JobContext {
  /** Cooperative cancellation flag — handlers should poll this. */
  signal: { readonly aborted: boolean }
  /** Report 0–100 progress. */
  reportProgress(percent: number): void
  log(message: string, data?: unknown): void
}

export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<unknown>

export interface JobQueueOptions {
  db: Database
  clock: Clock
  logger: { log(level: LogLevel, category: LogCategory, message: string, data?: unknown): void }
  /** Called on every job mutation — wires the `jobs:updated` push event. */
  onUpdated: (job: JobRecord) => void
  concurrency?: number
  backoffBaseMs?: number
  pollIntervalMs?: number
}

interface JobRow {
  id: string
  type: string
  status: string
  priority: number
  payload: string | null
  result: string | null
  error: string | null
  progress: number | null
  attempts: number
  max_attempts: number
  scheduled_at: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
  interrupted: number
}

const CANCELLABLE: readonly JobStatus[] = ['QUEUED', 'RETRYING']

export class JobQueue {
  private readonly handlers = new Map<string, JobHandler>()
  private readonly aborts = new Map<string, { aborted: boolean }>()
  private readonly running = new Set<string>()
  private readonly concurrency: number
  private readonly backoffBaseMs: number
  private readonly pollIntervalMs: number
  private started = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: JobQueueOptions) {
    this.concurrency = opts.concurrency ?? 2
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000
    this.pollIntervalMs = opts.pollIntervalMs ?? 300
  }

  // ------------------------------------------------------------------ public

  /** Register the handler for a job type. One handler per type. */
  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler)
  }

  /** Enqueue work. Returns the persisted record. */
  async enqueue(
    type: string,
    payload?: unknown,
    options: { priority?: number; maxAttempts?: number } = {},
  ): Promise<JobRecord> {
    if (!this.handlers.has(type)) {
      throw new MiraiError('INTERNAL', `No handler registered for job type "${type}".`)
    }
    const now = this.opts.clock.isoNow()
    const id = newEntityId()
    const raw: Record<string, unknown> = {
      id,
      type,
      status: 'QUEUED',
      priority: options.priority ?? 5,
      payload: payload === undefined ? null : JSON.stringify(payload),
      result: null,
      error: null,
      progress: null,
      attempts: 0,
      max_attempts: options.maxAttempts ?? 3,
      scheduled_at: now,
      started_at: null,
      finished_at: null,
      created_at: now,
      updated_at: now,
      interrupted: 0,
    }
    const columns = Object.keys(raw).join(', ')
    const placeholders = Object.keys(raw)
      .map(() => '?')
      .join(', ')
    this.opts.db
      .prepare(`INSERT INTO job_records (${columns}) VALUES (${placeholders})`)
      .run(...Object.values(raw))

    const job = this.get(id)
    if (!job) throw new MiraiError('DB_ERROR', 'Job vanished right after enqueue.')
    this.opts.logger.log('info', 'JOBS', `Job enqueued: ${type}`, { jobId: id })
    this.opts.onUpdated(job)
    this.kick()
    return job
  }

  /** All jobs, newest first. */
  list(): JobRecord[] {
    const rows = this.opts.db
      .prepare('SELECT * FROM job_records ORDER BY created_at DESC LIMIT 500')
      .all() as JobRow[]
    return rows.map(rowToJob)
  }

  get(id: EntityId): JobRecord | null {
    const row = this.opts.db
      .prepare('SELECT * FROM job_records WHERE id = ?')
      .get(id) as JobRow | undefined
    return row ? rowToJob(row) : null
  }

  countByStatus(status: JobStatus): number {
    const row = this.opts.db
      .prepare('SELECT COUNT(*) AS n FROM job_records WHERE status = ?')
      .get(status) as { n: number }
    return row.n
  }

  /** Re-queue a FAILED or CANCELLED job. */
  retry(id: EntityId): JobRecord {
    const job = this.get(id)
    if (!job) throw new MiraiError('NOT_FOUND', `Job ${id} not found.`)
    if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
      throw new MiraiError(
        'JOB_NOT_CANCELLABLE',
        `Job is ${job.status} — only FAILED or CANCELLED jobs can be retried.`,
      )
    }
    const now = this.opts.clock.isoNow()
    this.update(id, {
      status: 'QUEUED',
      attempts: 0,
      error: null,
      scheduled_at: now,
      started_at: null,
      finished_at: null,
      progress: null,
      interrupted: 0,
    })
    return this.require(id)
  }

  /**
   * Cancel a job. QUEUED/RETRYING are cancelled immediately; RUNNING jobs get
   * an abort flag and are cancelled cooperatively when the handler checks it.
   */
  cancel(id: EntityId): void {
    const job = this.get(id)
    if (!job) throw new MiraiError('NOT_FOUND', `Job ${id} not found.`)
    if (job.status === 'RUNNING') {
      const flag = this.aborts.get(id)
      if (flag) flag.aborted = true
      return
    }
    if (!CANCELLABLE.includes(job.status)) {
      throw new MiraiError(
        'JOB_NOT_CANCELLABLE',
        `Job is ${job.status} and can no longer be cancelled.`,
      )
    }
    this.update(id, { status: 'CANCELLED', finished_at: this.opts.clock.isoNow() })
  }

  /**
   * Boot-time recovery: any RUNNING/RETRYING job left behind by a crashed or
   * closed app is parked as PAUSED (spec §43). Returns how many were found.
   */
  pauseInterrupted(): number {
    const info = this.opts.db
      .prepare(
        `UPDATE job_records
         SET status = 'PAUSED', interrupted = 1, updated_at = ?
         WHERE status IN ('RUNNING', 'RETRYING')`,
      )
      .run(this.opts.clock.isoNow())
    return info.changes
  }

  /** PAUSED → QUEUED ("[Resume]"). Returns how many were resumed. */
  resumePaused(): number {
    const info = this.opts.db
      .prepare(
        `UPDATE job_records
         SET status = 'QUEUED', scheduled_at = ?, updated_at = ?
         WHERE status = 'PAUSED'`,
      )
      .run(this.opts.clock.isoNow(), this.opts.clock.isoNow())
    if (info.changes > 0) this.kick()
    return info.changes
  }

  /** PAUSED → CANCELLED ("[Discard]"). Returns how many were discarded. */
  discardPaused(): number {
    const info = this.opts.db
      .prepare(
        `UPDATE job_records
         SET status = 'CANCELLED', finished_at = ?, updated_at = ?
         WHERE status = 'PAUSED'`,
      )
      .run(this.opts.clock.isoNow(), this.opts.clock.isoNow())
    return info.changes
  }

  /** Start the polling worker. */
  start(): void {
    if (this.started) return
    this.started = true
    this.kick()
  }

  /** Stop polling and wait (bounded) for in-flight handlers. */
  async stop(): Promise<void> {
    this.started = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    const deadline = Date.now() + 5_000
    while (this.running.size > 0 && Date.now() < deadline) {
      await delay(50)
    }
  }

  // ----------------------------------------------------------------- private

  /** Nudge the worker loop without waiting for the next poll tick. */
  private kick(): void {
    if (!this.started) return
    void this.tick()
  }

  private scheduleNextPoll(): void {
    if (!this.started || this.pollTimer) return
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      void this.tick()
    }, this.pollIntervalMs)
  }

  private async tick(): Promise<void> {
    if (!this.started) return
    let busy = false
    while (this.running.size < this.concurrency) {
      const id = this.pickNext()
      if (!id) break
      busy = true
      void this.runJob(id)
    }
    if (busy) {
      // Handlers finishing will re-kick; also keep a slow poll for retries due later.
    }
    this.scheduleNextPoll()
  }

  /** Atomically claim the next runnable job. */
  private pickNext(): EntityId | null {
    const now = this.opts.clock.isoNow()
    const claim = this.opts.db.transaction((): EntityId | null => {
      const row = this.opts.db
        .prepare(
          `SELECT id FROM job_records
           WHERE status = 'QUEUED' OR (status = 'RETRYING' AND scheduled_at <= ?)
           ORDER BY priority DESC, scheduled_at ASC
           LIMIT 1`,
        )
        .get(now) as { id: string } | undefined
      if (!row) return null
      this.opts.db
        .prepare(
          `UPDATE job_records
           SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ?
           WHERE id = ?`,
        )
        .run(now, now, row.id)
      return row.id as EntityId
    })
    return claim()
  }

  private async runJob(id: EntityId): Promise<void> {
    if (this.running.has(id)) return
    this.running.add(id)
    const abortFlag = { aborted: false }
    this.aborts.set(id, abortFlag)
    let lastProgressAt = 0
    const ctx: JobContext = {
      signal: { get aborted() { return abortFlag.aborted } },
      reportProgress: (percent: number) => {
        const now = Date.now()
        if (now - lastProgressAt < 200 && percent !== 100) return
        lastProgressAt = now
        this.update(id, { progress: clamp(Math.round(percent), 0, 100) })
      },
      log: (message, data) => {
        this.opts.logger.log('debug', 'JOBS', `[${id}] ${message}`, data)
      },
    }

    try {
      const job = this.require(id)
      const handler = this.handlers.get(job.type)
      if (!handler) {
        throw new MiraiError('INTERNAL', `No handler for job type "${job.type}".`)
      }
      const result = await handler(job, ctx)
      if (abortFlag.aborted) {
        this.update(id, { status: 'CANCELLED', finished_at: this.opts.clock.isoNow() })
      } else {
        this.update(id, {
          status: 'COMPLETED',
          finished_at: this.opts.clock.isoNow(),
          progress: 100,
          result: result === undefined ? null : JSON.stringify(result),
        })
      }
      this.opts.logger.log('info', 'JOBS', `Job completed: ${job.type}`, { jobId: id })
    } catch (err) {
      if (abortFlag.aborted) {
        // The handler aborted (or failed after cancellation): it is a CANCEL,
        // never a failure, and it must not be retried (spec §8).
        this.update(id, { status: 'CANCELLED', finished_at: this.opts.clock.isoNow() })
        this.opts.logger.log('info', 'JOBS', `Job cancelled: ${this.get(id)?.type ?? id}`, { jobId: id })
      } else {
        this.handleFailure(id, err)
      }
    } finally {
      this.aborts.delete(id)
      this.running.delete(id)
      this.kick()
    }
  }

  private handleFailure(id: EntityId, err: unknown): void {
    const job = this.require(id)
    const payload: ErrorPayload = toErrorPayload(err)
    const attempts = job.attempts + 1
    if (attempts < job.maxAttempts && !this.aborts.get(id)?.aborted) {
      const backoffMs = this.backoffBaseMs * 2 ** (attempts - 1)
      const scheduledAt = new Date(this.opts.clock.now().getTime() + backoffMs).toISOString()
      this.update(id, {
        status: 'RETRYING',
        attempts,
        error: JSON.stringify(payload),
        scheduled_at: scheduledAt,
        progress: null,
      })
      this.opts.logger.log(
        'warning',
        'JOBS',
        `Job failed, retrying (${attempts}/${job.maxAttempts}): ${payload.message}`,
        { jobId: id },
      )
    } else {
      this.update(id, {
        status: 'FAILED',
        attempts,
        error: JSON.stringify(payload),
        finished_at: this.opts.clock.isoNow(),
      })
      this.opts.logger.log('error', 'JOBS', `Job failed permanently: ${payload.message}`, { jobId: id })
    }
  }

  private update(id: EntityId, patch: Record<string, unknown>): void {
    const assignments: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(patch)) {
      assignments.push(`${key} = ?`)
      values.push(value)
    }
    assignments.push('updated_at = ?')
    values.push(this.opts.clock.isoNow())
    values.push(id)
    this.opts.db
      .prepare(`UPDATE job_records SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    this.opts.onUpdated(this.require(id))
  }

  private require(id: EntityId): JobRecord {
    const job = this.get(id)
    if (!job) throw new MiraiError('DB_ERROR', `Job ${id} not found.`)
    return job
  }
}

// ---------------------------------------------------------------------- utils

function rowToJob(row: JobRow): JobRecord {
  const parsed = JobRecord.safeParse({
    id: row.id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    payload: parseJson(row.payload),
    result: parseJson(row.result),
    error: parseJson(row.error),
    progress: row.progress ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    interrupted: row.interrupted === 1,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted job record ${row.id}.`, {
      details: parsed.error.issues,
    })
  }
  return parsed.data
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
