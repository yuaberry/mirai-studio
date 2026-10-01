/**
 * Creative entities: Story Bible, Characters, Locations, Episodes, Scenes.
 * The AI Core reads these as its context — they are the narrative memory
 * of the project.
 */
import { z } from 'zod'
import { zAssetStatus, zTaskStatus } from '../status'
import { zEntityId, zIsoDate } from '../ids'

// ---------------------------------------------------------------- Story Bible

export const StoryBible = z.object({
  premise: z.string().max(4_000).optional(),
  themes: z.string().max(2_000).optional(),
  tone: z.string().max(2_000).optional(),
  message: z.string().max(2_000).optional(),
  narrativeRules: z.string().max(6_000).optional(),
  coreConcepts: z.string().max(6_000).optional(),
  genreNotes: z.string().max(2_000).optional(),
})
export type StoryBible = z.infer<typeof StoryBible>

// ------------------------------------------------------------------ Character

export const CHARACTER_ROLES = [
  'PROTAGONIST',
  'DEUTERAGONIST',
  'SUPPORTING',
  'ANTAGONIST',
  'CAMEO',
  'OTHER',
] as const
export type CharacterRole = (typeof CHARACTER_ROLES)[number]
export const zCharacterRole = z.enum(CHARACTER_ROLES)

export const CharacterInput = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  role: zCharacterRole.default('SUPPORTING'),
  /** Approval pipeline status (preserved on update when omitted). */
  status: zAssetStatus.optional(),
  age: z.string().max(40).optional(),
  personality: z.string().max(4_000).optional(),
  appearance: z.string().max(4_000).optional(),
  voice: z.string().max(2_000).optional(),
  bio: z.string().max(8_000).optional(),
  goals: z.string().max(4_000).optional(),
  fears: z.string().max(4_000).optional(),
  notes: z.string().max(8_000).optional(),
})
export type CharacterInput = z.input<typeof CharacterInput>

export const Character = CharacterInput.extend({
  status: zAssetStatus.default('DRAFT'),
})

// ------------------------------------------------------------------- Location

export const LocationInput = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  status: zAssetStatus.optional(),
  description: z.string().max(8_000).optional(),
  climate: z.string().max(2_000).optional(),
  architecture: z.string().max(4_000).optional(),
  notes: z.string().max(8_000).optional(),
})
export type LocationInput = z.input<typeof LocationInput>

export const Location = LocationInput.extend({
  status: zAssetStatus.default('DRAFT'),
})

// ------------------------------------------------------------------- Episode

export const EpisodeInput = z.object({
  season: z.number().int().min(1).max(100).default(1),
  number: z.number().int().min(0).max(10_000),
  title: z.string().min(1, 'Title is required').max(120),
  synopsis: z.string().max(8_000).optional(),
  status: zTaskStatus.optional(),
})
export type EpisodeInput = z.input<typeof EpisodeInput>

export const Episode = EpisodeInput.extend({
  status: zTaskStatus.default('TODO'),
})

export const EpisodeRecord = Episode.extend({
  id: zEntityId,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type EpisodeRecord = z.infer<typeof EpisodeRecord>

/** Episode + scene count for list views. */
export const EpisodeWithStats = EpisodeRecord.extend({
  sceneCount: z.number().int().min(0),
})
export type EpisodeWithStats = z.infer<typeof EpisodeWithStats>

// --------------------------------------------------------------------- Scene

export const TIMES_OF_DAY = ['DAY', 'NIGHT', 'DAWN', 'DUSK', 'UNSPECIFIED'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]
export const zTimeOfDay = z.enum(TIMES_OF_DAY)

export const SceneInput = z.object({
  title: z.string().min(1, 'Title is required').max(160),
  locationId: z.string().optional(),
  timeOfDay: zTimeOfDay.default('UNSPECIFIED'),
  characterIds: z.array(z.string()).max(50).default([]),
  synopsis: z.string().max(8_000).optional(),
  screenplay: z.string().max(120_000).optional(),
  status: zTaskStatus.optional(),
})
export type SceneInput = z.input<typeof SceneInput>

export const Scene = SceneInput.extend({
  id: z.string(),
  episodeId: z.string(),
  orderIndex: z.number().int().min(0),
  status: zTaskStatus.default('TODO'),
})

export const CharacterRecord = Character.extend({
  id: zEntityId,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type CharacterRecord = z.infer<typeof CharacterRecord>

export const LocationRecord = Location.extend({
  id: zEntityId,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type LocationRecord = z.infer<typeof LocationRecord>

export const SceneRecord = Scene.extend({
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type SceneRecord = z.infer<typeof SceneRecord>
