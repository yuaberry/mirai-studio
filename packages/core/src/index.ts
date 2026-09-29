/**
 * @mirai/core — Mirai Studio domain core. Electron-free by design: OS-facing
 * ports (paths, clock, secure codec) are injected by the main process.
 */

// ports & utils
export { systemClock, plaintextCodec, newEntityId, parseJson } from './types'
export type { Clock, AppDirs, SecureCodec } from './types'

// db
export { openDatabase, checkpointWal } from './db/connection'
export type { Database } from './db/connection'
export { runMigrations } from './db/migrator'
export type { Migration, MigrationResult } from './db/migrator'
export { APP_DB_MIGRATIONS, PROJECT_DB_MIGRATIONS } from './db/migrations'

// logger
export { LoggerService } from './logger/logger'
export type { LoggerOptions, Logger } from './logger/logger'

// jobs
export { JobQueue } from './jobs/jobQueue'
export type { JobContext, JobHandler, JobQueueOptions } from './jobs/jobQueue'

// projects
export { MANIFEST_FILENAME, readManifest, writeManifest } from './projects/manifest'
export { ProjectService } from './projects/projectService'
export type { ProjectServiceOptions, OpenProjectContext } from './projects/projectService'

// creative
export { CreativeService } from './creative/creativeService'

// prompts
export { PromptService } from './prompts/promptService'

// settings
export { SettingsService, CredentialStore } from './settings/settingsService'
export type { CredentialStatus } from './settings/settingsService'
