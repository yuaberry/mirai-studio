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

/** A generated video result from the video-gen provider. */
export const VideoGenResult = z.object({
  bytes: z.instanceof(Uint8Array),
  mimeType: z.string(),
  seconds: z.number(),
  format: z.string(),
})
export type VideoGenResult = z.infer<typeof VideoGenResult>

/** Structured AI analysis of a scene's screenplay (Phase 8). */
export const ScreenplayAnalysis = z.object({
  pacingScore: z.number().min(0).max(10),
  dialogueQuality: z.number().min(0).max(10),
  strengths: z.array(z.string().max(500)).max(10),
  issues: z.array(z.string().max(500)).max(10),
  suggestions: z.array(z.string().max(500)).max(10),
  repetitionFlags: z.array(z.string().max(300)).max(10),
  voiceNotes: z.array(z.string().max(500)).max(10),
})
export type ScreenplayAnalysis = z.infer<typeof ScreenplayAnalysis>

/** AI Director notes for a scene (Phase 8). */
export const DirectorNotes = z.object({
  narrative: z.array(z.string().max(500)).max(10),
  composition: z.array(z.string().max(500)).max(10),
  rhythm: z.array(z.string().max(500)).max(10),
  emotion: z.array(z.string().max(500)).max(10),
  camera: z.array(z.string().max(500)).max(10),
  perShot: z.array(z.object({ shotTitle: z.string().max(200), suggestion: z.string().max(500) })).max(40),
})
export type DirectorNotes = z.infer<typeof DirectorNotes>

/** A continuity finding (Phase 8). */
export const ContinuityFinding = z.object({
  severity: z.enum(['ERROR', 'WARNING', 'INFO']),
  title: z.string().max(300),
  detail: z.string().max(1_000),
})
export type ContinuityFinding = z.infer<typeof ContinuityFinding>

/** The full orchestrated production review of one scene (Phase 8). */
export const ProductionReview = z.object({
  sceneTitle: z.string().max(300),
  analysis: ScreenplayAnalysis,
  director: DirectorNotes,
  continuity: z.array(ContinuityFinding).max(30),
})
export type ProductionReview = z.infer<typeof ProductionReview>
