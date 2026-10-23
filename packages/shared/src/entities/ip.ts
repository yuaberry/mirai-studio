/**
 * IP Graph entities (§4 of the expansion roadmap): derived works
 * (project-to-project relationships in the App DB) and the entity
 * impact screen (project-level, real counts of dependents).
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { ProjectSummary } from './project'

// ------------------------------------------------------------- derived works

export const DERIVED_WORK_KINDS = [
  'ADAPTATION',
  'SPIN_OFF',
  'SEQUEL',
  'PREQUEL',
  'TRANSLATION',
  'OTHER',
] as const
export type DerivedWorkKind = (typeof DERIVED_WORK_KINDS)[number]

/** Which canon travels from the parent project into the derived work. */
export const InheritFlags = z.object({
  storyBible: z.boolean().default(true),
  styleBible: z.boolean().default(true),
  characters: z.boolean().default(true),
  locations: z.boolean().default(false),
})
export type InheritFlags = z.input<typeof InheritFlags>

export const CreateDerivedWorkInput = z.object({
  parentId: zEntityId,
  name: z.string().min(1, 'Name is required').max(120),
  description: z.string().max(2_000).optional(),
  kind: z.enum(DERIVED_WORK_KINDS).default('ADAPTATION'),
  notes: z.string().max(2_000).optional(),
  inherit: InheritFlags,
})
export type CreateDerivedWorkInput = z.input<typeof CreateDerivedWorkInput>

export const DerivedWorkRecord = z.object({
  id: zEntityId,
  parentId: zEntityId,
  childId: zEntityId,
  kind: z.enum(DERIVED_WORK_KINDS),
  notes: z.string().nullable(),
  createdAt: zIsoDate,
})
export type DerivedWorkRecord = z.infer<typeof DerivedWorkRecord>

/** A derived-work edge with the OTHER side's project (null if unregistered). */
export const DerivedWorkView = DerivedWorkRecord.extend({
  /** 'child' = this row points FROM the requested project TO the other. */
  direction: z.enum(['child', 'parent']),
  other: ProjectSummary.nullable(),
})
export type DerivedWorkView = z.infer<typeof DerivedWorkView>

// ----------------------------------------------------------- impact screen

export const IMPACT_KINDS = ['CHARACTER', 'SCENE', 'EPISODE', 'LOCATION', 'SHOT'] as const
export type ImpactKind = (typeof IMPACT_KINDS)[number]

export const ImpactEntry = z.object({
  /** Stable machine key, e.g. 'scenes'. */
  key: z.string(),
  /** Human label, e.g. 'Scenes this character appears in'. */
  label: z.string(),
  count: z.number().int().min(0),
  /** Up to 50 real entity ids (never fabricated). */
  entityIds: z.array(z.string()).max(50),
})
export type ImpactEntry = z.infer<typeof ImpactEntry>

export const ImpactResult = z.object({
  kind: z.enum(IMPACT_KINDS),
  id: zEntityId,
  /** Display name/title of the entity itself. */
  label: z.string(),
  impacts: z.array(ImpactEntry),
})
export type ImpactResult = z.infer<typeof ImpactResult>
