/**
 * Localization Lab (§18) — per-scene translations with a living
 * glossary (term base the AI MUST honor), translation statuses, and
 * the AI draft schema. Scenes translate into any BCP-47-ish tag the
 * author uses (en-US, pt-BR, ja…).
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
