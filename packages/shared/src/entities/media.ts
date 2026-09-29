/**
 * Media entities (Phase 4): Music/SFX/Ambience library + render jobs.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

export const MEDIA_KINDS = ['MUSIC', 'SFX', 'AMBIENCE'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]
export const zMediaKind = z.enum(MEDIA_KINDS)

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  MUSIC: 'Music',
  SFX: 'Sound Effect',
  AMBIENCE: 'Ambience',
}

export const MEDIA_ROLES = ['OPENING', 'ENDING', 'BACKGROUND', 'INSERT', 'BATTLE', 'ROMANCE', 'TENSION'] as const
export type MediaRole = (typeof MEDIA_ROLES)[number]
export const zMediaRole = z.enum(MEDIA_ROLES)

export const MEDIA_ROLE_LABEL: Record<MediaRole, string> = {
  OPENING: 'Opening',
  ENDING: 'Ending',
  BACKGROUND: 'Background',
  INSERT: 'Insert Song',
  BATTLE: 'Battle',
  ROMANCE: 'Romance',
  TENSION: 'Tension',
}

/** A track in the project's media library. */
export const MediaTrack = z.object({
  id: zEntityId,
  kind: zMediaKind,
  title: z.string().min(1).max(200),
  assetId: zEntityId,
  tags: z.string().max(200).optional(),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type MediaTrack = z.infer<typeof MediaTrack>

/** A media track assigned to a scene with a role + volume. */
export const SceneMedia = z.object({
  sceneId: zEntityId,
  mediaId: zEntityId,
  role: zMediaRole,
  volume: z.number().min(0).max(2).default(1),
})
export type SceneMedia = z.infer<typeof SceneMedia>

/** Render result: the produced file info. */
export const RenderResult = z.object({
  shotId: zEntityId,
  outputPath: z.string(),
  durationSeconds: z.number(),
  fileBytes: z.number().int(),
  hasAudio: z.boolean(),
  hasVideo: z.boolean(),
  format: z.string(),
  codec: z.string(),
  resolution: z.string(),
})
export type RenderResult = z.infer<typeof RenderResult>

/** Video generation provider info (Phase 4 — user-configured endpoints). */
export const VIDEO_GEN_STYLES = [
  'ANIME_KEYFRAME',
  'MANGA_PANEL',
  'CINEMATIC',
  'SOFT_FOCUS',
  'DYNAMIC_ACTION',
] as const
export type VideoGenStyle = (typeof VIDEO_GEN_STYLES)[number]
export const zVideoGenStyle = z.enum(VIDEO_GEN_STYLES)
