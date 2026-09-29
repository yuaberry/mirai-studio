/**
 * Shared fixtures for core integration tests. Everything runs in a real
 * tmpdir with a real SQLite database — no mocks of our own code.
 */
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Database } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { APP_DB_MIGRATIONS } from '../src/db/migrations'
import { LoggerService } from '../src/logger/logger'
import { ProjectService } from '../src/projects/projectService'
import { systemClock, type AppDirs, type Clock, type SecureCodec } from '../src/types'

export interface TestEnv {
  root: string
  dirs: AppDirs
  logger: LoggerService
  appDb: Database
  projects: ProjectService
  emittedJobs: unknown[]
}

/** Deterministic, manually-advancing clock. */
export function makeClock(startMs = 1_735_000_000_000): Clock & { advance(ms: number): void } {
  let current = startMs
  return {
    now: () => new Date(current),
    isoNow: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms
    },
  }
}

export function setupEnv(name: string): TestEnv {
  const root = mkdtempSync(join(tmpdir(), `mirai-${name}-`))
  const dirs: AppDirs = {
    root,
    logs: join(root, 'logs'),
    backups: join(root, 'backups'),
    projectsDefaultDir: join(root, 'projects'),
    appDb: join(root, 'app.sqlite'),
  }
  const logger = new LoggerService({
    logDir: dirs.logs,
    maxBuffer: 500,
    maxFileBytes: 64 * 1024,
    keepFiles: 3,
  })
  mkdirSync(dirs.projectsDefaultDir, { recursive: true })
  mkdirSync(dirs.backups, { recursive: true })
  const appDb = openDatabase(dirs.appDb)
  runMigrations(appDb, APP_DB_MIGRATIONS)
  const emittedJobs: unknown[] = []
  const projects = new ProjectService({
    appDb,
    dirs,
    clock: systemClock,
    appVersion: '0.2.0-test',
    logger,
    onJobUpdated: (job) => emittedJobs.push(job),
  })
  return { root, dirs, logger, appDb, projects, emittedJobs }
}

/** Base64-with-prefix fake codec — non-identity and throws on tampered data. */
export const fakeSecureCodec: SecureCodec = {
  isSecure: true,
  encrypt: (plain: string) =>
    Buffer.from(`ENC:${Buffer.from(plain, 'utf8').toString('base64')}`, 'utf8'),
  decrypt: (data: Buffer): string => {
    const text = data.toString('utf8')
    if (!text.startsWith('ENC:')) {
      throw new Error('Invalid ciphertext')
    }
    return Buffer.from(text.slice(4), 'base64').toString('utf8')
  },
}

/** Poll until the predicate passes or the timeout is hit. */
export async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 5_000, intervalMs = 10 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met before timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

