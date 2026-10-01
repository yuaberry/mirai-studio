/**
 * Timeline & editing entities (Phase 5) — tracks, clips, markers, keyframes.
 *
 * The timeline is per-scene: a scene's shots become VIDEO/VOICE clips and
 * its assigned media becomes MUSIC/SFX/AMBIENCE clips. Keyframes drive the
 * camera (per shot), clip volume automation and track mixer automation.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

// ---------------------------------------------------------------- kinds

export const TRACK_KINDS = ['VIDEO', 'VOICE', 'MUSIC', 'SFX', 'AMBIENCE'] as const
export type TrackKind = (typeof TRACK_KINDS)[number]
export const zTrackKind = z.enum(TRACK_KINDS)

export const TRACK_KIND_LABEL: Record<TrackKind, string> = {
  VIDEO: 'Video',
  VOICE: 'Voice',
  MUSIC: 'Music',
  SFX: 'Sound FX',
  AMBIENCE: 'Ambience',
}

/** Audio-capable track kinds (VIDEO tracks hold images, not audio). */
export const AUDIO_TRACK_KINDS: readonly TrackKind[] = ['VOICE', 'MUSIC', 'SFX', 'AMBIENCE']

export const CLIP_SOURCE_TYPES = ['SHOT', 'MEDIA'] as const
export type ClipSourceType = (typeof CLIP_SOURCE_TYPES)[number]
export const zClipSourceType = z.enum(CLIP_SOURCE_TYPES)

/** CSS mix-blend modes used by the preview compositor. */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'color-dodge',
  'difference',
] as const
export type BlendMode = (typeof BLEND_MODES)[number]
export const zBlendMode = z.enum(BLEND_MODES)

// ---------------------------------------------------------------- tracks

export const TimelineTrack = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  kind: zTrackKind,
  name: z.string().min(1).max(120),
  orderIndex: z.number().int().min(0),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  /** 0 = silent, 1 = unity, 1.5 = +3.5 dB headroom. */
  volume: z.number().min(0).max(1.5).default(1),
  pan: z.number().min(-1).max(1).default(0),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type TimelineTrack = z.infer<typeof TimelineTrack>

export const TrackInput = z.object({
  sceneId: zEntityId,
  kind: zTrackKind,
  name: z.string().min(1).max(120).optional(),
})
export type TrackInput = z.infer<typeof TrackInput>

export const TrackPatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    muted: z.boolean().optional(),
    solo: z.boolean().optional(),
    volume: z.number().min(0).max(1.5).optional(),
    pan: z.number().min(-1).max(1).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Patch is empty.' })
export type TrackPatch = z.infer<typeof TrackPatch>

// ---------------------------------------------------------------- clips

/** Per-clip visual effects — real in preview, 1:1 mappable to FFmpeg filters. */
export const ClipEffects = z
  .object({
    /** 1 = neutral (FFmpeg eq brightness). */
    brightness: z.number().min(0).max(3).default(1),
    contrast: z.number().min(0).max(3).default(1),
    saturate: z.number().min(0).max(3).default(1),
    /** Degrees (FFmpeg hue=h). */
    hue: z.number().min(-180).max(180).default(0),
    /** Pixels (FFmpeg gblur). */
    blur: z.number().min(0).max(20).default(0),
    grayscale: z.number().min(0).max(1).default(0),
    /** Radial darkening overlay (lighting mood). */
    vignette: z.number().min(0).max(1).default(0),
  })
  .default({})
export type ClipEffects = z.infer<typeof ClipEffects>
export const DEFAULT_CLIP_EFFECTS: ClipEffects = ClipEffects.parse({})

export const TimelineClip = z.object({
  id: zEntityId,
  trackId: zEntityId,
  sourceType: zClipSourceType,
  /** Shot id or media-track id. */
  sourceId: zEntityId,
  label: z.string().min(1).max(200),
  /** Absolute position on the timeline (seconds). */
  startSec: z.number().min(0),
  durationSec: z.number().min(0.05),
  /** Source trim start — where in the source the clip begins. */
  inOffsetSec: z.number().min(0).default(0),
  volume: z.number().min(0).max(2).default(1),
  opacity: z.number().min(0).max(1).default(1),
  blend: zBlendMode.default('normal'),
  effects: ClipEffects,
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type TimelineClip = z.infer<typeof TimelineClip>

export const ClipCreateInput = z.object({
  trackId: zEntityId,
  sourceType: zClipSourceType,
  sourceId: zEntityId,
  startSec: z.number().min(0),
  durationSec: z.number().min(0.05),
  inOffsetSec: z.number().min(0).default(0),
  label: z.string().min(1).max(200).optional(),
})
export type ClipCreateInput = z.infer<typeof ClipCreateInput>

export const ClipPatch = z
  .object({
    label: z.string().min(1).max(200).optional(),
    startSec: z.number().min(0).optional(),
    durationSec: z.number().min(0.05).optional(),
    inOffsetSec: z.number().min(0).optional(),
    volume: z.number().min(0).max(2).optional(),
    opacity: z.number().min(0).max(1).optional(),
    blend: zBlendMode.optional(),
    effects: ClipEffects.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Patch is empty.' })
export type ClipPatch = z.infer<typeof ClipPatch>

export const ClipMoveInput = z.object({
  id: zEntityId,
  /** Moving across tracks is optional; when omitted the clip stays. */
  toTrackId: zEntityId.optional(),
  startSec: z.number().min(0),
})

// ---------------------------------------------------------------- markers

export const TimelineMarker = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  atSec: z.number().min(0),
  label: z.string().min(1).max(200),
  createdAt: zIsoDate,
})
export type TimelineMarker = z.infer<typeof TimelineMarker>

// ---------------------------------------------------------------- keyframes

export const KEYFRAME_TARGETS = ['CAMERA', 'CLIP', 'MIXER'] as const
export type KeyframeTarget = (typeof KEYFRAME_TARGETS)[number]
export const zKeyframeTarget = z.enum(KEYFRAME_TARGETS)

export const KEYFRAME_EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier'] as const
export type KeyframeEasing = (typeof KEYFRAME_EASINGS)[number]
export const zKeyframeEasing = z.enum(KEYFRAME_EASINGS)

export const EASING_LABEL: Record<KeyframeEasing, string> = {
  linear: 'Linear',
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  easeInOut: 'Ease In Out',
  bezier: 'Bézier',
}

/** Cubic-bézier control points [x1, y1, x2, y2] — CSS timing function style. */
export const zBezier = z.tuple([z.number().min(0).max(1), z.number().min(-1).max(2), z.number().min(0).max(1), z.number().min(-1).max(2)])
export const DEFAULT_BEZIER: readonly [number, number, number, number] = [0.42, 0, 0.58, 1]

export const KeyframeRecord = z.object({
  id: zEntityId,
  targetType: zKeyframeTarget,
  /** Shot id (CAMERA), clip id (CLIP) or track id (MIXER). */
  targetId: zEntityId,
  param: z.string().min(1).max(40),
  /** Seconds — clip-local for CAMERA/CLIP, timeline-absolute for MIXER. */
  atSec: z.number().min(0),
  value: z.number(),
  easing: zKeyframeEasing.default('linear'),
  bezier: zBezier.nullable().default(null),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type KeyframeRecord = z.infer<typeof KeyframeRecord>

export const KeyframeInput = z.object({
  targetType: zKeyframeTarget,
  targetId: zEntityId,
  param: z.string().min(1).max(40),
  atSec: z.number().min(0),
  value: z.number(),
  easing: zKeyframeEasing.default('linear'),
  bezier: zBezier.nullable().optional(),
})
export type KeyframeInput = z.infer<typeof KeyframeInput>

// ---------------------------------------------------------------- camera

export const CAMERA_PARAMS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const
export type CameraParam = (typeof CAMERA_PARAMS)[number]
export const zCameraParam = z.enum(CAMERA_PARAMS)

/** Camera parameter ranges for editor UIs. x/y are % of frame, scale ×, rotation degrees. */
export const CAMERA_PARAM_RANGE: Record<CameraParam, readonly [number, number]> = {
  x: [-50, 50],
  y: [-50, 50],
  scale: [0.2, 4],
  rotation: [-180, 180],
  opacity: [0, 1],
}

export const CAMERA_PARAM_LABEL: Record<CameraParam, string> = {
  x: 'Position X',
  y: 'Position Y',
  scale: 'Zoom / Scale',
  rotation: 'Rotation',
  opacity: 'Opacity',
}

export type CameraState = Record<CameraParam, number>

export const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }

// ---------------------------------------------------------------- sampling

/**
 * 1-D cubic bezier from 0 → 1 with control offsets a (P1) and b (P2):
 * B(t) = 3(1-t)²t·a + 3(1-t)t²·b + t³
 */
function bezierAxis(a: number, b: number, t: number): number {
  const u = 1 - t
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
}

/** Solve the time t at which the bezier's X equals `x` (Newton + bisection). */
function solveBezierX(x1: number, x2: number, x: number): number {
  let t = x
  for (let i = 0; i < 8; i++) {
    const err = bezierAxis(x1, x2, t) - x
    if (Math.abs(err) < 1e-6) return t
    const d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 24; i++) {
    const cur = bezierAxis(x1, x2, t)
    if (Math.abs(cur - x) < 1e-6) return t
    if (cur > x) hi = t
    else lo = t
    t = (lo + hi) / 2
  }
  return t
}

/** Normalize raw progress [0,1] through an easing curve. */
export function easeProgress(
  t: number,
  easing: KeyframeEasing,
  bezier: readonly number[] | null = null,
): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  switch (easing) {
    case 'linear':
      return t
    case 'easeIn':
      return t * t
    case 'easeOut':
      return 1 - (1 - t) * (1 - t)
    case 'easeInOut':
      return t * t * (3 - 2 * t)
    case 'bezier': {
      const b = bezier !== null && bezier.length === 4 ? bezier : DEFAULT_BEZIER
      const bx1 = b[0]!
      const by1 = b[1]!
      const bx2 = b[2]!
      const by2 = b[3]!
      const bt = solveBezierX(bx1, bx2, t)
      return bezierAxis(by1, by2, bt)
    }
  }
}

/**
 * Sample an interpolated value from a sorted keyframe list at `atSec`.
 * Returns null when there are no keyframes for the curve.
 */
export function sampleCurve(
  keyframes: ReadonlyArray<{
    atSec: number
    value: number
    easing: KeyframeEasing
    bezier?: readonly number[] | null
  }>,
  atSec: number,
): number | null {
  if (keyframes.length === 0) return null
  if (keyframes.length === 1) return keyframes[0]!.value
  if (atSec <= keyframes[0]!.atSec) return keyframes[0]!.value
  const last = keyframes[keyframes.length - 1]!
  if (atSec >= last.atSec) return last.value
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!
    const b = keyframes[i + 1]!
    if (atSec >= a.atSec && atSec <= b.atSec) {
      const span = b.atSec - a.atSec
      const raw = span <= 0 ? 1 : (atSec - a.atSec) / span
      const t = easeProgress(raw, a.easing, a.bezier ?? null)
      return a.value + (b.value - a.value) * t
    }
  }
  return last.value
}

/** Sample a full camera state at clip-local time `atSec`. Missing curves fall back to defaults. */
export function sampleCamera(
  byParam: ReadonlyMap<string, ReadonlyArray<{ atSec: number; value: number; easing: KeyframeEasing; bezier?: readonly number[] | null }>>,
  atSec: number,
): CameraState {
  const state: CameraState = { ...DEFAULT_CAMERA }
  for (const param of CAMERA_PARAMS) {
    const curve = byParam.get(param)
    if (curve) {
      const v = sampleCurve(curve, atSec)
      if (v !== null) state[param] = v
    }
  }
  return state
}

// ---------------------------------------------------------------- bundle

/** Resolved source for a clip — everything the renderer needs, no extra queries. */
export const ClipSource = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SHOT'),
    shotId: zEntityId,
    title: z.string(),
    frameAssetId: zEntityId.nullable(),
    audioAssetId: zEntityId.nullable(),
    durationSec: z.number(),
    shotType: z.string(),
    cameraMovement: z.string(),
    dialogue: z.string().nullable(),
  }),
  z.object({
    type: z.literal('MEDIA'),
    mediaId: zEntityId,
    assetId: zEntityId,
    title: z.string(),
    mediaKind: z.string(),
  }),
])
export type ClipSource = z.infer<typeof ClipSource>

export const TimelineBundle = z.object({
  sceneId: zEntityId,
  /** End of the last clip — the playable span. */
  durationSec: z.number().min(0),
  tracks: z.array(TimelineTrack),
  clips: z.array(TimelineClip),
  markers: z.array(TimelineMarker),
  sources: z.record(zEntityId, ClipSource),
})
export type TimelineBundle = z.infer<typeof TimelineBundle>

/** Format seconds as `M:SS.d` (timeline transport + ruler). */
export function formatTimelineTime(sec: number): string {
  const safe = Math.max(0, sec)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  const d = Math.floor((safe - Math.floor(safe)) * 10)
  return `${m}:${String(s).padStart(2, '0')}.${d}`
}
