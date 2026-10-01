/**
 * PreviewStage — the 16:9 program monitor.
 *
 * REAL compositing: every VIDEO track contributes a layer at the playhead;
 * each layer applies its clip opacity, blend mode, effects chain (CSS filters
 * mapping 1:1 to FFmpeg eq/hue/gblur), vignette lighting and the camera
 * transform sampled from CAMERA keyframes (x/y/scale/rotation/opacity).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatTimelineTime,
  sampleCamera,
  type CameraState,
  type KeyframeRecord,
  type TimelineBundle,
  type TimelineClip,
} from '@mirai/shared'
import { Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import { assetUrl } from '../../lib/queries'
import { cn } from '../../lib/utils'

export interface PreviewStageProps {
  bundle: TimelineBundle
  playheadSec: number
  playing: boolean
  loop: boolean
  cameraKeyframes: KeyframeRecord[]
  onTogglePlay: () => void
  onStop: () => void
  onStep: (deltaSec: number) => void
  onToggleLoop: () => void
  onOpenStoryboard: (sceneId: string) => void
}

/** CSS filter chain for a clip — real in preview, mappable to FFmpeg -vf. */
export function clipFilter(fx: {
  brightness: number
  contrast: number
  saturate: number
  hue: number
  blur: number
  grayscale: number
}): string {
  const parts: string[] = []
  if (fx.brightness !== 1) parts.push(`brightness(${fx.brightness})`)
  if (fx.contrast !== 1) parts.push(`contrast(${fx.contrast})`)
  if (fx.saturate !== 1) parts.push(`saturate(${fx.saturate})`)
  if (fx.hue !== 0) parts.push(`hue-rotate(${fx.hue}deg)`)
  if (fx.blur > 0) parts.push(`blur(${fx.blur}px)`)
  if (fx.grayscale > 0) parts.push(`grayscale(${fx.grayscale})`)
  return parts.length > 0 ? parts.join(' ') : 'none'
}

export function PreviewStage(props: PreviewStageProps) {
  const { bundle, playheadSec, playing, loop, cameraKeyframes } = props
  const [preloaded, setPreloaded] = useState(0)

  // Camera curves grouped per shot → param.
  const cameraByShot = useMemo(() => {
    const map = new Map<string, Map<string, KeyframeRecord[]>>()
    for (const kf of cameraKeyframes) {
      if (kf.targetType !== 'CAMERA') continue
      let byParam = map.get(kf.targetId)
      if (!byParam) {
        byParam = new Map()
        map.set(kf.targetId, byParam)
      }
      const arr = byParam.get(kf.param) ?? []
      arr.push(kf)
      byParam.set(kf.param, arr)
    }
    for (const byParam of map.values()) {
      for (const [param, arr] of byParam) byParam.set(param, arr.sort((a, b) => a.atSec - b.atSec))
    }
    return map
  }, [cameraKeyframes])

  // Active video layers at the playhead (track order = stacking; lower index first).
  const layers = useMemo(() => {
    const videoTracks = bundle.tracks.filter((t) => t.kind === 'VIDEO')
    const out: Array<{ clip: TimelineClip; camera: CameraState; z: number }> = []
    for (const track of videoTracks) {
      const clip = bundle.clips.find(
        (c) =>
          c.trackId === track.id &&
          playheadSec >= c.startSec &&
          playheadSec < c.startSec + c.durationSec,
      )
      if (!clip) continue
      const local = playheadSec - clip.startSec
      const byParam = cameraByShot.get(clip.sourceId)
      const camera: CameraState = byParam
        ? sampleCamera(byParam, local)
        : { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }
      out.push({ clip, camera, z: track.orderIndex })
    }
    return out.sort((a, b) => a.z - b.z)
  }, [bundle, playheadSec, cameraByShot])

  // Preload the next shot's frame for seamless transitions.
  const nextFrameAsset = useMemo(() => {
    const upcoming = bundle.clips
      .filter((c) => c.sourceType === 'SHOT' && c.startSec > playheadSec)
      .sort((a, b) => a.startSec - b.startSec)[0]
    if (!upcoming) return null
    const src = bundle.sources[upcoming.sourceId]
    return src?.type === 'SHOT' ? src.frameAssetId : null
  }, [bundle, playheadSec])

  const preloadRef = useRef(new Set<string>())
  useEffect(() => {
    if (nextFrameAsset && !preloadRef.current.has(nextFrameAsset)) {
      preloadRef.current.add(nextFrameAsset)
      const img = new Image()
      img.src = assetUrl(nextFrameAsset)
      img.onload = () => setPreloaded((n) => n + 1)
    }
  }, [nextFrameAsset])

  const activeTitle = layers.length > 0 ? layers[layers.length - 1]!.clip.label : null
  void preloaded

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* stage */}
      <div className="relative aspect-video w-full flex-none overflow-hidden rounded-lg border border-mirai-line bg-black">
        {layers.map(({ clip, camera }) => {
          const src = bundle.sources[clip.sourceId]
          const frameAssetId = src?.type === 'SHOT' ? src.frameAssetId : null
          return (
            <div
              key={clip.id}
              className="absolute inset-0"
              style={{
                zIndex: 10 + 0,
                opacity: clip.opacity * camera.opacity,
                mixBlendMode: clip.blend === 'normal' ? undefined : (clip.blend as never),
              }}
            >
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
                {frameAssetId ? (
                  <img
                    src={assetUrl(frameAssetId)}
                    alt={clip.label}
                    draggable={false}
                    className="max-h-full max-w-full object-contain will-change-transform"
                    style={{
                      transform: `translate(${camera.x}%, ${camera.y}%) rotate(${camera.rotation}deg) scale(${camera.scale})`,
                      filter: clipFilter(clip.effects),
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-center">
                    <p className="font-display text-sm font-bold text-mirai-dim">{clip.label}</p>
                    <button
                      className="text-[11px] text-mirai-faint underline decoration-dotted hover:text-mirai-pink"
                      onClick={() => props.onOpenStoryboard(bundle.sceneId)}
                    >
                      No frame — import one in Storyboard
                    </button>
                  </div>
                )}
                {clip.effects.vignette > 0 && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${clip.effects.vignette}) 100%)`,
                    }}
                  />
                )}
              </div>
            </div>
          )
        })}
        {layers.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-mirai-faint">No video clip at the playhead</p>
          </div>
        )}
        {/* HUD */}
        <div className="pointer-events-none absolute top-2 left-2 flex gap-2">
          <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-mirai-pink">
            {formatTimelineTime(playheadSec)}
          </span>
          {activeTitle && (
            <span className="max-w-56 truncate rounded bg-black/60 px-2 py-0.5 text-[11px] text-mirai-dim">
              {activeTitle}
            </span>
          )}
        </div>
      </div>

      {/* transport */}
      <div className="flex flex-none items-center justify-center gap-3">
        <button
          className="rounded p-1.5 text-mirai-dim transition-colors hover:bg-mirai-hover hover:text-mirai-text"
          title="Step back 1 frame (←)"
          onClick={() => props.onStep(-1 / 24)}
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full bg-mirai-pink text-black transition-transform hover:scale-105"
          title="Play / Pause (Space)"
          onClick={props.onTogglePlay}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>
        <button
          className="rounded p-1.5 text-mirai-dim transition-colors hover:bg-mirai-hover hover:text-mirai-text"
          title="Stop (Esc)"
          onClick={props.onStop}
        >
          <Square className="h-4 w-4" />
        </button>
        <button
          className="rounded p-1.5 text-mirai-dim transition-colors hover:bg-mirai-hover hover:text-mirai-text"
          title="Step forward 1 frame (→)"
          onClick={() => props.onStep(1 / 24)}
        >
          <SkipForward className="h-4 w-4" />
        </button>
        <button
          className={cn(
            'rounded px-2 py-1 text-[11px] font-semibold transition-colors',
            loop ? 'bg-mirai-pink/20 text-mirai-pink' : 'text-mirai-faint hover:bg-mirai-hover',
          )}
          title="Loop playback"
          onClick={props.onToggleLoop}
        >
          Loop
        </button>
      </div>
    </div>
  )
}
