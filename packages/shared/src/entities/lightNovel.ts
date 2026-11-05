/**
 * Light Novel Pro entities (§9 slice 3) — volume/chapter structure + POV control.
 *
 * Light novels are organized as volumes → chapters → scenes. Each chapter
 * carries a POV (point of view) setting — who tells this part of the story
 * and from which narrative perspective — so the author can plan voice
 * consistency across the whole work.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { zTaskStatus } from '../status'

// ----------------------------------------------------------- POV (point of view)

export const POV_TYPES = [
  'FIRST_PERSON',        // "I" — a character narrates (povCharacterId required)
  'THIRD_PERSON_LIMITED', // "He/she" — camera follows one character (povCharacterId optional)
  'THIRD_PERSON_OMNISCIENT', // "He/she" — narrator knows everything (no povCharacterId)
  'SECOND_PERSON',       // "You" — reader is the protagonist (no povCharacterId)
] as const
export type PovType = (typeof POV_TYPES)[number]
export const zPovType = z.enum(POV_TYPES)

export const PovSettingInput = z.object({
  povType: zPovType.default('THIRD_PERSON_LIMITED'),
  povCharacterId: zEntityId.optional(), // who narrates / whose camera we follow
})
export type PovSettingInput = z.input<typeof PovSettingInput>

export const PovSetting = PovSettingInput.extend({
  povType: zPovType,
})
export type PovSetting = z.infer<typeof PovSetting>

// ---------------------------------------------------------------- Volume

export const VolumeInput = z.object({
  number: z.number().int().min(1).max(1000),
  title: z.string().min(1, 'Volume title is required').max(120),
  status: zTaskStatus.optional(),
})
export type VolumeInput = z.input<typeof VolumeInput>

export const Volume = VolumeInput.extend({
  status: zTaskStatus.default('TODO'),
})

export const VolumeRecord = Volume.extend({
  id: zEntityId,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type VolumeRecord = z.infer<typeof VolumeRecord>

// ---------------------------------------------------------------- Chapter

export const ChapterInput = z.object({
  volumeId: zEntityId,
  number: z.number().int().min(1).max(10_000),
  title: z.string().min(1, 'Chapter title is required').max(160),
  synopsis: z.string().max(8_000).optional(),
  status: zTaskStatus.optional(),
  pov: PovSettingInput.optional(),
})
export type ChapterInput = z.input<typeof ChapterInput>

export const Chapter = ChapterInput.extend({
  status: zTaskStatus.default('TODO'),
  pov: PovSetting.default({ povType: 'THIRD_PERSON_LIMITED' }),
})

export const ChapterRecord = Chapter.extend({
  id: zEntityId,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type ChapterRecord = z.infer<typeof ChapterRecord>

// --------------------------------------------------------------- scene POV patch

export const ScenePovPatch = z.object({
  povType: zPovType.optional(),
  povCharacterId: zEntityId.optional(),
})
export type ScenePovPatch = z.input<typeof ScenePovPatch>
