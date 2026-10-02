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

// storyboard (Phase 3)
export { StoryboardService } from './storyboard/storyboardService'

// media (Phase 4)
export { MediaService } from './media/mediaService'

// render (Phase 4)
export { RenderService } from './render/renderService'
export { buildSceneRenderSpec } from './render/sceneRenderBuilder'

// timeline (Phase 5)
export { TimelineService } from './timeline/timelineService'
export { KeyframeService } from './timeline/keyframeService'

// production (Phase 7)
export { ProductionService } from './production/productionService'

// subtitles (Phase 4 wrap-up)
export { SubtitleService } from './subtitles/subtitleService'

// plugins (Phase 9)
export { PluginRegistry, EXAMPLE_MANIFESTS } from './plugins/pluginRegistry'

// settings
export { SettingsService, CredentialStore } from './settings/settingsService'
export type { CredentialStatus } from './settings/settingsService'
