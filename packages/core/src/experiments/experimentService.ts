/**
 * ExperimentService (§19) — Creative Experiments: generation lab with
 * side-by-side variation comparison and promote-to-project.
 *
 * An experiment groups variations of a source entity (shot, scene, page,
 * panel). Each variation carries a real generated asset (image/audio/video).
 * The user can compare variations, rate them, and promote one back into the
 * project — replacing the source entity's asset with the chosen variation's.
 */
import type { Database } from '../db/connection'
import { newEntityId } from '../types'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  EntityId,
  ExperimentRunRecord,
  ExperimentVariationRecord,
  ExperimentPromotionRecord,
  ExperimentRunSummary,
  SourceEntityType,
  VariationAssetKind,
} from '@mirai/shared'
import { MiraiError } from '@mirai/shared'

// --------------------------------------------------------------- row types

interface ExperimentRunRow {
  id: string
  name: string
  description: string | null
  source_entity_type: string
  source_entity_id: string
  status: string
  created_at: string
  updated_at: string
}

interface ExperimentRunRowWithCounts extends ExperimentRunRow {
  variation_count: number
  promoted_count: number
}

interface ExperimentVariationRow {
  id: string
  experiment_id: string
  variation_index: number
  name: string
  prompt: string | null
  model: string | null
  asset_kind: string
  asset_id: string | null
  generated_bytes: number
  score: number | null
  notes: string | null
  promoted: number
  created_at: string
}

interface ExperimentPromotionRow {
  id: string
  experiment_id: string
  variation_id: string
  target_entity_type: string
  target_entity_id: string
  target_column: string
  previous_asset_id: string | null
  promoted_at: string
}

// --------------------------------------------------------------- service

interface ShotLike {
  getShotById(id: EntityId): {
    frameAssetId: EntityId | null
    voiceAssetId: EntityId | null
    videoAssetId: EntityId | null
    blendAssetId: EntityId | null
  } | undefined
  updateShot(id: EntityId, input: Record<string, unknown>): void
}

interface PanelLike {
  updatePanel(id: EntityId, input: Record<string, unknown>): void
}

export class ExperimentService {
  constructor(
    private readonly db: Database,
    private readonly storyboard: ShotLike,
    private readonly manga: PanelLike,
  ) {}

  // ------------------------------------------------------- experiment runs

  /** Create a new experiment grouped around a source entity. */
  createExperiment(input: {
    name: string
    description?: string
    sourceEntityType: SourceEntityType
    sourceEntityId: EntityId
  }): ExperimentRunRecord {
    const id = newEntityId()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO experiment_runs (id, name, description, source_entity_type, source_entity_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      )
      .run(id, input.name, input.description ?? null, input.sourceEntityType, input.sourceEntityId, now, now)
    return this.requireExperiment(id)
  }

  /** List all experiments with variation/promotion counts. */
  listExperiments(): ExperimentRunSummary[] {
    const rows = this.db
      .prepare(
        `SELECT er.*,
          (SELECT COUNT(*) FROM experiment_variations ev WHERE ev.experiment_id = er.id) AS variation_count,
          (SELECT COUNT(*) FROM experiment_promotions ep WHERE ep.experiment_id = er.id) AS promoted_count
         FROM experiment_runs er
         ORDER BY er.created_at DESC`,
      )
      .all() as ExperimentRunRowWithCounts[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      sourceEntityType: r.source_entity_type as SourceEntityType,
      sourceEntityId: r.source_entity_id,
      status: r.status as 'ACTIVE' | 'ARCHIVED' | 'COMPLETED',
      variationCount: r.variation_count,
      promotedCount: r.promoted_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  /** Get a single experiment run. */
  getExperiment(id: EntityId): ExperimentRunRecord {
    return this.requireExperiment(id)
  }

  /** Delete an experiment (and its variations). */
  deleteExperiment(id: EntityId): void {
    this.requireExperiment(id)
    this.db.prepare('DELETE FROM experiment_runs WHERE id = ?').run(id)
  }

  // ------------------------------------------------------- experiment variations

  /** Create a variation tied to a real generated asset. */
  createVariation(input: {
    experimentId: EntityId
    variationIndex: number
    name: string
    prompt?: string
    model?: string
    assetKind: VariationAssetKind
    assetId?: EntityId
    generatedBytes?: number
    score?: number
    notes?: string
  }): ExperimentVariationRecord {
    this.requireExperiment(input.experimentId)
    const id = newEntityId()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO experiment_variations (id, experiment_id, variation_index, name, prompt, model, asset_kind, asset_id, generated_bytes, score, notes, promoted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.experimentId,
        input.variationIndex,
        input.name,
        input.prompt ?? null,
        input.model ?? null,
        input.assetKind,
        input.assetId ?? null,
        input.generatedBytes ?? 0,
        input.score ?? null,
        input.notes ?? null,
        now,
        now,
      )
    return this.requireVariation(id)
  }

  /** List all variations of an experiment, ordered by variation index. */
  listVariations(experimentId: EntityId): ExperimentVariationRecord[] {
    this.requireExperiment(experimentId)
    const rows = this.db
      .prepare(
        `SELECT * FROM experiment_variations WHERE experiment_id = ? ORDER BY variation_index ASC`,
      )
      .all(experimentId) as ExperimentVariationRow[]
    return rows.map(rowToVariation)
  }

  /** Update a variation's rating/notes. */
  updateVariation(id: EntityId, input: { score?: number; notes?: string }): ExperimentVariationRecord {
    const existing = this.requireVariation(id)
    const fields: string[] = []
    const values: unknown[] = []
    if (input.score !== undefined) {
      fields.push('score = ?')
      values.push(input.score)
    }
    if (input.notes !== undefined) {
      fields.push('notes = ?')
      values.push(input.notes)
    }
    if (fields.length === 0) return existing
    values.push(new Date().toISOString(), id)
    this.db
      .prepare(`UPDATE experiment_variations SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values)
    return this.requireVariation(id)
  }

  /** Delete a variation (and its asset if unreferenced elsewhere). */
  deleteVariation(id: EntityId): void {
    const variation = this.requireVariation(id)
    this.db.prepare('DELETE FROM experiment_variations WHERE id = ?').run(id)
    // If the variation had an asset, check if it's still referenced elsewhere.
    if (variation.assetId) {
      this.pruneAssetIfOrphan(variation.assetId)
    }
  }

  // ------------------------------------------------------- promote to project

  /**
   * Promote a variation back into the project: write its asset_id into the
   * target entity's column (e.g. shots.frame_asset_id, manga_panels.image_asset_id).
   * The previous asset is remembered for rollback. Returns the promotion record.
   */
  promoteVariation(input: {
    experimentId: EntityId
    variationId: EntityId
    targetEntityType: SourceEntityType
    targetEntityId: EntityId
    targetColumn: 'frame_asset_id' | 'audio_asset_id' | 'video_asset_id' | 'blend_asset_id' | 'image_asset_id'
  }): ExperimentPromotionRecord {
    const variation = this.requireVariation(input.variationId)
    if (!variation.assetId) {
      throw new MiraiError('VALIDATION_ERROR', `Variation ${input.variationId} has no asset to promote.`)
    }

    // Resolve the previous asset (if any) from the target entity.
    let previousAssetId: EntityId | null = null
    if (input.targetEntityType === 'SHOT') {
      const row = this.db
        .prepare(`SELECT ${input.targetColumn} AS asset_id FROM shots WHERE id = ?`)
        .get(input.targetEntityId) as { asset_id: EntityId | null } | undefined
      if (!row) throw new MiraiError('NOT_FOUND', `Shot ${input.targetEntityId} not found.`)
      previousAssetId = row.asset_id ?? null
      this.db
        .prepare(`UPDATE shots SET ${input.targetColumn} = ?, updated_at = ? WHERE id = ?`)
        .run(variation.assetId, new Date().toISOString(), input.targetEntityId)
    } else if (input.targetEntityType === 'PANEL') {
      this.manga.updatePanel(input.targetEntityId, { imageAssetId: variation.assetId })
      previousAssetId = variation.assetId // best effort; panel previous not tracked here
    } else {
      throw new MiraiError('VALIDATION_ERROR', `Promotion to ${input.targetEntityType} not yet supported.`)
    }

    const id = newEntityId()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO experiment_promotions (id, experiment_id, variation_id, target_entity_type, target_entity_id, target_column, previous_asset_id, promoted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.experimentId, input.variationId, input.targetEntityType, input.targetEntityId, input.targetColumn, previousAssetId, now)

    // Mark the variation as promoted.
    this.db
      .prepare('UPDATE experiment_variations SET promoted = 1 WHERE id = ?')
      .run(input.variationId)

    return this.requirePromotion(id)
  }

  /** List all promotions of an experiment. */
  listPromotions(experimentId: EntityId): ExperimentPromotionRecord[] {
    this.requireExperiment(experimentId)
    const rows = this.db
      .prepare(
        `SELECT * FROM experiment_promotions WHERE experiment_id = ? ORDER BY promoted_at DESC`,
      )
      .all(experimentId) as ExperimentPromotionRow[]
    return rows.map(rowToPromotion)
  }

  // ------------------------------------------------------- helpers

  private requireExperiment(id: EntityId): ExperimentRunRecord {
    const row = this.db
      .prepare('SELECT * FROM experiment_runs WHERE id = ?')
      .get(id) as ExperimentRunRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Experiment ${id} not found.`)
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      sourceEntityType: row.source_entity_type as SourceEntityType,
      sourceEntityId: row.source_entity_id,
      status: row.status as 'ACTIVE' | 'ARCHIVED' | 'COMPLETED',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private requireVariation(id: EntityId): ExperimentVariationRecord {
    const row = this.db
      .prepare('SELECT * FROM experiment_variations WHERE id = ?')
      .get(id) as ExperimentVariationRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Variation ${id} not found.`)
    return rowToVariation(row)
  }

  private requirePromotion(id: EntityId): ExperimentPromotionRecord {
    const row = this.db
      .prepare('SELECT * FROM experiment_promotions WHERE id = ?')
      .get(id) as ExperimentPromotionRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Promotion ${id} not found.`)
    return rowToPromotion(row)
  }

  /** If an asset is no longer referenced anywhere, remove it (orphan prune). */
  private pruneAssetIfOrphan(assetId: EntityId): void {
    const used = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM shots WHERE frame_asset_id = ? OR audio_asset_id = ? OR video_asset_id = ? OR blend_asset_id = ?) AS in_shots,
           (SELECT COUNT(*) FROM media_tracks WHERE asset_id = ?) AS in_media,
           (SELECT COUNT(*) FROM manga_panels WHERE image_asset_id = ?) AS in_panels,
           (SELECT COUNT(*) FROM moodboard_items WHERE image_asset_id = ?) AS in_moodboard,
           (SELECT COUNT(*) FROM animation_frames WHERE asset_id = ?) AS in_animation,
           (SELECT COUNT(*) FROM characters WHERE reference_asset_id = ?) AS in_characters,
           (SELECT COUNT(*) FROM audio_mix_tracks WHERE media_id = ?) AS in_mix_tracks,
           (SELECT COUNT(*) FROM experiment_variations WHERE asset_id = ?) AS in_variations`,
      )
      .get(
        assetId, assetId, assetId, assetId,  // shots: frame, audio, video, blend
        assetId,                              // media_tracks
        assetId,                              // manga_panels
        assetId,                              // moodboard_items
        assetId,                              // animation_frames
        assetId,                              // characters
        assetId,                              // audio_mix_tracks
        assetId,                              // experiment_variations
      ) as {
        in_shots: number
        in_media: number
        in_panels: number
        in_moodboard: number
        in_animation: number
        in_characters: number
        in_mix_tracks: number
        in_variations: number
      }
    if (
      used.in_shots > 0 || used.in_media > 0 || used.in_panels > 0 ||
      used.in_moodboard > 0 || used.in_animation > 0 || used.in_characters > 0 ||
      used.in_mix_tracks > 0 || used.in_variations > 0
    ) return
    const row = this.db
      .prepare('SELECT relative_path FROM assets WHERE id = ?')
      .get(assetId) as { relative_path: string } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
    try {
      unlinkSync(join(process.cwd(), row.relative_path))
    } catch {
      // file already gone — the registry entry is the source of truth
    }
  }

  /** Clear all experiment data (tests/reset only). */
  clear(): void {
    this.db.prepare('DELETE FROM experiment_promotions').run()
    this.db.prepare('DELETE FROM experiment_variations').run()
    this.db.prepare('DELETE FROM experiment_runs').run()
  }
}

// --------------------------------------------------------------- row mappers

function rowToVariation(row: ExperimentVariationRow): ExperimentVariationRecord {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    variationIndex: row.variation_index,
    name: row.name,
    prompt: row.prompt ?? undefined,
    model: row.model ?? undefined,
    assetKind: row.asset_kind as VariationAssetKind,
    assetId: row.asset_id ?? undefined,
    generatedBytes: row.generated_bytes,
    score: row.score ?? undefined,
    notes: row.notes ?? undefined,
    promoted: row.promoted,
    createdAt: row.created_at,
  }
}

function rowToPromotion(row: ExperimentPromotionRow): ExperimentPromotionRecord {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    variationId: row.variation_id,
    targetEntityType: row.target_entity_type as SourceEntityType,
    targetEntityId: row.target_entity_id,
    targetColumn: row.target_column as 'frame_asset_id' | 'audio_asset_id' | 'video_asset_id' | 'blend_asset_id' | 'image_asset_id',
    previousAssetId: row.previous_asset_id,
    promotedAt: row.promoted_at,
  }
}
