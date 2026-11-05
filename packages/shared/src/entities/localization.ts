/**
 * Localization Lab (§18) — per-scene translations with a living
 * glossary (term base the AI MUST honor), translation statuses, and
 * the AI draft schema. Scenes translate into any BCP-47-ish tag the
 * author uses (en-US, pt-BR, ja…).
 *
 * Workflow (§18 complete): every translation follows a governed state
 * machine — DRAFT → REVIEW → APPROVED → FINAL — with an immutable
 * audit log, reviewer comments, and source-change (stale) detection.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

export const TRANSLATION_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'FINAL'] as const
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number]
export const zTranslationStatus = z.enum(TRANSLATION_STATUSES)

/** BCP-47-ish language tag: letters/digits/hyphen, 2-16 chars. */
export const zLanguageTag = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, 'Use a language tag like en-US, pt-BR or ja')
  .max(16)

// --------------------------------------------------------------- translations

export const TranslationUpsertInput = z.object({
  language: zLanguageTag,
  screenplay: z.string().min(1, 'Translation cannot be empty').max(120_000),
  status: zTranslationStatus.default('DRAFT'),
})
export type TranslationUpsertInput = z.input<typeof TranslationUpsertInput>

export const SceneTranslation = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  language: zLanguageTag,
  screenplay: z.string().min(1),
  status: zTranslationStatus,
  /** Who reviewed (REVIEW→APPROVED→FINAL chain). */
  reviewedBy: zEntityId.nullable(),
  /** Timestamp of the last review action. */
  reviewedAt: zIsoDate.nullable(),
  /** Who approved (APPROVED→FINAL). */
  approvedBy: zEntityId.nullable(),
  /** Timestamp of approval. */
  approvedAt: zIsoDate.nullable(),
  /** Reviewer's note attached to the status change. */
  reviewerComment: z.string().max(1_000).nullable(),
  /** SHA-256 of the source screenplay when this translation was created/last synced. */
  sourceHash: z.string().nullable(),
  /** Source screenplay version at translation time (bumped when source changes). */
  sourceVersion: z.number().int().min(1).default(1),
  /** True when the source screenplay changed after this translation. */
  isStale: z.boolean().default(false),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type SceneTranslation = z.infer<typeof SceneTranslation>

/** Coverage for one target language across the whole project. */
export const LanguageCoverage = z.object({
  language: zLanguageTag,
  translated: z.number().int().min(0),
  total: z.number().int().min(0),
})
export type LanguageCoverage = z.infer<typeof LanguageCoverage>

// --------------------------------------------------------------- workflow

/** Valid forward transitions in the governed state machine. */
export const TRANSITION_MAP: Record<TranslationStatus, TranslationStatus[]> = {
  DRAFT: ['REVIEW', 'DRAFT'],            // draft → review (submit) or stay (edit)
  REVIEW: ['APPROVED', 'DRAFT', 'REVIEW'], // review → approve / back to draft / re-review
  APPROVED: ['FINAL', 'REVIEW', 'APPROVED'], // approved → final / back to review / re-approve
  FINAL: ['REVIEW'],                       // final → re-open for review (e.g. source changed)
} as const

/** Validate that a status transition is allowed. Returns the reason if not. */
export function validateTransition(from: TranslationStatus, to: TranslationStatus): { ok: true } | { ok: false; reason: string } {
  const allowed = TRANSITION_MAP[from]
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Cannot transition ${from} → ${to}` }
  }
  return { ok: true }
}

export const zTranslationTransition = z.object({
  sceneId: zEntityId,
  language: zLanguageTag,
  fromStatus: zTranslationStatus,
  toStatus: zTranslationStatus,
  changedBy: zEntityId.optional(),   // character id of the user
  comment: z.string().max(1_000).optional(),
})
export type TranslationTransition = z.input<typeof zTranslationTransition>

export const TranslationTransitionResult = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  translation: z.lazy(() => SceneTranslation).optional(),
})
export type TranslationTransitionResult = z.infer<typeof TranslationTransitionResult>

// --------------------------------------------------------------- audit log

/** One row in the immutable translation audit trail. */
export const TranslationAuditEntry = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  language: zLanguageTag,
  oldStatus: zTranslationStatus.nullable(),
  newStatus: zTranslationStatus,
  changedBy: zEntityId.nullable(),
  changedAt: zIsoDate,
  comment: z.string().max(1_000).nullable(),
})
export type TranslationAuditEntry = z.infer<typeof TranslationAuditEntry>

export const zTranslationAuditEntry = TranslationAuditEntry

// --------------------------------------------------------------- matrix

/** One cell of the scenes × languages coverage matrix. */
export const TranslationMatrixEntry = z.object({
  sceneId: zEntityId,
  sceneTitle: z.string(),
  language: zLanguageTag,
  status: zTranslationStatus,
  isStale: z.boolean().default(false),
  hasTranslation: z.boolean().default(false),
  updatedAt: zIsoDate,
})
export type TranslationMatrixEntry = z.infer<typeof TranslationMatrixEntry>

export const TranslationMatrix = z.object({
  languages: z.array(zLanguageTag),
  entries: z.array(TranslationMatrixEntry),
})
export type TranslationMatrix = z.infer<typeof TranslationMatrix>

// ------------------------------------------------------------------- glossary

export const GlossaryTermInput = z.object({
  source: z.string().min(1, 'Source term is required').max(200),
  target: z.string().min(1, 'Translation is required').max(200),
  language: zLanguageTag,
  notes: z.string().max(1_000).optional(),
})
export type GlossaryTermInput = z.input<typeof GlossaryTermInput>

export const GlossaryTerm = GlossaryTermInput.extend({
  id: zEntityId,
  notes: z.string().nullable(),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type GlossaryTerm = z.infer<typeof GlossaryTerm>

// ----------------------------------------------------------------- AI draft

/** What the AI proposes for one scene translation (human reviews). */
export const SceneTranslationDraft = z.object({
  screenplay: z.string().min(1).max(120_000),
})
export type SceneTranslationDraft = z.infer<typeof SceneTranslationDraft>
