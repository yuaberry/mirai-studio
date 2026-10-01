/**
 * ProductionService (Phase 7) — the production management core:
 * task board, crew roster, governed approval pipeline with audit trail,
 * entity versioning (snapshot/restore/diff), QC checks and analytics.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  APPROVAL_TRANSITIONS,
  EntityVersion,
  isTransitionAllowed,
  MiraiError,
  QcFinding,
  QcReport,
  TaskCreateInput,
  TaskPatch,
  TaskRecord,
  ApprovalEvent,
  type ApprovalEntityType,
  type ApprovalPosition,
  type CrewMember as CrewMemberType,
  type EntityId,
  type ProductionAnalytics,
  type TaskStatus,
  type VersionDiffEntry,
  type VersionableEntityType,
} from '@mirai/shared'
import type { z } from 'zod'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'
import type { CreativeService } from '../creative/creativeService'
import type { StoryboardService } from '../storyboard/storyboardService'
import type { TimelineService } from '../timeline/timelineService'
import type { MediaService } from '../media/mediaService'

interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  order_index: number
  link_type: string | null
  link_id: string | null
  assignee_id: string | null
  created_at: string
  updated_at: string
}

interface CrewRow {
  id: string
  name: string
  role: string
  created_at: string
}

interface ApprovalRow {
  id: string
  entity_type: string
  entity_id: string
  from_status: string
  to_status: string
  note: string | null
  actor_name: string
  created_at: string
}

interface VersionRow {
  id: string
  entity_type: string
  entity_id: string
  version: number
  label: string | null
  snapshot: string
  created_at: string
}

export class ProductionService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
    private readonly creative: CreativeService,
    private readonly storyboard: StoryboardService,
    private readonly timeline: TimelineService,
    private readonly media: MediaService,
  ) {}

  // ----------------------------------------------------------------- tasks

  listTasks(status?: TaskStatus): TaskRecord[] {
    const rows = status
      ? (this.db
          .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY order_index ASC, created_at ASC')
          .all(status) as TaskRow[])
      : (this.db
          .prepare('SELECT * FROM tasks ORDER BY status ASC, order_index ASC, created_at ASC')
          .all() as TaskRow[])
    return rows.map(rowToTask)
  }

  createTask(input: z.input<typeof TaskCreateInput>): TaskRecord {
    const parsed = parseOrThrow(TaskCreateInput, input, 'Invalid task.')
    const id = newEntityId()
    const now = this.clock.isoNow()
    const maxRow = this.db
      .prepare("SELECT COALESCE(MAX(order_index), -1) AS max FROM tasks WHERE status = 'TODO'")
      .get() as { max: number }
    this.db
      .prepare(
        `INSERT INTO tasks
         (id, title, description, status, priority, order_index, link_type, link_id, assignee_id, created_at, updated_at)
         VALUES (?, ?, ?, 'TODO', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.title,
        parsed.description ?? null,
        parsed.priority,
        maxRow.max + 1,
        parsed.linkType ?? null,
        parsed.linkId ?? null,
        parsed.assigneeId ?? null,
        now,
        now,
      )
    return this.getTask(id)
  }

  getTask(id: EntityId): TaskRecord {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Task ${id} not found.`)
    return rowToTask(row)
  }

  updateTask(id: EntityId, patch: z.input<typeof TaskPatch>): TaskRecord {
    const parsed = parseOrThrow(TaskPatch, patch, 'Invalid task patch.')
    const task = this.getTask(id)
    this.db
      .prepare(
        `UPDATE tasks
         SET title = ?, description = ?, priority = ?, link_type = ?, link_id = ?, assignee_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.title ?? task.title,
        parsed.description !== undefined ? parsed.description : task.description,
        parsed.priority ?? task.priority,
        parsed.linkType !== undefined ? parsed.linkType : task.linkType,
        parsed.linkId !== undefined ? parsed.linkId : task.linkId,
        parsed.assigneeId !== undefined ? parsed.assigneeId : task.assigneeId,
        this.clock.isoNow(),
        id,
      )
    return this.getTask(id)
  }

  /** Move a task to a status column (appends at the end of that column). */
  setTaskStatus(id: EntityId, status: TaskStatus): TaskRecord {
    const task = this.getTask(id)
    if (task.status === status) return task
    const now = this.clock.isoNow()
    const tx = this.db.transaction(() => {
      // Gap-free-ish ordering: append at the end of the target column.
      const maxRow = this.db
        .prepare('SELECT COALESCE(MAX(order_index), -1) AS max FROM tasks WHERE status = ?')
        .get(status) as { max: number }
      this.db
        .prepare('UPDATE tasks SET status = ?, order_index = ?, updated_at = ? WHERE id = ?')
        .run(status, maxRow.max + 1, now, id)
    })
    tx()
    return this.getTask(id)
  }

  deleteTask(id: EntityId): void {
    const res = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    if (res.changes === 0) throw new MiraiError('NOT_FOUND', `Task ${id} not found.`)
  }

  // ----------------------------------------------------------------- crew

  listCrew(): CrewMemberType[] {
    return (this.db
      .prepare('SELECT * FROM crew_members ORDER BY created_at ASC')
      .all() as CrewRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role as CrewMemberType['role'],
      createdAt: row.created_at,
    }))
  }

  createCrewMember(name: string, role: CrewMemberType['role']): CrewMemberType {
    const id = newEntityId()
    this.db
      .prepare('INSERT INTO crew_members (id, name, role, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, role, this.clock.isoNow())
    return { id, name, role, createdAt: this.clock.isoNow() }
  }

  deleteCrewMember(id: EntityId): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?').run(id)
      const res = this.db.prepare('DELETE FROM crew_members WHERE id = ?').run(id)
      if (res.changes === 0) throw new MiraiError('NOT_FOUND', `Crew member ${id} not found.`)
    })
    tx()
  }

  // ------------------------------------------------------------- approvals

  /**
   * Governed status transition: one step forward at a time, free backwards
   * movement (revision loops), every change recorded in the audit log.
   */
  transition(
    entityType: ApprovalEntityType,
    entityId: EntityId,
    toStatus: string,
    note?: string,
    actorName = 'Director',
  ): ApprovalEvent {
    const pipeline = APPROVAL_TRANSITIONS[entityType]
    const current = this.entityStatus(entityType, entityId)
    if (!isTransitionAllowed(entityType, current, toStatus)) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `"${entityType}" can't move from ${current} to ${toStatus}. Pipeline: ${pipeline.join(' → ')} — one step forward at a time; backwards is always allowed.`,
      )
    }
    const id = newEntityId()
    const now = this.clock.isoNow()
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO approval_events (id, entity_type, entity_id, from_status, to_status, note, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, entityType, entityId, current, toStatus, note ?? null, actorName, now)
      this.applyStatus(entityType, entityId, toStatus)
    })
    tx()
    return rowToApproval(
      this.db.prepare('SELECT * FROM approval_events WHERE id = ?').get(id) as ApprovalRow,
    )
  }

  listApprovals(entityType?: ApprovalEntityType, entityId?: EntityId): ApprovalEvent[] {
    const rows = (entityType && entityId
      ? this.db
          .prepare('SELECT * FROM approval_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC')
          .all(entityType, entityId)
      : entityType
        ? this.db
            .prepare('SELECT * FROM approval_events WHERE entity_type = ? ORDER BY created_at DESC')
            .all(entityType)
        : this.db
            .prepare('SELECT * FROM approval_events ORDER BY created_at DESC LIMIT 500')
            .all()) as ApprovalRow[]
    return rows.map(rowToApproval)
  }

  /** Pipeline positions for board-style UIs (optional entity filter). */
  approvalPosition(entityType: ApprovalEntityType, entityId: EntityId): ApprovalPosition {
    const pipeline = [...APPROVAL_TRANSITIONS[entityType]]
    const status = this.entityStatus(entityType, entityId)
    const idx = pipeline.indexOf(status)
    const nextStatus = idx >= 0 && idx < pipeline.length - 1 ? pipeline[idx + 1]! : null
    return {
      entityType,
      entityId,
      title: this.entityTitle(entityType, entityId),
      status,
      pipeline,
      nextStatus,
    }
  }

  private entityStatus(entityType: ApprovalEntityType, entityId: EntityId): string {
    switch (entityType) {
      case 'CHARACTER':
        return this.creative.getCharacter(entityId).status
      case 'LOCATION':
        return this.creative.getLocation(entityId).status
      case 'EPISODE':
        return this.creative.getEpisodeById(entityId).status
      case 'SCENE':
        return this.creative.getSceneById(entityId).status
      case 'SHOT':
        return this.storyboard.getShotById(entityId).status
    }
  }

  private entityTitle(entityType: ApprovalEntityType, entityId: EntityId): string {
    switch (entityType) {
      case 'CHARACTER':
        return this.creative.getCharacter(entityId).name
      case 'LOCATION':
        return this.creative.getLocation(entityId).name
      case 'EPISODE':
        return this.creative.getEpisodeById(entityId).title
      case 'SCENE':
        return this.creative.getSceneById(entityId).title
      case 'SHOT':
        return this.storyboard.getShotById(entityId).title
    }
  }

  private applyStatus(entityType: ApprovalEntityType, entityId: EntityId, status: string): void {
    const table = { CHARACTER: 'characters', LOCATION: 'locations', EPISODE: 'episodes', SCENE: 'scenes', SHOT: 'shots' }[entityType]
    this.db
      .prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, this.clock.isoNow(), entityId)
  }

  // ------------------------------------------------------------- versioning

  listVersions(entityType: VersionableEntityType, entityId: EntityId): EntityVersion[] {
    return (this.db
      .prepare('SELECT * FROM entity_versions WHERE entity_type = ? AND entity_id = ? ORDER BY version DESC')
      .all(entityType, entityId) as VersionRow[]).map(rowToVersion)
  }

  /** Captures the current record as the next version. */
  snapshotVersion(entityType: VersionableEntityType, entityId: EntityId, label?: string): EntityVersion {
    const snapshot = this.serializeEntity(entityType, entityId)
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS max FROM entity_versions WHERE entity_type = ? AND entity_id = ?')
      .get(entityType, entityId) as { max: number }
    const id = newEntityId()
    this.db
      .prepare(
        'INSERT INTO entity_versions (id, entity_type, entity_id, version, label, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, entityType, entityId, maxRow.max + 1, label ?? null, JSON.stringify(snapshot), this.clock.isoNow())
    return rowToVersion(
      this.db.prepare('SELECT * FROM entity_versions WHERE id = ?').get(id) as VersionRow,
    )
  }

  /** Restores a version — the current state is snapshotted first (never lose work). */
  restoreVersion(versionId: EntityId): EntityVersion {
    const row = this.db
      .prepare('SELECT * FROM entity_versions WHERE id = ?')
      .get(versionId) as VersionRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Version ${versionId} not found.`)
    // Safety snapshot of the live record before overwriting it.
    this.snapshotVersion(row.entity_type as VersionableEntityType, row.entity_id, 'auto — before restore')
    const snapshot = JSON.parse(row.snapshot) as Record<string, unknown>
    this.deserializeEntity(row.entity_type as VersionableEntityType, row.entity_id, snapshot)
    return rowToVersion(row)
  }

  diffVersions(fromVersionId: EntityId, toVersionId: EntityId): VersionDiffEntry[] {
    const from = this.db
      .prepare('SELECT * FROM entity_versions WHERE id = ?')
      .get(fromVersionId) as VersionRow | undefined
    const to = this.db
      .prepare('SELECT * FROM entity_versions WHERE id = ?')
      .get(toVersionId) as VersionRow | undefined
    if (!from || !to) throw new MiraiError('NOT_FOUND', 'Version not found.')
    if (from.entity_type !== to.entity_type || from.entity_id !== to.entity_id) {
      throw new MiraiError('VALIDATION_ERROR', "Can't diff versions of different entities.")
    }
    return diffRecords(
      JSON.parse(from.snapshot) as Record<string, unknown>,
      JSON.parse(to.snapshot) as Record<string, unknown>,
    )
  }

  private serializeEntity(entityType: VersionableEntityType, entityId: EntityId): Record<string, unknown> {
    switch (entityType) {
      case 'CHARACTER':
        return this.creative.getCharacter(entityId) as unknown as Record<string, unknown>
      case 'LOCATION':
        return this.creative.getLocation(entityId) as unknown as Record<string, unknown>
      case 'SCENE':
        return this.creative.getSceneById(entityId) as unknown as Record<string, unknown>
      case 'SHOT':
        return this.storyboard.getShotById(entityId) as unknown as Record<string, unknown>
      case 'STYLE_BIBLE':
        return this.storyboard.getStyleBible() as unknown as Record<string, unknown>
    }
  }

  private deserializeEntity(
    entityType: VersionableEntityType,
    entityId: EntityId,
    snapshot: Record<string, unknown>,
  ): void {
    switch (entityType) {
      case 'CHARACTER':
        this.creative.updateCharacter(entityId, snapshot as never)
        break
      case 'LOCATION':
        this.creative.updateLocation(entityId, snapshot as never)
        break
      case 'SCENE':
        this.creative.updateScene(entityId, snapshot as never)
        break
      case 'SHOT':
        this.storyboard.updateShot(entityId, snapshot as never)
        break
      case 'STYLE_BIBLE':
        this.storyboard.updateStyleBible(snapshot as never)
        break
    }
  }

  // ----------------------------------------------------------------- QC

  /** Automated quality checks over the whole production. */
  runQc(): QcReport {
    const findings: QcFinding[] = []
    const episodes = this.creative.listEpisodes()
    for (const episode of episodes) {
      const scenes = this.creative.listScenes(episode.id)
      if (scenes.length === 0) {
        findings.push({
          checkId: 'episode-no-scenes',
          severity: 'WARNING',
          entityType: 'EPISODE',
          entityId: episode.id,
          title: `Episode "${episode.title}" has no scenes`,
          detail: 'An episode renders only from its scenes — add at least one.',
          fixHint: 'Episodes & Scenes → add a scene',
        })
      }
      for (const scene of scenes) {
        const shots = this.storyboard.listShots(scene.id)
        if (shots.length === 0) {
          findings.push({
            checkId: 'scene-no-shots',
            severity: 'WARNING',
            entityType: 'SCENE',
            entityId: scene.id,
            title: `Scene "${scene.title}" has no shots`,
            detail: 'Scenes need shots before the timeline can be assembled.',
            fixHint: 'Storyboard → add shots',
          })
        }
        if (!scene.screenplay || scene.screenplay.trim().length === 0) {
          findings.push({
            checkId: 'scene-no-screenplay',
            severity: 'INFO',
            entityType: 'SCENE',
            entityId: scene.id,
            title: `Scene "${scene.title}" has no screenplay`,
            detail: 'Draft it manually or with the Scene Writer agent.',
            fixHint: 'Episodes & Scenes → write dialogue',
          })
        }
        const timeline = this.timeline.getTimeline(scene.id)
        if (shots.length > 0 && timeline.clips.length === 0) {
          findings.push({
            checkId: 'scene-no-timeline',
            severity: 'WARNING',
            entityType: 'SCENE',
            entityId: scene.id,
            title: `Scene "${scene.title}" has no timeline`,
            detail: 'Build the timeline so the scene can render and be edited.',
            fixHint: 'Timeline → Build Timeline',
          })
        }
        for (const shot of shots) {
          if (!shot.frameAssetId) {
            findings.push({
              checkId: 'shot-no-frame',
              severity: 'WARNING',
              entityType: 'SHOT',
              entityId: shot.id,
              title: `Shot "${shot.title}" has no frame image`,
              detail: 'The render outputs a black segment for this shot.',
              fixHint: 'Storyboard → import or generate a frame',
            })
          } else if (!existsSync(join(this.projectRoot, this.assetRelativePath(shot.frameAssetId)))) {
            findings.push({
              checkId: 'shot-frame-missing-file',
              severity: 'ERROR',
              entityType: 'SHOT',
              entityId: shot.id,
              title: `Shot "${shot.title}" frame file is missing on disk`,
              detail: 'The asset registry points to a file that no longer exists.',
              fixHint: 'Storyboard → re-import the frame',
            })
          }
          if (shot.dialogue && shot.dialogue.trim().length > 0 && !shot.voiceAssetId) {
            findings.push({
              checkId: 'shot-dialogue-no-voice',
              severity: 'INFO',
              entityType: 'SHOT',
              entityId: shot.id,
              title: `Shot "${shot.title}" has dialogue but no voice line`,
              detail: 'The scene will render without dialogue audio for this shot.',
              fixHint: 'Storyboard → import a voice line',
            })
          }
        }
      }
    }
    for (const character of this.creative.listCharacters()) {
      if (!character.appearance || character.appearance.trim().length === 0) {
        findings.push({
          checkId: 'character-no-appearance',
          severity: 'INFO',
          entityType: 'CHARACTER',
          entityId: character.id,
          title: `Character "${character.name}" has no appearance description`,
          detail: 'The consistency prompt uses appearance for image generation.',
          fixHint: 'Characters → describe the appearance',
        })
      }
    }
    for (const track of this.media.list('all')) {
      if (!existsSync(join(this.projectRoot, this.assetRelativePath(track.assetId)))) {
        findings.push({
          checkId: 'media-missing-file',
          severity: 'ERROR',
          entityType: 'MEDIA',
          entityId: track.id,
          title: `Media "${track.title}" file is missing on disk`,
          detail: 'The media library points to a file that no longer exists.',
          fixHint: 'Media Library → re-import the file',
        })
      }
    }

    const bySeverity = (sev: QcFinding['severity']) => findings.filter((f) => f.severity === sev).length
    return {
      ranAt: this.clock.isoNow(),
      findings,
      errorCount: bySeverity('ERROR'),
      warningCount: bySeverity('WARNING'),
      infoCount: bySeverity('INFO'),
    }
  }

  private assetRelativePath(assetId: EntityId): string {
    const row = this.db
      .prepare('SELECT relative_path FROM assets WHERE id = ?')
      .get(assetId) as { relative_path: string } | undefined
    if (!row) return ''
    return row.relative_path
  }

  // ------------------------------------------------------------- analytics

  overview(): ProductionAnalytics {
    const count = (sql: string, ...params: unknown[]): number =>
      (this.db.prepare(sql).get(...params) as { n: number }).n
    const byStatus = (table: string): Record<string, number> => {
      const rows = this.db
        .prepare(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`)
        .all() as Array<{ status: string; n: number }>
      return Object.fromEntries(rows.map((r) => [r.status, r.n]))
    }

    const episodes = this.creative.listEpisodes()
    const scenesByEpisode = episodes.map((ep) => this.creative.listScenes(ep.id))
    const allScenes = scenesByEpisode.flat()
    const shots = allScenes.flatMap((sc) => this.storyboard.listShots(sc.id))

    return {
      episodes: { total: episodes.length, byStatus: byStatus('episodes') },
      scenes: {
        total: allScenes.length,
        byStatus: byStatus('scenes'),
        withTimeline: allScenes.filter((sc) => this.timeline.getTimeline(sc.id).clips.length > 0).length,
        withScreenplay: allScenes.filter((sc) => (sc.screenplay ?? '').trim().length > 0).length,
      },
      shots: {
        total: shots.length,
        withFrame: shots.filter((s) => s.frameAssetId !== null).length,
        withVoice: shots.filter((s) => s.voiceAssetId !== null).length,
        byStatus: byStatus('shots'),
      },
      assets: {
        total: count('SELECT COUNT(*) AS n FROM assets'),
        images: count("SELECT COUNT(*) AS n FROM assets WHERE kind = 'IMAGE'"),
        audio: count("SELECT COUNT(*) AS n FROM assets WHERE kind = 'AUDIO'"),
      },
      media: {
        byKind: Object.fromEntries(
          (this.db
            .prepare('SELECT kind, COUNT(*) AS n FROM media_tracks GROUP BY kind')
            .all() as Array<{ kind: string; n: number }>).map((r) => [r.kind, r.n]),
        ),
      },
      tasks: { total: count('SELECT COUNT(*) AS n FROM tasks'), byStatus: byStatus('tasks') },
      approvals: { events: count('SELECT COUNT(*) AS n FROM approval_events') },
      crew: { total: count('SELECT COUNT(*) AS n FROM crew_members') },
      versions: { total: count('SELECT COUNT(*) AS n FROM entity_versions') },
    }
  }
}

// ---------------------------------------------------------------- mappers

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskRecord['status'],
    priority: row.priority as TaskRecord['priority'],
    orderIndex: row.order_index,
    linkType: (row.link_type ?? null) as TaskRecord['linkType'],
    linkId: (row.link_id ?? null) as TaskRecord['linkId'],
    assigneeId: (row.assignee_id ?? null) as TaskRecord['assigneeId'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToApproval(row: ApprovalRow): ApprovalEvent {
  return {
    id: row.id,
    entityType: row.entity_type as ApprovalEvent['entityType'],
    entityId: row.entity_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }
}

function rowToVersion(row: VersionRow): EntityVersion {
  return {
    id: row.id,
    entityType: row.entity_type as EntityVersion['entityType'],
    entityId: row.entity_id,
    version: row.version,
    label: row.label,
    snapshot: row.snapshot,
    createdAt: row.created_at,
  }
}

function diffRecords(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): VersionDiffEntry[] {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)])
  const entries: VersionDiffEntry[] = []
  for (const key of keys) {
    const a = from[key]
    const b = to[key]
    const sa = a === null || a === undefined ? null : typeof a === 'object' ? JSON.stringify(a) : String(a)
    const sb = b === null || b === undefined ? null : typeof b === 'object' ? JSON.stringify(b) : String(b)
    if (sa !== sb) {
      entries.push({
        field: key,
        from: sa === null ? null : sa.length > 300 ? `${sa.slice(0, 297)}…` : sa,
        to: sb === null ? null : sb.length > 300 ? `${sb.slice(0, 297)}…` : sb,
      })
    }
  }
  return entries.sort((x, y) => x.field.localeCompare(y.field))
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', message, {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}
