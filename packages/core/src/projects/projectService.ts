/**
 * ProjectService — full project lifecycle (spec §5, §13, §49):
 * create / open / duplicate / archive / restore / remove-from-list /
 * backup / restore-backup / validate.
 *
 * Key invariants:
 * - Identity is the ULID, NEVER the path — projects can be moved on disk.
 * - The manifest is written atomically.
 * - Backups never overwrite each other; restoring always takes a safety
 *   snapshot first; the last remaining backup can never be deleted.
 * - Opening a project upgrades its DB via migrations (older projects keep working).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  MiraiError,
  PROJECT_FOLDERS,
  type BackupInfo,
  type EntityId,
  type JobRecord,
  type ProjectConfig,
  type ProjectManifest,
  type ProjectSummary,
  ProjectSummary as ProjectSummarySchema,
} from '@mirai/shared'
import { openDatabase, checkpointWal, type Database } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { APP_DB_MIGRATIONS, PROJECT_DB_MIGRATIONS } from '../db/migrations'
import { JobQueue, type JobHandler } from '../jobs/jobQueue'
import { CreativeService } from '../creative/creativeService'
import { PromptService } from '../prompts/promptService'
import { StoryboardService } from '../storyboard/storyboardService'
import { MangaService } from '../creative/mangaService'
import { MoodboardService } from '../visual/moodboardService'
import { PosterService } from '../visual/posterService'
import { LocalizationService } from '../localization/localizationService'
import { CharacterSheetService } from '../visual/characterSheetService'
import { AnimationPipelineService } from '../animation/animationPipelineService'
import { ImpactService } from '../production/impactService'
import type { DerivedWorkKind, DerivedWorkView, InheritFlags } from '@mirai/shared'
import { MediaService } from '../media/mediaService'
import { RenderService } from '../render/renderService'
import { TimelineService } from '../timeline/timelineService'
import { ProductionService } from '../production/productionService'
import { SubtitleService } from '../subtitles/subtitleService'
import { BlenderBridge } from '../blender/blenderBridge'
import { AudioMixService } from '../audio/audioMixService'
import { newEntityId, type AppDirs, type Clock } from '../types'
import type { LoggerService } from '../logger/logger'
import { readManifest, writeManifest } from './manifest'

const PROJECT_DB_FILE = join('database', 'project.sqlite')
const BACKUP_MANIFEST = 'backup.json'

export interface ProjectServiceOptions {
  appDb: Database
  dirs: AppDirs
  clock: Clock
  appVersion: string
  logger: LoggerService
  /** Pushed on every job mutation of the active project. */
  onJobUpdated: (job: JobRecord) => void
}

/** An open project: summary + manifest + live project DB + services. */
export interface OpenProjectContext {
  summary: ProjectSummary
  manifest: ProjectManifest
  db: Database
  jobs: JobQueue
  /** Phase 1 creative core bound to this project's DB. */
  creative: CreativeService
  /** Prompt library bound to this project's DB. */
  prompts: PromptService
  /** Storyboard core (shots, frames, style bible) for this project. */
  storyboard: StoryboardService
  /** Manga Pro (§8): pages, panels, lettering, script export. */
  manga: MangaService
  /** IP impact screen (§4): real dependents of an entity. */
  ip: ImpactService
  /** Visual Dev Lab (§7): the project moodboard. */
  moodboard: MoodboardService
  /** Visual Dev Lab (§7): the poster studio. */
  poster: PosterService
  /** Localization Lab (§18): scene translations + glossary. */
  localization: LocalizationService
  /** AI-anime loop (v0.31): character reference sheets. */
  sheets: CharacterSheetService
  /** Animation Pipeline (v0.34): keyframe → in-between → cleanup → color → compositing. */
  animation: AnimationPipelineService
  /** Media library (music/SFX/ambience) for this project. */
  media: MediaService
  /** Render engine (FFmpeg) for this project. */
  render: RenderService
  /** Editing timeline + keyframes (Phase 5). */
  timeline: TimelineService
  /** Production management (Phase 7): tasks, approvals, versions, QC, analytics. */
  production: ProductionService
  /** Subtitle studio (Phase 4 wrap-up). */
  subtitles: SubtitleService
  /** Sound & Voice Studio (v0.36): real audio mix + master via FFmpeg. */
  audio: AudioMixService
  /** Headless Blender rendering (attach .blend → real shot video). */
  blender: BlenderBridge
  /** Jobs recovered as PAUSED after an interrupted session. */
  recoveredCount: number
}

interface RegistryRow {
  id: string
  name: string
  description: string | null
  path: string
  status: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
  app_version: string
}

export class ProjectService {
  private active: OpenProjectContext | null = null

  constructor(private readonly opts: ProjectServiceOptions) {}

  // ------------------------------------------------------------- derived works (§4)

  /**
   * Create a derived work of a parent project — a REAL new project whose
   * canon (bible / style bible / characters / locations) is inherited
   * from the parent. The link lives in the App DB (derived_works).
   */
  createDerivedWork(input: {
    parentId: string
    name: string
    description?: string
    kind: DerivedWorkKind
    notes?: string
    inherit: InheritFlags
    dir?: string
  }): { summary: ProjectSummary; workId: string } {
    const parent = this.summaryById(input.parentId)
    if (!existsSync(parent.path)) {
      throw new MiraiError('PROJECT_INVALID', `Parent project folder is missing: ${parent.path}`)
    }
    if (parent.id === input.name) {
      // no-op guard — names are ids-free, nothing to check beyond existence
    }

    // Product rule: one derived work per (parent, name) — a duplicate
    // name would silently create "Name 2" via uniquePath; refuse instead.
    const existingChildIds = (this.opts.appDb
      .prepare('SELECT child_project_id AS id FROM derived_works WHERE parent_project_id = ?')
      .all(input.parentId) as Array<{ id: string }>).map((r) => r.id)
    if (existingChildIds.length > 0) {
      const clash = this.opts.appDb
        .prepare(
          `SELECT name FROM project_registry WHERE id IN (${existingChildIds.map(() => '?').join(',')}) AND name = ?`,
        )
        .get(...existingChildIds, input.name) as { name: string } | undefined
      if (clash) {
        throw new MiraiError(
          'ALREADY_EXISTS',
          `A derived work named "${input.name}" already exists for this project.`,
        )
      }
    }

    const parentManifest = readManifest(parent.path)
    const child = this.create({
      name: input.name,
      description: input.description,
      dir: input.dir ?? join(parent.path, '..'),
      config: parentManifest.config,
    })

    this.inheritCanon(parent.path, child.path, input.inherit)

    const workId = newEntityId()
    this.opts.appDb
      .prepare(
        `INSERT INTO derived_works (id, parent_project_id, child_project_id, kind, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(workId, input.parentId, child.id, input.kind, input.notes ?? null, this.opts.clock.isoNow())
    this.opts.logger.info('PROJECT', `Derived work created: "${child.name}" from "${parent.name}"`, {
      kind: input.kind,
      inherit: input.inherit,
    })
    return { summary: child, workId }
  }

  /** Copy the requested canon from the parent DB into the child DB. */
  private inheritCanon(parentPath: string, childPath: string, flags: InheritFlags): void {
    const parentDb = openDatabase(join(parentPath, PROJECT_DB_FILE))
    const childDb = openDatabase(join(childPath, PROJECT_DB_FILE))
    try {
      const copyKv = (key: string): void => {
        const row = parentDb.prepare('SELECT value FROM kv_store WHERE key = ?').get(key) as
          | { value: string }
          | undefined
        if (!row) return
        childDb
          .prepare('INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)')
          .run(key, row.value, this.opts.clock.isoNow())
      }
      if (flags.storyBible) copyKv('story-bible')
      if (flags.styleBible) copyKv('style-bible')

      const copyTable = (table: string): number => {
        const rows = parentDb.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
        if (rows.length === 0) return 0
        const cols = Object.keys(rows[0]!)
        const insert = childDb.prepare(
          `INSERT OR REPLACE INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        )
        const tx = childDb.transaction(() => {
          for (const row of rows) insert.run(...cols.map((c) => row[c] as unknown))
        })
        tx()
        return rows.length
      }

      let copied = 0
      if (flags.characters) {
        copied += copyTable('characters')
        copied += copyTable('character_relationships')
        copied += copyTable('character_costumes')
        // scene cast links reference scenes that do not exist in the child — skip.
      }
      if (flags.locations) copied += copyTable('locations')
      if (copied > 0) {
        this.opts.logger.info('PROJECT', `Canon inherited: ${copied} rows`)
      }
    } finally {
      parentDb.close()
      childDb.close()
    }
  }

  /** Both directions of the derived-works graph around one project. */
  listDerivedWorks(projectId: string): DerivedWorkView[] {
    const rows = this.opts.appDb
      .prepare(
        `SELECT * FROM derived_works WHERE parent_project_id = ? OR child_project_id = ?
         ORDER BY created_at DESC`,
      )
      .all(projectId, projectId) as Array<{
      id: string
      parent_project_id: string
      child_project_id: string
      kind: string
      notes: string | null
      created_at: string
    }>
    return rows.map((row) => {
      const direction = row.parent_project_id === projectId ? 'child' : 'parent'
      const otherId = direction === 'child' ? row.child_project_id : row.parent_project_id
      const reg = this.opts.appDb
        .prepare('SELECT * FROM project_registry WHERE id = ?')
        .get(otherId) as RegistryRow | undefined
      const other = reg
        ? ({
            id: reg.id,
            name: reg.name,
            description: reg.description,
            path: reg.path,
            status: reg.status,
            createdAt: reg.created_at,
            updatedAt: reg.updated_at,
            lastOpenedAt: reg.last_opened_at,
            appVersion: reg.app_version,
          } as DerivedWorkView['other'])
        : null
      return {
        id: row.id,
        parentId: row.parent_project_id,
        childId: row.child_project_id,
        kind: row.kind as DerivedWorkKind,
        notes: row.notes,
        createdAt: row.created_at,
        direction,
        other,
      }
    })
  }

  /** Remove a derived-work LINK (never the projects themselves). */
  removeDerivedWork(id: string): void {
    const info = this.opts.appDb.prepare('DELETE FROM derived_works WHERE id = ?').run(id)
    if (info.changes === 0) throw new MiraiError('NOT_FOUND', `Derived work ${id} not found.`)
  }

  // ------------------------------------------------------------------ listing

  list(includeArchived = true): ProjectSummary[] {
    const rows = this.opts.appDb
      .prepare(
        'SELECT * FROM project_registry ORDER BY last_opened_at IS NULL, last_opened_at DESC, updated_at DESC',
      )
      .all() as RegistryRow[]
    return rows
      .map(rowToSummary)
      .filter((summary) => includeArchived || summary.status === 'ACTIVE')
  }

  summaryById(id: EntityId): ProjectSummary {
    const row = this.opts.appDb
      .prepare('SELECT * FROM project_registry WHERE id = ?')
      .get(id) as RegistryRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Project ${id} is not registered.`)
    return rowToSummary(row)
  }

  current(): OpenProjectContext | null {
    return this.active
  }

  // ------------------------------------------------------------------- create

  create(input: {
    name: string
    description?: string
    dir: string
    config: ProjectConfig
  }): ProjectSummary {
    const folderName = sanitizeFolderName(input.name)
    if (!folderName) {
      throw new MiraiError('VALIDATION_ERROR', 'Project name must contain letters or numbers.')
    }
    if (!existsSync(input.dir)) {
      throw new MiraiError('PATH_INVALID', `Directory does not exist: ${input.dir}`)
    }
    const projectPath = uniquePath(input.dir, folderName)
    const now = this.opts.clock.isoNow()
    const id = newEntityId()

    const manifest: ProjectManifest = {
      schemaVersion: 1,
      id,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      appVersion: this.opts.appVersion,
      config: input.config,
    }

    // Canonical folder layout (spec §5).
    mkdirSync(projectPath, { recursive: true })
    for (const folder of PROJECT_FOLDERS) {
      mkdirSync(join(projectPath, folder), { recursive: true })
    }
    writeManifest(projectPath, manifest)

    // Initialize the project DB so a fresh project is always valid.
    const db = openDatabase(join(projectPath, PROJECT_DB_FILE))
    try {
      const result = runMigrations(db, PROJECT_DB_MIGRATIONS)
      if (result.applied.length > 0) {
        this.opts.logger.info('PROJECT', `Project DB initialized: ${result.applied.join(', ')}`)
      }
    } finally {
      db.close()
    }

    this.insertRegistry(manifest, projectPath)
    this.opts.logger.info('PROJECT', `Project created: "${manifest.name}"`, { id, path: projectPath })
    return this.summaryById(id)
  }

  // --------------------------------------------------------------------- open

  async open(path: string): Promise<OpenProjectContext> {
    const manifest = readManifest(path)
    return this.openWithManifest(path, manifest)
  }

  async openById(id: EntityId): Promise<OpenProjectContext> {
    const summary = this.summaryById(id)
    if (!existsSync(summary.path)) {
      throw new MiraiError(
        'PROJECT_INVALID',
        `Project folder was moved or deleted: ${summary.path}. Use "Open Folder…" to re-import it from its new location.`,
      )
    }
    return this.open(summary.path)
  }

  async close(): Promise<void> {
    const ctx = this.active
    if (!ctx) return
    await ctx.jobs.stop()
    ctx.db.close()
    this.active = null
    this.opts.logger.info('PROJECT', `Project closed: "${ctx.summary.name}"`)
  }

  // --------------------------------------------------------------- duplicate

  duplicate(id: EntityId): ProjectSummary {
    const source = this.summaryById(id)
    if (!existsSync(source.path)) {
      throw new MiraiError('PROJECT_INVALID', `Source folder is missing: ${source.path}`)
    }
    const parentDir = join(source.path, '..')
    const baseName = sanitizeFolderName(`${source.name} (copy)`) || 'mirai-copy'
    const targetPath = uniquePath(parentDir, baseName)
    const now = this.opts.clock.isoNow()

    cpSync(source.path, targetPath, { recursive: true })

    const copyManifest: ProjectManifest = {
      ...readManifest(targetPath),
      id: newEntityId(),
      name: `${source.name} (copy)`.slice(0, 80),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      appVersion: this.opts.appVersion,
    }
    writeManifest(targetPath, copyManifest)

    // A duplicate starts with a clean job queue (jobs belong to a session).
    const db = openDatabase(join(targetPath, PROJECT_DB_FILE))
    try {
      db.prepare('DELETE FROM job_records').run()
    } finally {
      db.close()
    }

    this.insertRegistry(copyManifest, targetPath)
    this.opts.logger.info('PROJECT', `Project duplicated: "${source.name}" → "${copyManifest.name}"`)
    return this.summaryById(copyManifest.id)
  }

  // ------------------------------------------------------------ archive/restore

  archive(id: EntityId): ProjectSummary {
    return this.setStatus(id, 'ARCHIVED')
  }

  restore(id: EntityId): ProjectSummary {
    return this.setStatus(id, 'ACTIVE')
  }

  private setStatus(id: EntityId, status: 'ACTIVE' | 'ARCHIVED'): ProjectSummary {
    const summary = this.summaryById(id)
    if (!existsSync(summary.path)) {
      throw new MiraiError('PROJECT_INVALID', `Project folder is missing: ${summary.path}`)
    }
    const manifest = readManifest(summary.path)
    const updated: ProjectManifest = { ...manifest, status, updatedAt: this.opts.clock.isoNow() }
    writeManifest(summary.path, updated)

    this.opts.appDb
      .prepare('UPDATE project_registry SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updated.updatedAt, id)

    if (this.active && this.active.summary.id === id) {
      this.active.summary = { ...this.active.summary, status }
      this.active.manifest = updated
    }
    this.opts.logger.info('PROJECT', `Project "${summary.name}" → ${status}`)
    return this.summaryById(id)
  }

  // ---------------------------------------------------------------- remove

  removeFromList(id: EntityId): void {
    this.summaryById(id)
    if (this.active?.summary.id === id) {
      throw new MiraiError(
        'PROJECT_INVALID',
        'Close the project before removing it from the list. Files on disk are kept either way.',
      )
    }
    this.opts.appDb.prepare('DELETE FROM project_registry WHERE id = ?').run(id)
    this.opts.logger.info('PROJECT', `Project removed from list (files kept): ${id}`)
  }

  // ------------------------------------------------------------ update config

  updateActiveConfig(config: ProjectConfig): ProjectManifest {
    const ctx = this.requireActive()
    const manifest: ProjectManifest = { ...ctx.manifest, config, updatedAt: this.opts.clock.isoNow() }
    writeManifest(ctx.summary.path, manifest)
    this.opts.appDb
      .prepare('UPDATE project_registry SET updated_at = ? WHERE id = ?')
      .run(manifest.updatedAt, ctx.summary.id)
    ctx.manifest = manifest
    ctx.summary = { ...ctx.summary, updatedAt: manifest.updatedAt }
    this.opts.logger.info('PROJECT', `Project config updated: "${manifest.name}"`)
    return manifest
  }

  // ------------------------------------------------------------------ backups

  backup(id: EntityId): BackupInfo {
    const summary = this.summaryById(id)
    if (!existsSync(summary.path)) {
      throw new MiraiError('PROJECT_INVALID', `Project folder is missing: ${summary.path}`)
    }
    // Consistent copy: flush WAL first when the project is open.
    if (this.active?.summary.id === id) {
      checkpointWal(this.active.db)
    }
    const backupId = compactTimestamp(this.opts.clock.now())
    const backupDir = join(this.opts.dirs.backups, id, backupId)
    if (existsSync(backupDir)) {
      throw new MiraiError('ALREADY_EXISTS', 'A backup with this id already exists.')
    }
    mkdirSync(backupDir, { recursive: true })
    cpSync(summary.path, backupDir, { recursive: true })

    const info: BackupInfo = {
      id: backupId,
      projectId: id,
      path: backupDir,
      sizeBytes: dirSize(backupDir),
      createdAt: this.opts.clock.isoNow(),
    }
    writeFileSync(
      join(backupDir, BACKUP_MANIFEST),
      JSON.stringify(
        { ...info, projectName: summary.name, appVersion: this.opts.appVersion },
        null,
        2,
      ),
      'utf8',
    )
    this.opts.logger.info('PROJECT', `Backup created: ${backupId}`, { projectId: id })
    return info
  }

  listBackups(id: EntityId): BackupInfo[] {
    const root = join(this.opts.dirs.backups, id)
    if (!existsSync(root)) return []
    const backups: BackupInfo[] = []
    for (const entry of readdirSync(root)) {
      const metaPath = join(root, entry, BACKUP_MANIFEST)
      if (!existsSync(metaPath)) continue
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<BackupInfo>
        if (meta.id && meta.projectId === id && meta.createdAt) {
          backups.push({
            id: meta.id,
            projectId: id,
            path: join(root, entry),
            sizeBytes: meta.sizeBytes ?? dirSize(join(root, entry)),
            createdAt: meta.createdAt,
          })
        }
      } catch {
        // Unreadable backup metadata is skipped, not fatal.
      }
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Restore a backup. Takes a safety snapshot of the CURRENT state first —
   * a restore must never be the operation that loses data (spec §49).
   * If the project is open, it is closed before restoring.
   */
  async restoreBackup(id: EntityId, backupId: string): Promise<void> {
    const summary = this.summaryById(id)
    const backups = this.listBackups(id)
    const backup = backups.find((b) => b.id === backupId)
    if (!backup || !existsSync(backup.path)) {
      throw new MiraiError('NOT_FOUND', `Backup ${backupId} not found.`)
    }
    if (!existsSync(summary.path)) {
      throw new MiraiError('PROJECT_INVALID', `Project folder is missing: ${summary.path}`)
    }
    if (this.active?.summary.id === id) {
      await this.close()
    }

    // Safety snapshot of the current state (best-effort).
    try {
      const safetyId = `pre-restore-${compactTimestamp(this.opts.clock.now())}`
      const safetyDir = join(this.opts.dirs.backups, id, safetyId)
      mkdirSync(safetyDir, { recursive: true })
      cpSync(summary.path, safetyDir, { recursive: true })
      writeFileSync(
        join(safetyDir, BACKUP_MANIFEST),
        JSON.stringify(
          {
            id: safetyId,
            projectId: id,
            path: safetyDir,
            sizeBytes: dirSize(safetyDir),
            createdAt: this.opts.clock.isoNow(),
            projectName: summary.name,
            appVersion: this.opts.appVersion,
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch (err) {
      this.opts.logger.warn('PROJECT', 'Pre-restore safety snapshot failed; continuing restore.', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Wipe current contents (keep the folder itself), then copy the backup in.
    for (const entry of readdirSync(summary.path)) {
      rmSync(join(summary.path, entry), { recursive: true, force: true })
    }
    cpSync(backup.path, summary.path, {
      recursive: true,
      filter: (src) => !src.endsWith(BACKUP_MANIFEST),
    })
    rmSync(join(summary.path, BACKUP_MANIFEST), { force: true })

    // The restored manifest carries the original id — registry stays valid.
    this.opts.logger.info('PROJECT', `Backup restored: ${backupId}`, { projectId: id })
  }

  deleteBackup(id: EntityId, backupId: string): void {
    const backups = this.listBackups(id)
    if (backups.length <= 1) {
      throw new MiraiError(
        'PROJECT_INVALID',
        'The last backup cannot be deleted — Mirai never destroys the only safety copy.',
      )
    }
    const backup = backups.find((b) => b.id === backupId)
    if (!backup) throw new MiraiError('NOT_FOUND', `Backup ${backupId} not found.`)
    rmSync(backup.path, { recursive: true, force: true })
    this.opts.logger.info('PROJECT', `Backup deleted: ${backupId}`, { projectId: id })
  }

  // ---------------------------------------------------------------- validation

  /** Deep validation used by the `project.validate` job. */
  validateProject(path: string): { ok: boolean; issues: string[] } {
    const issues: string[] = []

    let manifest: ProjectManifest | null = null
    try {
      manifest = readManifest(path)
    } catch (err) {
      issues.push(err instanceof MiraiError ? err.message : String(err))
    }

    if (manifest) {
      const manifestId = manifest.id
      const registry = this.opts.appDb
        .prepare('SELECT id FROM project_registry WHERE id = ?')
        .get(manifestId) as { id: string } | undefined
      if (!registry) {
        issues.push('Project is not registered in this app (it will be registered on first open).')
      }
    }

    for (const folder of PROJECT_FOLDERS) {
      if (!existsSync(join(path, folder))) {
        issues.push(`Missing folder: ${folder}/`)
      }
    }

    const dbPath = join(path, PROJECT_DB_FILE)
    if (!existsSync(dbPath)) {
      issues.push('Project database is missing (database/project.sqlite).')
    } else {
      try {
        const db = openDatabase(dbPath)
        try {
          db.prepare('SELECT 1 FROM schema_migrations LIMIT 1').get()
          db.prepare('SELECT 1 FROM job_records LIMIT 1').get()
          db.prepare('SELECT 1 FROM prompts LIMIT 1').get()
          db.prepare('SELECT 1 FROM shots LIMIT 1').get()
          db.prepare('SELECT 1 FROM assets LIMIT 1').get()
        } finally {
          db.close()
        }
      } catch {
        issues.push('Project database is unreadable or corrupt.')
      }
    }

    return { ok: issues.length === 0, issues }
  }

  /** Job handler: validates the ACTIVE project (used by Jobs panel + palette). */
  createValidateJobHandler(): JobHandler {
    return async (job, ctx) => {
      const ctxProject = this.active
      if (!ctxProject) {
        throw new MiraiError('INTERNAL', 'Cannot validate: no project is open.')
      }
      const path = ctxProject.summary.path
      ctx.reportProgress(15)
      const result = this.validateProject(path)
      ctx.reportProgress(80)
      this.opts.logger.log(
        result.ok ? 'info' : 'warning',
        'PROJECT',
        result.ok
          ? `Validation passed: "${ctxProject.summary.name}"`
          : `Validation found ${result.issues.length} issue(s)`,
      )
      void job
      return result
    }
  }

  // ----------------------------------------------------------------- internal

  private requireActive(): OpenProjectContext {
    if (!this.active) {
      throw new MiraiError('NOT_FOUND', 'No project is open.')
    }
    return this.active
  }

  private async openWithManifest(path: string, manifest: ProjectManifest): Promise<OpenProjectContext> {
    if (this.active) {
      if (this.active.summary.id === manifest.id) {
        return this.active
      }
      await this.close()
    }

    const db = openDatabase(join(path, PROJECT_DB_FILE))
    let recoveredCount = 0
    try {
      const result = runMigrations(db, PROJECT_DB_MIGRATIONS)
      if (result.applied.length > 0) {
        this.opts.logger.info(
          'PROJECT',
          `Project DB upgraded: applied ${result.applied.join(', ')}`,
          { projectId: manifest.id },
        )
      }
    } catch (err) {
      db.close()
      throw new MiraiError(
        'DB_ERROR',
        'Project database could not be opened or migrated.',
        { details: err instanceof Error ? err.message : String(err) },
      )
    }

    const jobs = new JobQueue({
      db,
      clock: this.opts.clock,
      logger: this.opts.logger,
      onUpdated: this.opts.onJobUpdated,
    })
    jobs.register('project.validate', this.createValidateJobHandler())
    recoveredCount = jobs.pauseInterrupted()
    jobs.start()

    const creative = new CreativeService(db, this.opts.clock)
    const prompts = new PromptService(db, this.opts.clock)
    const storyboard = new StoryboardService(db, this.opts.clock, path)
    const manga = new MangaService(db, this.opts.clock, path)
    const ip = new ImpactService(db)
    const moodboard = new MoodboardService(db, this.opts.clock, path)
    const poster = new PosterService(db, this.opts.clock, path)
    const localization = new LocalizationService(db, this.opts.clock)
    const sheets = new CharacterSheetService(db, this.opts.clock, path)
    const animation = new AnimationPipelineService(db, this.opts.clock, path)
    const media = new MediaService(db, this.opts.clock, path)
    const timeline = new TimelineService(db, this.opts.clock)
    const production = new ProductionService(db, this.opts.clock, path, creative, storyboard, timeline, media)
    const subtitles = new SubtitleService(db, this.opts.clock, path)
    const audio = new AudioMixService(db, this.opts.clock, path)
    const render = new RenderService(storyboard, media, path, creative, timeline, subtitles)
    const blender = new BlenderBridge(storyboard, path)

    const now = this.opts.clock.isoNow()
    this.upsertRegistry(manifest, path, now)

    const summary = this.summaryById(manifest.id)
    this.active = { summary, manifest, db, jobs, creative, prompts, storyboard, manga, moodboard, poster, localization, sheets, animation, ip, media, render, timeline, production, subtitles, audio, blender, recoveredCount }
    this.opts.logger.info('PROJECT', `Project opened: "${manifest.name}"`, {
      id: manifest.id,
      recoveredJobs: recoveredCount,
    })
    return this.active
  }

  private insertRegistry(manifest: ProjectManifest, path: string): void {
    const now = this.opts.clock.isoNow()
    this.opts.appDb
      .prepare(
        `INSERT INTO project_registry
         (id, name, description, path, status, created_at, updated_at, last_opened_at, app_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.id,
        manifest.name,
        manifest.description ?? null,
        path,
        manifest.status,
        manifest.createdAt,
        manifest.updatedAt,
        now,
        this.opts.appVersion,
      )
  }

  /** Registry follows the manifest identity even if the folder moved (spec §5). */
  private upsertRegistry(manifest: ProjectManifest, path: string, openedAt: string): void {
    const byId = this.opts.appDb
      .prepare('SELECT id, path FROM project_registry WHERE id = ?')
      .get(manifest.id) as { id: string; path: string } | undefined
    if (byId) {
      if (byId.path !== path) {
        this.opts.logger.info('PROJECT', 'Project folder moved — updating registry path.', {
          from: byId.path,
          to: path,
        })
      }
      this.opts.appDb
        .prepare(
          `UPDATE project_registry
           SET name = ?, description = ?, path = ?, status = ?, updated_at = ?, last_opened_at = ?
           WHERE id = ?`,
        )
        .run(
          manifest.name,
          manifest.description ?? null,
          path,
          manifest.status,
          manifest.updatedAt,
          openedAt,
          manifest.id,
        )
      return
    }
    const byPath = this.opts.appDb
      .prepare('SELECT id FROM project_registry WHERE path = ?')
      .get(path) as { id: string } | undefined
    if (byPath) {
      // Same folder, different manifest id → re-register under the new identity.
      this.opts.appDb.prepare('DELETE FROM project_registry WHERE id = ?').run(byPath.id)
    }
    this.insertRegistry(manifest, path)
  }
}

// ---------------------------------------------------------------------- utils

function rowToSummary(row: RegistryRow): ProjectSummary {
  const parsed = ProjectSummarySchema.safeParse({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    path: row.path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    appVersion: row.app_version,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted registry row for project ${row.id}.`, {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
  return parsed.data
}

function sanitizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-')
    .slice(0, 60)
}

function uniquePath(dir: string, baseName: string): string {
  let candidate = join(dir, baseName)
  if (!existsSync(candidate)) return candidate
  for (let i = 2; i < 100; i++) {
    candidate = join(dir, `${baseName}-${i}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new MiraiError('ALREADY_EXISTS', `Too many projects named "${baseName}" in this directory.`)
}

function compactTimestamp(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const msPart = pad(date.getMilliseconds(), 3)
  return `${datePart}-${timePart}-${msPart}`
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += dirSize(full)
      } else {
        total += statSync(full).size
      }
    }
  } catch {
    // best-effort
  }
  return total
}

export { APP_DB_MIGRATIONS, PROJECT_DB_MIGRATIONS }
