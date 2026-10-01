/**
 * sceneRenderBuilder (Phase 6) — pure translation of a scene timeline into a
 * REAL FFmpeg command. Everything the editor built gets baked into the graph:
 *
 *   VIDEO: per-clip filters — effects chain (eq/hue/gblur/vignette, 1:1 with
 *   the preview), camera moves via zoompan (zoom/x/y piecewise expressions
 *   sampled from the keyframe curves incl. bézier easing) and rotation via
 *   rotate, then per-track concat and multi-track overlay compositing with
 *   constant opacity.
 *
 *   AUDIO: per-clip atrim (in-point) → volume expression (clip volume ×
 *   CLIP automation × track volume × MIXER automation, piecewise baked with
 *   real easing) → pan matrix → adelay (timeline placement) → amix (normalize=0)
 *   → exact total duration. Muted / solo-excluded tracks are dropped.
 *
 * The builder is PURE (no fs, no spawn) so it is fully unit-testable.
 */
import {
  DEFAULT_CAMERA,
  sampleCamera,
  sampleCurve,
  type CameraParam,
  type ExportPreset,
  type KeyframeRecord,
  type RenderQuality,
  type TimelineBundle,
  type TimelineClip,
  type TimelineTrack,
} from '@mirai/shared'

export interface SceneRenderSpec {
  /** FFmpeg args EXCLUDING the executable (inputs, filter_complex, codec, output). */
  args: string[]
  totalSec: number
  /** How many frames each zoompan segment uses — for progress math. */
  videoClipCount: number
  audioClipCount: number
}

export interface BuilderOptions {
  preset: ExportPreset
  quality: RenderQuality
}

/** Camera curves per shot, pre-fetched by the caller. */
export type CameraCurves = Map<string, Map<string, KeyframeRecord[]>>
/** Automation curves: `${target}:${id}` → keyframe list. */
export type AutomationCurves = Map<string, KeyframeRecord[]>

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const round3 = (v: number) => Math.round(v * 1000) / 1000

// --------------------------------------------------------------------------
// Camera: bake a sampled param curve into a piecewise expression on `on`
// (zoompan's output-frame variable). Sub-sampling approximates eased/bézier
// segments densely enough to be visually identical.
// --------------------------------------------------------------------------

const CAMERA_SUBSAMPLES = 6
const MAX_CAMERA_POINTS = 48

function bakedCameraPoints(
  clip: TimelineClip,
  curves: CameraCurves,
): Map<CameraParam, Array<{ atSec: number; value: number }>> {
  const byParam = curves.get(clip.sourceId)
  const out = new Map<CameraParam, Array<{ atSec: number; value: number }>>()
  if (!byParam) return out
  for (const [param, kfs] of byParam) {
    if (kfs.length === 0) continue
    const sorted = [...kfs].sort((a, b) => a.atSec - b.atSec)
    const times = new Set<number>()
    for (let i = 0; i < sorted.length; i++) {
      times.add(clamp(sorted[i]!.atSec, 0, clip.durationSec))
      const next = sorted[i + 1]
      if (next && next.atSec > sorted[i]!.atSec) {
        const span = next.atSec - sorted[i]!.atSec
        for (let s = 1; s < CAMERA_SUBSAMPLES; s++) {
          times.add(clamp(sorted[i]!.atSec + (span * s) / CAMERA_SUBSAMPLES, 0, clip.durationSec))
        }
      }
    }
    times.add(clip.durationSec)
    // Cap point count (linearize by thinning) so expressions stay sane.
    let list = [...times].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1]! > 1e-6)
    if (list.length > MAX_CAMERA_POINTS) {
      const step = Math.ceil(list.length / MAX_CAMERA_POINTS)
      list = list.filter((_, i) => i % step === 0)
      if (list[list.length - 1] !== clip.durationSec) list.push(clip.durationSec)
    }
    const stateAt = (t: number) => {
      const camera = sampleCamera(byParam, t)
      return camera[param as CameraParam]
    }
    out.set(param as CameraParam, list.map((t) => ({ atSec: t, value: stateAt(t) })))
  }
  return out
}

/** Piecewise-linear expression over `varName` (e.g. `on` or `t`). */
function piecewiseExpr(
  varName: string,
  varToFps: number | null,
  points: Array<{ atSec: number; value: number }>,
  neutral: number,
): string | null {
  if (points.length === 0) return null
  const values = points.map((p) => p.value)
  if (values.every((v) => Math.abs(v - neutral) < 1e-6)) return null
  const toVar = (sec: number) =>
    varToFps === null ? `${round3(sec)}` : `(${round3(sec)}*${varToFps})`
  // Build nested ifs from the last segment backwards.
  let expr = `${round3(values[values.length - 1]!)}`
  for (let i = values.length - 2; i >= 0; i--) {
    expr = `if(lt(${varName},${toVar(points[i + 1]!.atSec)}),${round3(values[i]!)},${expr})`
  }
  return expr
}

// --------------------------------------------------------------------------
// Volume automation: bake clip×track gain into a piecewise `t` expression.
// --------------------------------------------------------------------------

const VOLUME_SUBSAMPLES = 8
const MAX_VOLUME_POINTS = 64

function bakedVolumeExpr(clip: TimelineClip, track: TimelineTrack, automation: AutomationCurves): string | null {
  const clipAuto = (automation.get(`CLIP:${clip.id}`) ?? []).filter((k) => k.param === 'volume')
  const mixerAuto = (automation.get(`MIXER:${track.id}`) ?? []).filter((k) => k.param === 'volume')
  if (clipAuto.length === 0 && mixerAuto.length === 0) return null

  const boundaries = new Set<number>([0, clip.durationSec])
  for (const k of clipAuto) boundaries.add(clamp(k.atSec, 0, clip.durationSec))
  for (const k of mixerAuto) boundaries.add(clamp(k.atSec - clip.startSec, 0, clip.durationSec))

  let times = [...boundaries].sort((a, b) => a - b)
  const dense = new Set<number>()
  for (let i = 0; i < times.length - 1; i++) {
    dense.add(times[i]!)
    const span = times[i + 1]! - times[i]!
    for (let s = 1; s < VOLUME_SUBSAMPLES; s++) dense.add(times[i]! + (span * s) / VOLUME_SUBSAMPLES)
  }
  dense.add(clip.durationSec)
  times = [...dense].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1]! > 1e-6)
  if (times.length > MAX_VOLUME_POINTS) {
    const step = Math.ceil(times.length / MAX_VOLUME_POINTS)
    const thinned = times.filter((_, i) => i % step === 0)
    if (thinned[thinned.length - 1] !== clip.durationSec) thinned.push(clip.durationSec)
    times = thinned
  }

  const base = clip.volume * track.volume
  const values = times.map((t) => {
    const clipV = sampleCurve(clipAuto, t)
    const mixV = sampleCurve(mixerAuto, clip.startSec + t)
    return clamp(base * (clipV ?? 1) * (mixV ?? 1), 0, 4)
  })
  let expr = `${round3(values[values.length - 1]!)}`
  for (let i = values.length - 2; i >= 0; i--) {
    expr = `if(lt(t,${round3(times[i + 1]!)}),${round3(values[i]!)},${expr})`
  }
  return expr
}

// --------------------------------------------------------------------------
// Effects / camera chains
// --------------------------------------------------------------------------

export function clipEffectsFilters(clip: TimelineClip): string[] {
  const fx = clip.effects
  const filters: string[] = []
  if (fx.brightness !== 1 || fx.contrast !== 1 || fx.saturate !== 1) {
    const parts: string[] = []
    if (fx.brightness !== 1) parts.push(`brightness=${round3(fx.brightness - 1)}`)
    if (fx.contrast !== 1) parts.push(`contrast=${round3(fx.contrast)}`)
    if (fx.saturate !== 1) parts.push(`saturation=${round3(fx.saturate)}`)
    if (parts.length > 0) filters.push(`eq=${parts.join(':')}`)
  }
  if (fx.hue !== 0 || fx.grayscale > 0) {
    filters.push(`hue=h=${round3(fx.hue)}:s=${round3(1 - fx.grayscale)}`)
  }
  if (fx.blur > 0) filters.push(`gblur=sigma=${round3(fx.blur)}`)
  if (fx.vignette > 0) filters.push(`vignette=angle=${round3((Math.PI / 5) * fx.vignette)}`)
  return filters
}

/** pan filter matrix for a constant stereo pan (-1 left … +1 right). */
export function panFilter(pan: number): string | null {
  if (Math.abs(pan) < 0.01) return null
  const l = clamp(1 - Math.max(0, pan), 0, 1)
  const r = clamp(1 + Math.min(0, pan), 0, 1)
  return `pan=stereo|c0=${round3(l)}*c0+${round3(1 - l)}*c1|c1=${round3(r)}*c1+${round3(1 - r)}*c0`
}

// --------------------------------------------------------------------------
// The builder
// --------------------------------------------------------------------------

export function buildSceneRenderSpec(
  bundle: TimelineBundle,
  camera: CameraCurves,
  automation: AutomationCurves,
  opts: BuilderOptions,
): SceneRenderSpec {
  const { preset, quality } = opts
  const fps = preset.fps
  const total = Math.max(bundle.durationSec, 0.1)
  const anySolo = bundle.tracks.some((t) => t.solo && t.kind !== 'VIDEO')

  const args: string[] = ['-y', '-hide_banner']
  const filterParts: string[] = []
  let inputIndex = 0
  const videoInputByClip = new Map<string, number>()
  const audioInputByClip = new Map<string, number>()

  // ------------------------------------------------------------- video inputs
  const videoTracks = bundle.tracks.filter((t) => t.kind === 'VIDEO').sort((a, b) => a.orderIndex - b.orderIndex)
  for (const track of videoTracks) {
    for (const clip of bundle.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.startSec - b.startSec)) {
      const src = bundle.sources[clip.sourceId]
      const frameAssetId = src?.type === 'SHOT' ? src.frameAssetId : null
      if (frameAssetId) {
        args.push('-loop', '1', '-t', String(round3(clip.durationSec)), '-r', String(fps), '-i', `{{ASSET:${frameAssetId}}}`)
      } else {
        // Shot without a frame renders as black — same semantic as the preview placeholder.
        args.push('-f', 'lavfi', '-t', String(round3(clip.durationSec)), '-r', String(fps),
          '-i', `color=black:s=${preset.width}x${preset.height}:rate=${fps}`)
      }
      videoInputByClip.set(clip.id, inputIndex)
      inputIndex++
    }
  }
  const hasVideo = videoInputByClip.size > 0

  // ------------------------------------------------------------- audio inputs
  const audioTrackIds = new Set<string>()
  let audioClipCount = 0
  for (const track of bundle.tracks) {
    if (track.kind === 'VIDEO') continue
    const audible = anySolo ? track.solo : !track.muted
    if (!audible) continue
    audioTrackIds.add(track.id)
  }
  for (const clip of bundle.clips) {
    if (!audioTrackIds.has(clip.trackId)) continue
    const src = bundle.sources[clip.sourceId]
    const assetId = src?.type === 'MEDIA' ? src.assetId : src?.type === 'SHOT' ? src.audioAssetId : null
    if (!assetId) continue
    args.push('-i', `{{ASSET:${assetId}}}`)
    audioInputByClip.set(clip.id, inputIndex)
    inputIndex++
    audioClipCount++
  }

  // ------------------------------------------------------------- video graph
  const videoOutLabels: string[] = []
  if (hasVideo) {
    for (const track of videoTracks) {
      const trackClips = bundle.clips
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.startSec - b.startSec)
      const clipLabels: string[] = []
      for (const clip of trackClips) {
        const inputIdx = videoInputByClip.get(clip.id)!
        const frames = Math.max(1, Math.round(clip.durationSec * fps))
        const chain: string[] = []

        // Effects first (match preview: filters apply to the source image).
        chain.push(...clipEffectsFilters(clip))

        // Camera: zoompan handles zoom + x/y pan.
        const camPoints = bakedCameraPoints(clip, camera)
        const zoomExpr = piecewiseExpr('on', fps, camPoints.get('scale') ?? [], DEFAULT_CAMERA.scale)
        const xExpr = piecewiseExpr('on', fps, camPoints.get('x') ?? [], DEFAULT_CAMERA.x)
        const yExpr = piecewiseExpr('on', fps, camPoints.get('y') ?? [], DEFAULT_CAMERA.y)
        const rotPoints = camPoints.get('rotation') ?? []
        const rotExpr = piecewiseExpr('t', null, rotPoints, DEFAULT_CAMERA.rotation)

        // Upscale 2x headroom so zoompan never runs out of pixels.
        chain.push(`scale=${preset.width * 2}:${preset.height * 2}:force_original_aspect_ratio=increase`)
        const zxCenter = 'iw/2-(iw/zoom/2)'
        const zyCenter = 'ih/2-(ih/zoom/2)'
        chain.push(
          `zoompan=z='${zoomExpr ?? 1}':x='${xExpr ?? zxCenter}':y='${yExpr ?? zyCenter}'` +
            `:d=${frames}:s=${preset.width}x${preset.height}:fps=${fps}`,
        )
        if (rotExpr) {
          chain.push(`rotate=a='PI/180*(${rotExpr})':ow=iw:oh=ih:c=black`)
        }
        chain.push('setsar=1')

        // Compositing alpha for overlays.
        if (videoTracks.length > 1 && track !== videoTracks[0]) {
          chain.push(`format=yuva420p`)
          if (clip.opacity < 0.999) {
            chain.push(`colorchannelmixer=aa=${round3(clip.opacity)}`)
          }
        }

        const label = `v${clipLabels.length}_${track.id.slice(-4)}`
        filterParts.push(`[${inputIdx}:v]${chain.join(',')}[${label}]`)
        clipLabels.push(label)
      }

      if (clipLabels.length === 0) continue
      if (clipLabels.length === 1) {
        videoOutLabels.push(clipLabels[0]!)
      } else {
        const joined = clipLabels.join('][')
        const label = `vt_${track.id.slice(-4)}`
        filterParts.push(`[${joined}]concat=n=${clipLabels.length}:v=1:a=0[${label}]`)
        videoOutLabels.push(label)
      }
    }
  }

  // Composite: first track = base; others overlay (track order = z).
  let videoLabel: string | null = null
  if (videoOutLabels.length > 0) {
    videoLabel = videoOutLabels[0]!
    for (let i = 1; i < videoOutLabels.length; i++) {
      const out = `vcomp${i}`
      filterParts.push(`[${videoLabel}][${videoOutLabels[i]!}]overlay=0:0:format=auto[${out}]`)
      videoLabel = out
    }
  }

  // ------------------------------------------------------------- audio graph
  let audioLabel: string | null = null
  if (audioClipCount > 0) {
    const mixLabels: string[] = []
    let n = 0
    for (const clip of bundle.clips) {
      if (!audioInputByClip.has(clip.id)) continue
      const track = bundle.tracks.find((t) => t.id === clip.trackId)!
      const inputIdx = audioInputByClip.get(clip.id)!
      const chain: string[] = []
      chain.push(`atrim=start=${round3(clip.inOffsetSec)}:duration=${round3(clip.durationSec)}`)
      chain.push('asetpts=PTS-STARTPTS')
      const volExpr = bakedVolumeExpr(clip, track, automation)
      const constantVol = clip.volume * track.volume
      if (volExpr) {
        chain.push(`volume='${volExpr}':eval=frame`)
      } else if (constantVol !== 1) {
        chain.push(`volume=${round3(constantVol)}`)
      }
      const pan = panFilter(track.pan)
      if (pan) chain.push(pan)
      chain.push('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo')
      const startMs = Math.round(clip.startSec * 1000)
      if (startMs > 0) chain.push(`adelay=${startMs}|${startMs}`)
      const label = `a${n}`
      filterParts.push(`[${inputIdx}:a]${chain.join(',')}[${label}]`)
      mixLabels.push(label)
      n++
    }
    if (mixLabels.length === 0) {
      audioClipCount = 0
    } else {
      const mixOut = 'amix'
      const joined = mixLabels.join('][')
      filterParts.push(`[${joined}]amix=inputs=${mixLabels.length}:duration=longest:normalize=0[${mixOut}]`)
      filterParts.push(`[${mixOut}]atrim=0:${round3(total)},asetpts=PTS-STARTPTS[aout]`)
      audioLabel = 'aout'
    }
  }

  // Fallbacks: black video / silent audio keep the output shape consistent.
  if (!videoLabel) {
    args.push('-f', 'lavfi', '-t', String(round3(total)), '-r', String(fps),
      '-i', `color=black:s=${preset.width}x${preset.height}:rate=${fps}`)
    videoLabel = `basev`
    filterParts.push(`[${inputIndex}:v]null[${videoLabel}]`)
    inputIndex++
  }
  if (!audioLabel) {
    args.push('-f', 'lavfi', '-t', String(round3(total)), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000')
    filterParts.push(`[${inputIndex}:a]atrim=0:${round3(total)},asetpts=PTS-STARTPTS[aout]`)
    audioLabel = 'aout'
    inputIndex++
  }

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map', `[${videoLabel}]`,
    '-map', `[${audioLabel}]`,
  )

  // ---- codec settings
  const master = quality === 'MASTER'
  args.push(
    '-c:v', 'libx264',
    '-tune', 'animation',
    '-preset', master ? 'medium' : 'ultrafast',
    '-crf', master ? '18' : '30',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${preset.videoKbps}k`,
    '-maxrate', `${Math.round(preset.videoKbps * 1.5)}k`,
    '-bufsize', `${preset.videoKbps * 2}k`,
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', `${preset.audioKbps}k`,
    '-ar', '48000',
    '-t', String(round3(total)),
    '-movflags', '+faststart',
  )
  return {
    args,
    totalSec: total,
    videoClipCount: videoInputByClip.size,
    audioClipCount,
  }
}
