/**
 * Main-process DI container + IPC event emitter.
 */
import { app, type BrowserWindow } from 'electron'
import {
  APP_DB_MIGRATIONS,
  CredentialStore,
  LoggerService,
  ProjectService,
  SettingsService,
  openDatabase,
  runMigrations,
  systemClock,
  type AppDirs,
  type Database,
  type OpenProjectContext,
} from '@mirai/core'
import type { IpcEventChannel, IpcEventPayload, OpenedProject } from '@mirai/shared'
import { ipcEventPayloads } from '@mirai/shared'
import { mkdirSync } from 'node:fs'
import { createSecureCodec, electronDirs } from './adapters/electronAdapters'
import { createHealthChecker, type HealthChecker } from './system/health'
import { AiHost } from './ai/aiHost'

/** Typed push channel: main → renderer. */
export class MainEmitter {
  private win: BrowserWindow | null = null

  attach(win: BrowserWindow): void {
    this.win = win
  }

  detach(): void {
    this.win = null
  }

  get window(): BrowserWindow | null {
    return this.win
  }

  send<C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>): void {
    if (!this.win || this.win.isDestroyed()) return
    try {
      // Validate what leaves the main process — the renderer trusts the bridge.
      const parsed = ipcEventPayloads[channel].parse(payload)
      this.win.webContents.send('mirai:event', { channel, payload: parsed })
    } catch {
      // A malformed push event must never crash the main process.
    }
  }
}

export interface Container {
  dirs: AppDirs
  logger: LoggerService
  appDb: Database
  settings: SettingsService
  credentials: CredentialStore
  projects: ProjectService
  ai: AiHost
  emitter: MainEmitter
  health: HealthChecker
  shutdown(): Promise<void>
}

export function bootstrap(): Container {
  const dirs = electronDirs()

  mkdirSync(dirs.logs, { recursive: true })
  mkdirSync(dirs.backups, { recursive: true })
  mkdirSync(dirs.projectsDefaultDir, { recursive: true })

  const logger = new LoggerService({ logDir: dirs.logs })
  logger.info('SYSTEM', 'Mirai Studio starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  })

  const appDb = openDatabase(dirs.appDb)
  const migrations = runMigrations(appDb, APP_DB_MIGRATIONS)
  if (migrations.applied.length > 0) {
    logger.info('DB', `App DB migrated: ${migrations.applied.join(', ')}`)
  }

  const emitter = new MainEmitter()
  const codec = createSecureCodec(logger)
  const settings = new SettingsService(appDb)
  const credentials = new CredentialStore(appDb, codec, systemClock)
  const projects = new ProjectService({
    appDb,
    dirs,
    clock: systemClock,
    appVersion: app.getVersion(),
    logger,
    onJobUpdated: (job) => emitter.send('jobs:updated', { job }),
  })
  const ai = new AiHost({ credentials, settings, projects, logger, emitter })

  // Log batches → renderer (Diagnostics live tail).
  logger.subscribe((entries) => emitter.send('logs:appended', { entries }))

  const health = createHealthChecker({ dirs, logger, appDb, secure: () => codec.isSecure })

  const container: Container = {
    dirs,
    logger,
    appDb,
    settings,
    credentials,
    projects,
    ai,
    emitter,
    health,
    shutdown: async () => {
      await projects.close()
      logger.close()
      appDb.close()
    },
  }
  return container
}

/** Build the wire representation of an open project. */
export function toOpenedProject(ctx: OpenProjectContext): OpenedProject {
  return { ...ctx.summary, manifest: ctx.manifest }
}
