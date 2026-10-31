/**
 * LocalizationService (v0.29 + §18 workflow, V1 Beta Experimental 5) — per-scene
 * translations with a living glossary. Every translation is a real row
 * (UNIQUE scene+language); the glossary is the term base the AI
 * translation MUST honor. Coverage counts come from live queries.
 *
 * Workflow: governed state machine DRAFT → REVIEW → APPROVED → FINAL
 * with an immutable audit log, reviewer comments, and source-change
 * (stale) detection via SHA-256 of the source screenplay.
 */
import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import {
  GlossaryTerm,
  GlossaryTermInput,
  LanguageCoverage,
  SceneTranslation,
  TranslationAuditEntry,
  TranslationMatrix,
  TranslationMatrixEntry,
  TranslationTransitionResult,
  TranslationUpsertInput,
  type TranslationStatus,
  validateTransition,
} from '@mirai/shared'
import type { Clock } from '../types'
import type { EntityId } from '@mirai/shared'
import { MiraiError } from '@mirai/shared'
import { newEntityId } from '../types'

interface TranslationRow {
  id: string
  scene_id: string
  language: string
  screenplay: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  approved_by: string | null
  approved_at: string | null
  reviewer_comment: string | null
  source_hash: string | null
  source_version: number
  created_at: string
  updated_at: string
}

interface TermRow {
  id: string
  source: string
  target: string
  language: string
  notes: string | null
  created_at: string
  updated_at: string
}

interface AuditRow {
  id: string
  scene_id: string
  language: string
  old_status: string | null
  new_status: string
  changed_by: string | null
  changed_at: string
  comment: string | null
}

function parseWith<T extends z.ZodTypeAny>(schema: T, data: unknown, label: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', `Invalid ${label}.`, {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}

function rowToTranslation(row: TranslationRow): SceneTranslation {
  return {
    id: row.id,
    sceneId: row.scene_id,
    language: row.language,
    screenplay: row.screenplay,
    status: (row.status as TranslationStatus) ?? 'DRAFT',
    reviewedBy: (row.reviewed_by ?? null) as EntityId | null,
    reviewedAt: row.reviewed_at ?? null,
    approvedBy: (row.approved_by ?? null) as EntityId | null,
    approvedAt: row.approved_at ?? null,
    reviewerComment: row.reviewer_comment ?? null,
    sourceHash: row.source_hash ?? null,
    sourceVersion: row.source_version,
    isStale: false, // computed separately
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToTerm(row: TermRow): GlossaryTerm {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    language: row.language,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToAudit(row: AuditRow): TranslationAuditEntry {
  return {
    id: row.id,
    sceneId: row.scene_id,
    language: row.language,
    oldStatus: (row.old_status as TranslationStatus | null) ?? null,
    newStatus: (row.new_status as TranslationStatus),
    changedBy: (row.changed_by ?? null) as EntityId | null,
    changedAt: row.changed_at,
    comment: row.comment ?? null,
  }
}

/** SHA-256 of a string, hex-encoded. Used for source-change detection. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class LocalizationService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------- translations

  listTranslations(sceneId: EntityId): SceneTranslation[] {
    const rows = this.db
      .prepare('SELECT * FROM scene_translations WHERE scene_id = ? ORDER BY language ASC')
      .all(sceneId) as TranslationRow[]
    return rows.map(rowToTranslation)
  }

  getTranslation(sceneId: EntityId, language: string): SceneTranslation | null {
    const row = this.db
      .prepare('SELECT * FROM scene_translations WHERE scene_id = ? AND language = ?')
      .get(sceneId, language) as TranslationRow | undefined
    return row ? rowToTranslation(row) : null
  }

  upsertTranslation(sceneId: EntityId, input: z.input<typeof TranslationUpsertInput>): SceneTranslation {
    const parsed = parseWith(TranslationUpsertInput, input, 'translation')
    const existing = this.getTranslation(sceneId, parsed.language)
    const now = this.clock.isoNow()
    const sourceHash = sha256(parsed.screenplay)

    if (existing) {
      // If the source screenplay changed, bump version
      const sourceChanged = existing.sourceHash && existing.sourceHash !== sourceHash
      this.db
        .prepare(
          `UPDATE scene_translations
           SET screenplay = ?, status = ?, updated_at = ?,
               source_hash = ?, source_version = source_version + ?
           WHERE id = ?`,
        )
        .run(
          parsed.screenplay,
          parsed.status,
          now,
          sourceHash,
          sourceChanged ? 1 : 0,
          existing.id,
        )
      return this.getTranslation(sceneId, parsed.language)!
    }

    const id = newEntityId()
    this.db
      .prepare(
        `INSERT INTO scene_translations (id, scene_id, language, screenplay, status, source_hash, source_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, sceneId, parsed.language, parsed.screenplay, parsed.status, sourceHash, now, now)
    return this.getTranslation(sceneId, parsed.language)!
  }

  deleteTranslation(sceneId: EntityId, language: string): void {
    const info = this.db
      .prepare('DELETE FROM scene_translations WHERE scene_id = ? AND language = ?')
      .run(sceneId, language)
    if (info.changes === 0) throw new MiraiError('NOT_FOUND', `No ${language} translation for that scene.`)
  }

  /**
   * Governed status transition with immutable audit log.
   * Enforces: DRAFT→REVIEW→APPROVED→FINAL, with back-edges allowed.
   */
  transitionStatus(
    sceneId: EntityId,
    language: string,
    input: { fromStatus: TranslationStatus; toStatus: TranslationStatus; changedBy?: EntityId; comment?: string },
  ): TranslationTransitionResult {
    const validation = validateTransition(input.fromStatus, input.toStatus)
    if (!validation.ok) {
      return { ok: false, reason: validation.reason }
    }

    const existing = this.getTranslation(sceneId, language)
    if (!existing) {
      return { ok: false, reason: `No ${language} translation for scene ${sceneId}` }
    }
    if (existing.status !== input.fromStatus) {
      return {
        ok: false,
        reason: `Current status is ${existing.status}, not ${input.fromStatus}`,
      }
    }

    const now = this.clock.isoNow()
    const id = newEntityId()

    // Write audit log first (immutable)
    this.db
      .prepare(
        `INSERT INTO translation_audit_log (id, scene_id, language, old_status, new_status, changed_by, changed_at, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sceneId,
        language,
        existing.status,
        input.toStatus,
        input.changedBy ?? null,
        now,
        input.comment ?? null,
      )

    // Apply status change + review/approve timestamps
    const updates: string[] = ['status = ?', 'updated_at = ?']
    const values: unknown[] = [input.toStatus, now]

    if (input.toStatus === 'REVIEW' || input.toStatus === 'APPROVED' || input.toStatus === 'FINAL') {
      updates.push('reviewed_by = ?', 'reviewed_at = ?')
      values.push(input.changedBy ?? null, now)
    }
    if (input.toStatus === 'APPROVED' || input.toStatus === 'FINAL') {
      updates.push('approved_by = ?', 'approved_at = ?')
      values.push(input.changedBy ?? null, now)
    }
    if (input.comment) {
      updates.push('reviewer_comment = ?')
      values.push(input.comment)
    }
    values.push(sceneId, language)

    this.db
      .prepare(`UPDATE scene_translations SET ${updates.join(', ')} WHERE scene_id = ? AND language = ?`)
      .run(...values)

    const updated = this.getTranslation(sceneId, language)!
    return { ok: true, translation: updated }
  }

  /**
   * Mark a translation as stale when its source screenplay changed.
   * Call this after any source screenplay edit.
   */
  markStaleIfSourceChanged(sceneId: EntityId, language: string, currentSourceHash: string): boolean {
    const existing = this.getTranslation(sceneId, language)
    if (!existing) return false
    if (!existing.sourceHash || existing.sourceHash !== currentSourceHash) {
      this.db
        .prepare(
          `UPDATE scene_translations SET source_hash = ?, source_version = source_version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(currentSourceHash, this.clock.isoNow(), existing.id)
      return true
    }
    return false
  }

  /** Mark ALL translations of a scene as stale when its source screenplay changed. */
  markSceneStale(sceneId: EntityId, currentSourceHash: string): number {
    const translations = this.listTranslations(sceneId)
    let count = 0
    for (const t of translations) {
      if (!t.sourceHash || t.sourceHash !== currentSourceHash) {
        this.markStaleIfSourceChanged(sceneId, t.language, currentSourceHash)
        count += 1
      }
    }
    return count
  }

  /** Check if a translation is stale (source changed after translation). */
  isStale(sceneId: EntityId, language: string): boolean {
    const existing = this.getTranslation(sceneId, language)
    return !!existing?.sourceHash && existing.sourceHash !== sha256(existing.screenplay)
  }

  // ------------------------------------------------------------- coverage

  /** All target languages in use, each with translated/total scene counts. */
  coverage(totalScenes: number): LanguageCoverage[] {
    const rows = this.db
      .prepare('SELECT language, COUNT(*) AS n FROM scene_translations GROUP BY language ORDER BY language ASC')
      .all() as Array<{ language: string; n: number }>
    return rows.map((row) => ({
      language: row.language,
      translated: row.n,
      total: totalScenes,
    }))
  }

  /** Every distinct target language (for pickers). */
  listLanguages(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT language FROM scene_translations ORDER BY language ASC')
      .all() as Array<{ language: string }>
    return rows.map((r) => r.language)
  }

  /**
   * Matrix: scenes × languages with status + staleness.
   * Used by the UI to see at a glance what needs work.
   */
  matrix(episodeId: EntityId): TranslationMatrix {
    const scenes = this.db
      .prepare('SELECT id, title FROM scenes WHERE episode_id = ? ORDER BY id')
      .all(episodeId) as Array<{ id: string; title: string }>

    // Collect all languages used in this episode's scenes
    const languages = new Set<string>()
    const allTranslations = this.db
      .prepare(
        `SELECT scene_id, language, status, source_hash, source_version, screenplay
         FROM scene_translations
         WHERE scene_id IN (SELECT id FROM scenes WHERE episode_id = ?)`,
      )
      .all(episodeId) as Array<{
        scene_id: string
        language: string
        status: string
        source_hash: string | null
        source_version: number
        screenplay: string
      }>

    for (const t of allTranslations) languages.add(t.language)

    // Build lookup: scene_id → language → translation row
    const bySceneLang = new Map<string, Map<string, typeof allTranslations[number]>>()
    for (const t of allTranslations) {
      let byLang = bySceneLang.get(t.scene_id)
      if (!byLang) {
        byLang = new Map()
        bySceneLang.set(t.scene_id, byLang)
      }
      byLang.set(t.language, t)
    }

    const entries: TranslationMatrixEntry[] = []
    for (const scene of scenes) {
      const byLang = bySceneLang.get(scene.id)
      for (const language of languages) {
        const t = byLang?.get(language)
        if (t) {
          const stale = !t.source_hash || t.source_hash !== sha256(t.screenplay)
          entries.push({
            sceneId: scene.id,
            sceneTitle: scene.title,
            language,
            status: t.status as TranslationStatus,
            isStale: stale,
            hasTranslation: true,
            updatedAt: t.source_version > 1 ? 'updated' : 'created', // placeholder
          })
        } else {
          entries.push({
            sceneId: scene.id,
            sceneTitle: scene.title,
            language,
            status: 'DRAFT',
            isStale: false,
            hasTranslation: false,
            updatedAt: '',
          })
        }
      }
    }

    return {
      languages: Array.from(languages).sort(),
      entries,
    }
  }

  /** The effective screenplay for one language: the translation when it
   *  exists, the original otherwise (the honest EPUB fallback). */
  effectiveScreenplay(sceneId: EntityId, original: string | undefined, language: string): { text: string; translated: boolean } {
    const row = this.db
      .prepare('SELECT screenplay FROM scene_translations WHERE scene_id = ? AND language = ?')
      .get(sceneId, language) as { screenplay: string } | undefined
    if (row) return { text: row.screenplay, translated: true }
    return { text: original ?? '', translated: false }
  }

  // --------------------------------------------------------------- glossary

  listGlossary(language?: string): GlossaryTerm[] {
    const rows = language
      ? (this.db.prepare('SELECT * FROM glossary_terms WHERE language = ? ORDER BY source ASC').all(language) as TermRow[])
      : (this.db.prepare('SELECT * FROM glossary_terms ORDER BY language ASC, source ASC').all() as TermRow[])
    return rows.map(rowToTerm)
  }

  upsertGlossary(input: z.input<typeof GlossaryTermInput>): GlossaryTerm {
    const parsed = parseWith(GlossaryTermInput, input, 'glossary term')
    const existing = this.db
      .prepare('SELECT * FROM glossary_terms WHERE source = ? AND language = ?')
      .get(parsed.source, parsed.language) as TermRow | undefined
    const now = this.clock.isoNow()
    if (existing) {
      this.db
        .prepare('UPDATE glossary_terms SET target = ?, notes = ?, updated_at = ? WHERE id = ?')
        .run(parsed.target, parsed.notes ?? null, now, existing.id)
    } else {
      this.db
        .prepare(
          `INSERT INTO glossary_terms (id, source, target, language, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(newEntityId(), parsed.source, parsed.target, parsed.language, parsed.notes ?? null, now, now)
    }
    const row = this.db
      .prepare('SELECT * FROM glossary_terms WHERE source = ? AND language = ?')
      .get(parsed.source, parsed.language) as TermRow
    return rowToTerm(row)
  }

  deleteGlossary(id: EntityId): void {
    const info = this.db.prepare('DELETE FROM glossary_terms WHERE id = ?').run(id)
    if (info.changes === 0) throw new MiraiError('NOT_FOUND', `Glossary term ${id} not found.`)
  }

  // --------------------------------------------------------------- audit

  /** Immutable audit log: every status change, newest first. */
  auditLog(sceneId: EntityId, language?: string): TranslationAuditEntry[] {
    const rows = language
      ? (this.db
          .prepare(
            'SELECT * FROM translation_audit_log WHERE scene_id = ? AND language = ? ORDER BY changed_at DESC',
          )
          .all(sceneId, language) as AuditRow[])
      : (this.db
          .prepare('SELECT * FROM translation_audit_log WHERE scene_id = ? ORDER BY changed_at DESC')
          .all(sceneId) as AuditRow[])
    return rows.map(rowToAudit)
  }

  /** Clear all experiment data (tests/reset only). */
  clear(): void {
    this.db.prepare('DELETE FROM translation_audit_log').run()
    this.db.prepare('DELETE FROM scene_translations').run()
  }
}
