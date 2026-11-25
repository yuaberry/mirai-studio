/**
 * cameraMotion (v2.1) — a REAL camera move on a STILL frame, for free.
 *
 * WHY THIS EXISTS
 * ---------------
 * The long-episode video problem is PHYSICS, not configuration: an anime
 * episode needs one motion clip per shot (≈160 per episode), every free
 * vendor model of video is paid-only, and the user's machine has no GPU.
 * What it DOES have is FFmpeg — and the animatic stage of every real anime
 * studio, where a still keyframe acquires a camera move before it is ever
 * animated.
 *
 * This module turns each storyboard frame into a REAL motion clip —
 * push-in, pan, tilt, diagonal drift, subtle handheld — through `zoompan`
 * alone: no provider, no key, no GPU, deterministic, offline. One clip per
 * SHOT replaces the 2–4 model generations the shot would otherwise need,
 * and the same clip is the reference an image-to-video provider animates
 * when the user does have a key.
 *
 * The module is PURE (no fs, no spawn): it returns the FFmpeg arguments,
 * which the render service executes and the tests assert on. That is how
 * the whole render stack in this codebase stays verifiable.
 */
import type { ExportPreset, RenderQuality } from '@mirai/shared'

/**
 * The camera moves the studio offers. `locked` is honest about doing
 * NOTHING (a static frame), which is itself a cinematic choice.
 */
export const CAMERA_MOTION_PRESETS = [
  'locked',
  'pushIn',
  'pushOut',
  'panLeft',
  'panRight',
  'tiltUp',
  'tiltDown',
  'drift',
  'handheld',
] as const

export type CameraMotionPreset = (typeof CAMERA_MOTION_PRESETS)[number]

export const CAMERA_MOTION_LABELS: Record<CameraMotionPreset, string> = {
  locked: 'Locked — static frame',
  pushIn: 'Push in — slow dolly toward the subject',
  pushOut: 'Pull back — reveal the scene',
  panLeft: 'Pan left',
  panRight: 'Pan right',
  tiltUp: 'Tilt up',
  tiltDown: 'Tilt down',
  drift: 'Drift — diagonal parallax',
  handheld: 'Handheld — subtle organic wobble',
}

export interface CameraMotionSpec {
  preset: CameraMotionPreset
  /** Clip length in seconds — the shot's own duration. */
  durationSec: number
  fps: number
  width: number
  height: number
  /** Motion amplitude, 0–1 (1 = the preset's full move). */
  amount?: number
}

export interface EncodeTier {
  preset: string
  crf: string
  premium: boolean
}

/** The encoder tier — the same convention the scene renderer uses. */
export function encodeTier(quality: RenderQuality): EncodeTier {
  if (quality === 'CINEMA') return { preset: 'slower', crf: '14', premium: true }
  if (quality === 'MASTER') return { preset: 'slow', crf: '16', premium: false }
  return { preset: 'ultrafast', crf: '30', premium: false }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Output frame count — every expression below is driven by `on` over this. */
export function frameCount(spec: CameraMotionSpec): number {
  return Math.max(1, Math.round(spec.durationSec * spec.fps))
}

/**
 * yuv420p — the pixel format every delivery player expects — needs EVEN
 * dimensions, and AI frames arrive at odd sizes (a 1015×580 Pollinations
 * image, say). The camera move does not decide the canvas: rounding DOWN to
 * even is the smallest honest change that keeps the encode legal.
 */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, Math.floor(width / 2) * 2), height: Math.max(2, Math.floor(height / 2) * 2) }
}

/**
 * The `zoompan` expression for a preset, or null for `locked` (no filter).
 * zoompan crops the image at `zoom` and places the window at (x, y); `on`
 * is the OUTPUT frame number, so every move is time-driven and smooth.
 */
export function zoompanExpression(spec: CameraMotionSpec): string | null {
  const frames = frameCount(spec)
  const even = evenSize(spec.width, spec.height)
  const amount = clamp(spec.amount ?? 1, 0, 1)
  // The headroom a pan/tilt needs to move inside without exposing edges.
  const zoomMax = round6(1 + 0.22 * amount)
  const travel = (dimension: string) =>
    `(${dimension}-${dimension}/zoom)`
  const progress = `on/${frames}`

  switch (spec.preset) {
    case 'locked':
      return null
    case 'pushIn':
      return (
        `zoompan=z='min(1+(${zoomMax}-1)*${progress},${zoomMax})'` +
        `:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'pushOut':
      return (
        `zoompan=z='max(${zoomMax}-(${zoomMax}-1)*${progress},1)'` +
        `:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'panRight':
      return (
        `zoompan=z='${zoomMax}'` +
        `:x='${travel('iw')}*${progress}':y='(ih-ih/zoom)/2'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'panLeft':
      return (
        `zoompan=z='${zoomMax}'` +
        `:x='${travel('iw')}*(1-${progress})':y='(ih-ih/zoom)/2'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'tiltUp':
      return (
        `zoompan=z='${zoomMax}'` +
        `:x='(iw-iw/zoom)/2':y='${travel('ih')}*(1-${progress})'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'tiltDown':
      return (
        `zoompan=z='${zoomMax}'` +
        `:x='(iw-iw/zoom)/2':y='${travel('ih')}*${progress}'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'drift':
      return (
        `zoompan=z='${zoomMax}'` +
        `:x='${travel('iw')}*${progress}':y='${travel('ih')}*(1-${progress})'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    case 'handheld': {
      // A slow two-frequency wobble on a zoomed crop: small enough to read as
      // a human holding the camera, not as a glitch.
      const wobbleX = round6(6 * amount)
      const wobbleY = round6(4 * amount)
      return (
        `zoompan=z='${zoomMax}'` +
        `:x='(iw-iw/zoom)/2+${wobbleX}*sin(on/7)+${wobbleX / 2}*sin(on/23)'` +
        `:y='(ih-ih/zoom)/2+${wobbleY}*cos(on/5)+${wobbleY / 2}*cos(on/17)'` +
        `:d=1:s=${even.width}x${even.height}:fps=${spec.fps}`
      )
    }
  }
}

/**
 * The FFmpeg arguments for one camera-move clip (executable excluded).
 * A still is looped for the clip's duration and either zoompan-moved or
 * simply scaled (`locked`).
 */
export function cameraMoveArgs(
  imagePath: string,
  outputPath: string,
  spec: CameraMotionSpec,
  quality: RenderQuality,
  preset: ExportPreset,
): string[] {
  const tier = encodeTier(quality)
  const even = evenSize(spec.width, spec.height)
  const args: string[] = [
    '-loop', '1',
    '-t', spec.durationSec.toFixed(3),
    '-i', imagePath,
    '-an',
  ]
  const zoom = zoompanExpression(spec)
  if (zoom) {
    // The source is scaled up BEFORE zoompan so the crop window always has
    // pixels to travel through (zoompan crops, it does not upscale edges).
    args.push(
      '-vf',
      `scale=${spec.width * 2}:${spec.height * 2}:force_original_aspect_ratio=increase:flags=lanczos,${zoom}`,
    )
  } else {
    args.push('-vf', `scale=${even.width}:${even.height}:force_original_aspect_ratio=decrease,pad=${even.width}:${even.height}:(ow-iw)/2:(oh-ih)/2`)
  }
  args.push(
    '-c:v', 'libx264',
    '-tune', 'animation',
    '-preset', tier.preset,
    '-crf', tier.crf,
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-r', String(spec.fps),
    '-t', spec.durationSec.toFixed(3),
    '-movflags', '+faststart',
    '-y', outputPath,
  )
  void preset
  return args
}

/**
 * The shot's OWN camera movement — the field the user already fills for the
 * AI prompts — mapped onto the moves this engine can render. One source of
 * truth: setting "PAN" on the shot and pressing the free camera button
 * executes exactly that pan.
 */
const FROM_SHOT_MOVEMENT: Record<string, CameraMotionPreset> = {
  STATIC: 'locked',
  PAN: 'panRight',
  TILT: 'tiltUp',
  DOLLY_IN: 'pushIn',
  DOLLY_OUT: 'pushOut',
  TRACKING: 'drift',
  CRANE: 'drift',
  HANDHELD: 'handheld',
  ZOOM_IN: 'pushIn',
  ZOOM_OUT: 'pushOut',
}

/**
 * A deterministic, hand-free choice per shot: the SHOT's own metadata
 * decides the move (a wide establishing shot panning, a close-up pushing
 * in). The user can always override on the shot.
 */
export function suggestMotion(shot: {
  shotType?: string | null
  durationSec?: number | null
  /** The storyboard's camera movement (STATIC/PAN/TILT/DOLLY_IN…). */
  cameraMovement?: string | null
  /** A camera-motion preset name, when the caller already speaks this dialect. */
  cameraMotionPreset?: string | null
}): CameraMotionPreset {
  const declaredPreset = (shot.cameraMotionPreset ?? '').trim()
  if ((CAMERA_MOTION_PRESETS as readonly string[]).includes(declaredPreset)) {
    return declaredPreset as CameraMotionPreset
  }
  const declared = (shot.cameraMovement ?? '').trim().toUpperCase()
  const mapped = FROM_SHOT_MOVEMENT[declared]
  if (mapped) return mapped
  const type = (shot.shotType ?? '').toLowerCase()
  if (type.includes('establishing') || type.includes('wide')) return 'panRight'
  if (type.includes('close')) return 'pushIn'
  if (type.includes('insert') || type.includes('detail')) return 'pushIn'
  if (type.includes('two')) return 'locked'
  if ((shot.durationSec ?? 0) >= 6) return 'drift'
  return 'pushIn'
}