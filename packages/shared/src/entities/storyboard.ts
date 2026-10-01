/**
 * Storyboard entities (Phase 3): shots with professional camera metadata,
 * the visual Style Bible, and the asset registry that backs imported frames.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { zTaskStatus } from '../status'

// ------------------------------------------------------------------- shots

/** Camera framing types (spec Module 17). */
export const SHOT_TYPES = [
  'EXTREME_CLOSE_UP',
  'CLOSE_UP',
  'MEDIUM',
  'WIDE',
  'EXTREME_WIDE',
  'OVER_THE_SHOULDER',
  'POV',
  'TWO_SHOT',
  'AERIAL',
  'MACRO',
] as const
export type ShotType = (typeof SHOT_TYPES)[number]
export const zShotType = z.enum(SHOT_TYPES)

/** Camera movement. */
export const CAMERA_MOVEMENTS = [
  'STATIC',
  'PAN',
  'TILT',
  'DOLLY_IN',
  'DOLLY_OUT',
  'TRACKING',
  'CRANE',
  'HANDHELD',
  'ZOOM_IN',
  'ZOOM_OUT',
] as const
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number]
export const zCameraMovement = z.enum(CAMERA_MOVEMENTS)

/** Common lens presets (full-frame equivalents). */
export const LENS_PRESETS = ['14mm', '24mm', '35mm', '50mm', '85mm', '135mm'] as const
export type LensPreset = (typeof LENS_PRESETS)[number]
export const zLensPreset = z.enum(LENS_PRESETS)

export const SHOT_TYPE_LABEL: Record<ShotType, string> = {
  EXTREME_CLOSE_UP: 'Extreme Close-Up',
  CLOSE_UP: 'Close-Up',
  MEDIUM: 'Medium Shot',
  WIDE: 'Wide Shot',
  EXTREME_WIDE: 'Extreme Wide (Establishing)',
  OVER_THE_SHOULDER: 'Over-the-Shoulder',
  POV: 'POV',
  TWO_SHOT: 'Two-Shot',
  AERIAL: 'Aerial',
  MACRO: 'Macro',
}

export const CAMERA_MOVEMENT_LABEL: Record<CameraMovement, string> = {
  STATIC: 'Static',
  PAN: 'Pan',
  TILT: 'Tilt',
  DOLLY_IN: 'Dolly In',
  DOLLY_OUT: 'Dolly Out',
  TRACKING: 'Tracking',
  CRANE: 'Crane',
  HANDHELD: 'Handheld',
  ZOOM_IN: 'Zoom In',
  ZOOM_OUT: 'Zoom Out',
}

export const ShotInput = z.object({
  title: z.string().min(1, 'Title is required').max(160),
  shotType: zShotType.default('MEDIUM'),
  lens: zLensPreset.default('50mm'),
  cameraMovement: zCameraMovement.default('STATIC'),
  /** Planned duration in seconds (24/30fps planning). */
  durationSeconds: z.number().min(0.1).max(600).default(3),
  dialogue: z.string().max(8_000).optional(),
  notes: z.string().max(8_000).optional(),
  status: zTaskStatus.optional(),
})
export type ShotInput = z.input<typeof ShotInput>

export const ShotRecord = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  orderIndex: z.number().int().min(0),
  title: z.string().min(1).max(160),
  shotType: zShotType,
  lens: zLensPreset,
  cameraMovement: zCameraMovement,
  durationSeconds: z.number().min(0.1).max(600),
  dialogue: z.string().max(8_000).optional(),
  notes: z.string().max(8_000).optional(),
  /** Imported frame image, served via the mirai-asset:// protocol. */
  frameAssetId: zEntityId.nullable(),
  /** Voice line audio attached to this shot (Phase 4). */
  voiceAssetId: zEntityId.nullable(),
  /** Generated video attached to this shot (Phase 4 wrap-up). */
  videoAssetId: zEntityId.nullable(),
  status: zTaskStatus,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type ShotRecord = z.infer<typeof ShotRecord>

// -------------------------------------------------------------- style bible

/**
 * Visual Style Bible (Module 23) — the project's visual identity that
 * image/video generation (and the team) must honor.
 */
export const StyleBible = z.object({
  artDirection: z.string().max(6_000).optional(),
  lineart: z.string().max(4_000).optional(),
  shading: z.string().max(4_000).optional(),
  palette: z.string().max(4_000).optional(),
  lighting: z.string().max(4_000).optional(),
  proportions: z.string().max(4_000).optional(),
  eyesAndHair: z.string().max(4_000).optional(),
  backgrounds: z.string().max(4_000).optional(),
  cameraLanguage: z.string().max(4_000).optional(),
})
export type StyleBible = z.infer<typeof StyleBible>

// ------------------------------------------------------------------- assets

export const ASSET_KINDS = ['IMAGE', 'AUDIO', 'VIDEO'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const

export const AssetRecord = z.object({
  id: zEntityId,
  kind: z.enum(ASSET_KINDS),
  /** Path relative to the project root (portability — never absolute). */
  relativePath: z.string().min(1),
  originalName: z.string().min(1).max(200),
  mime: z.string().min(3).max(100),
  bytes: z.number().int().min(0),
  createdAt: zIsoDate,
})
export type AssetRecord = z.infer<typeof AssetRecord>
