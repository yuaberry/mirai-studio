import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LoggerService } from '../src/logger/logger'

function makeLogger(name: string, opts: { maxFileBytes?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-logger-${name}-`))
  const logger = new LoggerService({
    logDir: dir,
    maxBuffer: 100,
    maxFileBytes: opts.maxFileBytes ?? 64 * 1024,
    keepFiles: 2,
  })
  return { dir, logger }
}

describe('LoggerService', () => {
  it('buffers entries and filters by level, category and search', () => {
    const { logger } = makeLogger('buffer')
    logger.info('SYSTEM', 'App started')
    logger.warn('PROJECT', 'Folder moved')
    logger.error('DB', 'Query failed', { code: 1 })

    expect(logger.recent({})).toHaveLength(3)
    expect(logger.recent({ level: 'error' })).toHaveLength(1)
    expect(logger.recent({ category: 'PROJECT' })[0]?.message).toBe('Folder moved')
    expect(logger.recent({ search: 'started' })[0]?.level).toBe('info')
    logger.close()
  })

  it('newest entries come first', () => {
    const { logger } = makeLogger('order')
    logger.info('SYSTEM', 'first')
    logger.info('SYSTEM', 'second')
    const entries = logger.recent({})
    expect(entries[0]?.message).toBe('second')
    logger.close()
  })

  it('emits throttled batches to subscribers', async () => {
    const { logger } = makeLogger('subscribe')
    const received: unknown[][] = []
    logger.subscribe((batch) => received.push(batch))
    logger.info('SYSTEM', 'hello')
    logger.info('SYSTEM', 'world')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(received.length).toBeGreaterThanOrEqual(1)
    const flat = received.flat() as Array<{ message: string }>
    expect(flat.map((e) => e.message)).toContain('hello')
    logger.close()
  })

  it('keeps the ring buffer bounded', () => {
    const { logger } = makeLogger('bounded')
    for (let i = 0; i < 250; i++) logger.info('SYSTEM', `entry-${i}`)
    expect(logger.recent({ limit: 1_000 })).toHaveLength(100)
    expect(logger.recent({})[0]?.message).toBe('entry-249')
    logger.close()
  })

  it('writes to the current log file and rotates by size', () => {
    const { dir, logger } = makeLogger('rotate', { maxFileBytes: 2 * 1024 })
    for (let i = 0; i < 120; i++) {
      logger.info('SYSTEM', `rotation-test-line-${i}-${'x'.repeat(40)}`)
    }
    expect(existsSync(join(dir, 'mirai.log'))).toBe(true)
    expect(existsSync(join(dir, 'mirai-1.log'))).toBe(true)
    logger.close()
  })

  it('clear() empties the buffer and starts a fresh current file', () => {
    const { logger } = makeLogger('clear')
    logger.info('SYSTEM', 'before-clear')
    logger.clear()
    expect(logger.recent({})).toHaveLength(0)
    logger.info('SYSTEM', 'after-clear')
    expect(logger.recent({})[0]?.message).toBe('after-clear')
    logger.close()
  })
})
