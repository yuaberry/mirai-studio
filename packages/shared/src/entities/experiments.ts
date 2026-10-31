/**
 * Creative Experiments entities (§19 of the expansion roadmap) — generation
 * lab with side-by-side variation comparison and promote-to-project.
 *
 * An experiment groups variations of a source entity (shot, scene, page,
 * panel). Each variation is a real generated asset (image/audio/video) that
 * the user can compare, rate, and promote back into the project.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

// --------------------------------------------------------------- experiment run

export const EXPERIMENT_STATUSES = ['ACTIVE', 'ARCHIVED', 'COMPLETED'] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]
export const zExperimentStatus = z.enum(EXPERIMENT_STATUSES)

export const SOURCE_ENTITY_TYPES = ['SHOT', 'SCENE', 'PAGE', 'PANEL'] as const
export type SourceEntityType = (typeof SOURCE_ENTITY_TYPES)[number]
export const zSourceEntityType = z.enum(SOURCE_ENTITY_TYPES)

export const VARIATION_ASSET_KINDS = ['IMAGE', 'AUDIO', 'VIDEO'] as const
export type VariationAssetKind = (typeof VARIATION_ASSET_KINDS)[number]
export const zVariationAssetKind = z.enum(VARIATION_ASSET_KINDS)

export const ExperimentRunInput = z.object({
  name: z.string().min(1, 'Experiment name is required').max(120),
  description: z.string().max(2_000).optional(),
  sourceEntityType: zSourceEntityType,
  sourceEntityId: zEntityId,
})
export type ExperimentRunInput = z.input<typeof ExperimentRunInput>

export const ExperimentRunRecord = ExperimentRunInput.extend({
  id: zEntityId,
  status: zExperimentStatus.default('ACTIVE'),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type ExperimentRunRecord = z.infer<typeof ExperimentRunRecord>

// ----------------------------------------------------------- experiment variation

export const ExperimentVariationInput = z.object({
  experimentId: zEntityId,
  variationIndex: z.number().int().min(0),
  name: z.string().min(1).max(80),
  prompt: z.string().max(4_000).optional(),
  model: z.string().max(120).optional(),
  assetKind: zVariationAssetKind,
  assetId: zEntityId.optional(),
  generatedBytes: z.number().int().min(0).default(0),
  score: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2_000).optional(),
})
export type ExperimentVariationInput = z.input<typeof ExperimentVariationInput>

export const ExperimentVariationRecord = ExperimentVariationInput.extend({
  id: zEntityId,
  promoted: z.number().int().min(0).max(1).default(0),
  createdAt: zIsoDate,
})
export type ExperimentVariationRecord = z.infer<typeof ExperimentVariationRecord>

// ----------------------------------------------------------- experiment promotion

export const ExperimentPromotionInput = z.object({
  experimentId: zEntityId,
  variationId: zEntityId,
  targetEntityType: zSourceEntityType,
  targetEntityId: zEntityId,
  targetColumn: z.string().min(1).max(60), // 'frame_asset_id' | 'audio_asset_id' | ...
})
export type ExperimentPromotionInput = z.input<typeof ExperimentPromotionInput>

export const ExperimentPromotionRecord = ExperimentPromotionInput.extend({
  id: zEntityId,
  previousAssetId: zEntityId.nullable(),
  promotedAt: zIsoDate,
})
export type ExperimentPromotionRecord = z.infer<typeof ExperimentPromotionRecord>

// ----------------------------------------------------- experiment list summary

export const ExperimentRunSummary = z.object({
  id: zEntityId,
  name: z.string(),
  description: z.string().nullable(),
  sourceEntityType: zSourceEntityType,
  sourceEntityId: zEntityId,
  status: zExperimentStatus,
  variationCount: z.number().int().min(0),
  promotedCount: z.number().int().min(0),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type ExperimentRunSummary = z.infer<typeof ExperimentRunSummary>
