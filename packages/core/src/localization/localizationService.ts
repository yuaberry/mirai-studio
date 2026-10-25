/**
 * LocalizationService (v0.29, §18 Localization Lab) — per-scene
 * translations with a living glossary. Every translation is a real row
 * (UNIQUE scene+language); the glossary is the term base the AI
 * translation MUST honor. Coverage counts come from live queries.
 */
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import {
  GlossaryTerm,
  GlossaryTermInput,
  LanguageCoverage,
  SceneTranslation,
  TranslationUpsertInput,
  type TranslationStatus,
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
    if (existing) {
      this.db
        .prepare('UPDATE scene_translations SET screenplay = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(parsed.screenplay, parsed.status, now, existing.id)
      return this.getTranslation(sceneId, parsed.language)!
    }
    const id = newEntityId()
    this.db
      .prepare(
        `INSERT INTO scene_translations (id, scene_id, language, screenplay, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sceneId, parsed.language, parsed.screenplay, parsed.status, now, now)
    return this.getTranslation(sceneId, parsed.language)!
  }

  deleteTranslation(sceneId: EntityId, language: string): void {
    const info = this.db
      .prepare('DELETE FROM scene_translations WHERE scene_id = ? AND language = ?')
      .run(sceneId, language)
    if (info.changes === 0) throw new MiraiError('NOT_FOUND', `No ${language} translation for that scene.`)
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
   * The effective screenplay for one language: the translation when it
   * exists, the original otherwise (the honest EPUB fallback).
   */
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
}
