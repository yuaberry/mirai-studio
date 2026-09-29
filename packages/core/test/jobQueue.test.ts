import { describe, expect, it } from 'vitest'
import { JobQueue } from '../src/jobs/jobQueue'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { LoggerService } from '../src/logger/logger'
import { makeClock, waitFor } from './helpers'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'

interface QueueFixture {
  queue: JobQueue
  clock: ReturnType<typeof makeClock>
  updates: Array<{ id: string; status: string }>
  dbPath: string
  close: () => void
}

function makeQueue(name: string, opts: { backoffBaseMs?: number; pollIntervalMs?: number } = {}): QueueFixture {
  const dir = mkdtempSync(join(tmpdir(), `mirai-jobs-${name}-`))
  const dbPath = join(dir, 'project.sqlite')
  const db = openDatabase(dbPath)
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const logger = new LoggerService({ logDir: join(dir, 'logs'), maxBuffer: 100 })
  const updates: Array<{ id: string; status: string }> = []
  const queue = new JobQueue({
    db,
    clock,
    logger,
    onUpdated: (job) => updates.push({ id: job.id, status: job.status }),
    backoffBaseMs: opts.backoffBaseMs ?? 5,
    pollIntervalMs: opts.pollIntervalMs ?? 5,
    concurrency: 1,
  })
  return {
    queue,
    clock,
    updates,
    dbPath,
    close: () => {
      logger.close()
      db.close()
    },
  }
}

describe('JobQueue', () => {
  it('processes an enqueued job to COMPLETED with its result', async () => {
    const fx = makeQueue('ok')
    fx.queue.register('test.echo', async (job) => ({ echo: job.payload, doubled: true }))
    fx.queue.start()

    const job = await fx.queue.enqueue('test.echo', { hi: 'mirai' })
    await waitFor(() => fx.queue.get(job.id)?.status === 'COMPLETED')

    const final = fx.queue.get(job.id)!
    expect(final.status).toBe('COMPLETED')
    expect(final.result).toEqual({ echo: { hi: 'mirai' }, doubled: true })
    expect(final.progress).toBe(100)
    expect(final.error).toBeUndefined()
    fx.queue.stop()
    fx.close()
  })

  it('reports progress during execution', async () => {
    const fx = makeQueue('progress')
    fx.queue.register('test.progress', async (_job, ctx) => {
      ctx.reportProgress(50)
      await new Promise((r) => setTimeout(r, 10))
      ctx.reportProgress(100)
      return null
    })
    fx.queue.start()
    const job = await fx.queue.enqueue('test.progress')
    await waitFor(() => fx.queue.get(job.id)?.status === 'COMPLETED')
    expect(fx.queue.get(job.id)?.progress).toBe(100)
    fx.queue.stop()
    fx.close()
  })

  it('retries a failing handler with backoff and eventually completes', async () => {
    const fx = makeQueue('retry', { backoffBaseMs: 1 })
    let calls = 0
    fx.queue.register('test.flaky', async () => {
      calls += 1
      if (calls === 1) throw new Error('transient failure')
      return 'recovered'
    })
    fx.queue.start()

    const job = await fx.queue.enqueue('test.flaky', undefined, { maxAttempts: 3 })
    await waitFor(() => {
      fx.clock.advance(5)
      return fx.queue.get(job.id)?.status === 'COMPLETED'
    }, { timeoutMs: 8_000 })

    expect(calls).toBe(2)
    const final = fx.queue.get(job.id)!
    expect(final.attempts).toBe(1)
    fx.queue.stop()
    fx.close()
  })

  it('marks a job FAILED after exhausting attempts, with a serialized error', async () => {
    const fx = makeQueue('fail', { backoffBaseMs: 1 })
    fx.queue.register('test.boom', async () => {
      throw new Error('always broken')
    })
    fx.queue.start()

    const job = await fx.queue.enqueue('test.boom', undefined, { maxAttempts: 2 })
    await waitFor(() => {
      fx.clock.advance(5)
      return fx.queue.get(job.id)?.status === 'FAILED'
    }, { timeoutMs: 8_000 })

    const final = fx.queue.get(job.id)!
    expect(final.status).toBe('FAILED')
    expect(final.error?.message).toBe('always broken')
    expect(final.error?.code).toBe('INTERNAL')
    expect(final.attempts).toBe(2)
    expect(final.finishedAt).not.toBeNull()
    fx.queue.stop()
    fx.close()
  })

  it('rejects enqueueing an unregistered job type', async () => {
    const fx = makeQueue('unregistered')
    fx.queue.start()
    await expect(fx.queue.enqueue('test.nope')).rejects.toThrow(/No handler registered/)
    fx.queue.stop()
    fx.close()
  })

  it('cancels a QUEUED job immediately (worker busy with a gate job)', async () => {
    const fx = makeQueue('cancel-queued')
    let release: () => void = () => {}
    let secondRan = false
    fx.queue.register('test.gate', async () => {
      await new Promise<void>((resolve) => (release = () => resolve()))
      return null
    })
    fx.queue.register('test.slow', async () => {
      secondRan = true
      return null
    })
    fx.queue.start()

    const gate = await fx.queue.enqueue('test.gate')
    await waitFor(() => fx.queue.get(gate.id)?.status === 'RUNNING')

    const queued = await fx.queue.enqueue('test.slow')
    expect(fx.queue.get(queued.id)?.status).toBe('QUEUED')

    fx.queue.cancel(queued.id)
    expect(fx.queue.get(queued.id)?.status).toBe('CANCELLED')

    release()
    await waitFor(() => fx.queue.get(gate.id)?.status === 'COMPLETED')
    expect(secondRan).toBe(false)
    fx.queue.stop()
    fx.close()
  })

  it('cooperatively cancels a RUNNING job', async () => {
    const fx = makeQueue('cancel-running')
    fx.queue.register('test.long', async (_job, ctx) => {
      for (let i = 0; i < 500 && !ctx.signal.aborted; i++) {
        await new Promise((r) => setTimeout(r, 2))
      }
      if (ctx.signal.aborted) throw new MiraiError('CANCELLED', 'Cancelled by user.')
      return 'done'
    })
    fx.queue.start()
    const job = await fx.queue.enqueue('test.long')
    await waitFor(() => fx.queue.get(job.id)?.status === 'RUNNING')
    fx.queue.cancel(job.id)
    await waitFor(() => fx.queue.get(job.id)?.status === 'CANCELLED')
    fx.queue.stop()
    fx.close()
  })

  it('recovers interrupted jobs as PAUSED across app restarts, then resumes them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirai-jobs-restart-'))
    const dbPath = join(dir, 'project.sqlite')
    const logger = new LoggerService({ logDir: join(dir, 'logs'), maxBuffer: 100 })

    const openDb = () => {
      const db = openDatabase(dbPath)
      runMigrations(db, PROJECT_DB_MIGRATIONS)
      return db
    }

    const db1 = openDb()
    const clock1 = makeClock()
    const q1 = new JobQueue({ db: db1, clock: clock1, logger, onUpdated: () => {}, pollIntervalMs: 5 })
    q1.register('test.forever', () => new Promise(() => {}))
    q1.start()
    const job = await q1.enqueue('test.forever')
    await waitFor(() => q1.get(job.id)?.status === 'RUNNING')
    q1.stop()
    logger.close()
    db1.close()

    const db2 = openDb()
    const clock2 = makeClock()
    const logger2 = new LoggerService({ logDir: join(dir, 'logs2'), maxBuffer: 100 })
    const q2 = new JobQueue({
      db: db2,
      clock: clock2,
      logger: logger2,
      onUpdated: () => {},
      pollIntervalMs: 5,
      backoffBaseMs: 1,
    })
    let completed = false
    q2.register('test.forever', async () => {
      completed = true
      return 'resumed'
    })
    const recovered = q2.pauseInterrupted()
    expect(recovered).toBe(1)
    expect(q2.get(job.id)?.status).toBe('PAUSED')
    expect(q2.get(job.id)?.interrupted).toBe(true)

    q2.resumePaused()
    q2.start()
    await waitFor(() => q2.get(job.id)?.status === 'COMPLETED')
    expect(completed).toBe(true)
    expect(q2.get(job.id)?.result).toBe('resumed')

    q2.stop()
    logger2.close()
    db2.close()
  })

  it('discards paused jobs when the user clicks [Discard]', async () => {
    const fx = makeQueue('discard')
    fx.queue.register('test.x', async () => null)
    fx.queue.start()
    const job = await fx.queue.enqueue('test.x')
    await waitFor(() => fx.queue.get(job.id)?.status === 'COMPLETED')
    fx.queue['opts'].db
      .prepare("UPDATE job_records SET status = 'PAUSED', interrupted = 1 WHERE id = ?")
      .run(job.id)
    expect(fx.queue.discardPaused()).toBe(1)
    expect(fx.queue.get(job.id)?.status).toBe('CANCELLED')
    fx.queue.stop()
    fx.close()
  })

  it('retries a FAILED job on demand', async () => {
    const fx = makeQueue('manual-retry', { backoffBaseMs: 1 })
    let calls = 0
    fx.queue.register('test.manual', async () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      return 'ok'
    })
    fx.queue.start()
    const job = await fx.queue.enqueue('test.manual', undefined, { maxAttempts: 1 })
    await waitFor(() => {
      fx.clock.advance(5)
      return fx.queue.get(job.id)?.status === 'FAILED'
    }, { timeoutMs: 8_000 })

    fx.queue.retry(job.id)
    await waitFor(() => {
      fx.clock.advance(5)
      return fx.queue.get(job.id)?.status === 'COMPLETED'
    }, { timeoutMs: 8_000 })
    expect(fx.queue.get(job.id)?.result).toBe('ok')
    fx.queue.stop()
    fx.close()
  })

  it('prioritizes higher-priority jobs', async () => {
    const fx = makeQueue('priority', { pollIntervalMs: 500 })
    const started: string[] = []
    let release: () => void = () => {}
    fx.queue.register('test.prio', async (job) => {
      started.push(job.payload as string)
      await new Promise<void>((r) => (release = () => r()))
      return null
    })
    fx.queue.start()
    const gate = await fx.queue.enqueue('test.prio', 'gate', { priority: 0 })
    await waitFor(() => started.includes('gate'))
    const low = await fx.queue.enqueue('test.prio', 'low', { priority: 1 })
    const high = await fx.queue.enqueue('test.prio', 'high', { priority: 10 })

    release()
    fx.queue.cancel(low.id)
    fx.queue.cancel(high.id)
    await waitFor(() => fx.queue.get(gate.id)?.status === 'COMPLETED')

    expect(started.filter((s) => s !== 'gate').every((s) => s === 'high')).toBe(true)
    fx.queue.stop()
    fx.close()
  })
})
