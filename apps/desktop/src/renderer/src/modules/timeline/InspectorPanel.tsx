/**
 * InspectorPanel — properties of the selected clip: timing, volume, opacity,
 * blend mode, the real effects chain, quick audio fades (CLIP keyframes) and
 * camera keyframe actions for video clips.
 */
import { useMemo } from 'react'
import {
  BLEND_MODES,
  EASING_LABEL,
  type ClipEffects,
  type TimelineBundle,
  type TimelineClip,
} from '@mirai/shared'
import { Camera, Sparkles } from 'lucide-react'
import { Button, Input, Label, Select } from '../../system/ui'
import { cachedPeaks } from './waveform'

export interface InspectorPanelProps {
  bundle: TimelineBundle
  clip: TimelineClip | null
  playheadSec: number
  onClipPatch: (id: string, patch: Record<string, unknown>) => void
  onCameraKeyframe: (clip: TimelineClip) => void
  onFade: (clip: TimelineClip, kind: 'in' | 'out') => void
  onFitToSource: (clip: TimelineClip) => void
}

const NUM_STEP = 0.1

export function InspectorPanel(props: InspectorPanelProps) {
  const { bundle, clip } = props
  const source = clip ? bundle.sources[clip.sourceId] : undefined
  const track = clip ? bundle.tracks.find((t) => t.id === clip.trackId) : undefined
  const isVideo = track?.kind === 'VIDEO'

  const probe = useMemo(() => {
    if (!clip || !source) return null
    const assetId = source.type === 'MEDIA' ? source.assetId : source.audioAssetId
    return assetId ? cachedPeaks(assetId) : null
  }, [clip, source])

  if (!clip) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-[11px] text-mirai-faint">Select a clip on the timeline.</p>
      </div>
    )
  }

  const setEffect = (key: keyof ClipEffects, value: number) => {
    props.onClipPatch(clip.id, { effects: { ...clip.effects, [key]: value } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div>
        <p className="truncate text-xs font-bold text-mirai-text" title={clip.label}>
          {clip.label}
        </p>
        <p className="text-[10px] text-mirai-faint">
          {source?.type === 'SHOT' ? `Shot — ${source.shotType} · ${source.cameraMovement}` : 'Media clip'}
          {probe ? ` · source ${probe.duration.toFixed(1)}s` : ''}
        </p>
      </div>

      {/* timing */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">Start (s)</Label>
          <Input
            className="h-7 text-xs"
            type="number"
            min={0}
            step={NUM_STEP}
            value={Number(clip.startSec.toFixed(2))}
            onChange={(e) => props.onClipPatch(clip.id, { startSec: Math.max(0, Number(e.target.value)) })}
          />
        </div>
        <div>
          <Label className="text-[10px]">Duration (s)</Label>
          <Input
            className="h-7 text-xs"
            type="number"
            min={0.05}
            step={NUM_STEP}
            value={Number(clip.durationSec.toFixed(2))}
            onChange={(e) => props.onClipPatch(clip.id, { durationSec: Math.max(0.05, Number(e.target.value)) })}
          />
        </div>
        <div>
          <Label className="text-[10px]">In point (s)</Label>
          <Input
            className="h-7 text-xs"
            type="number"
            min={0}
            step={NUM_STEP}
            value={Number(clip.inOffsetSec.toFixed(2))}
            onChange={(e) => props.onClipPatch(clip.id, { inOffsetSec: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </div>

      {/* volume (all clips) */}
      <div>
        <Label className="text-[10px]">
          Volume — {Math.round(clip.volume * 100)}%
        </Label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.02}
          value={clip.volume}
          className="h-1 w-full accent-mirai-pink"
          onChange={(e) => props.onClipPatch(clip.id, { volume: Number(e.target.value) })}
        />
      </div>

      {!isVideo && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => props.onFade(clip, 'in')}>
            <Sparkles className="h-3 w-3" /> Fade in
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => props.onFade(clip, 'out')}>
            <Sparkles className="h-3 w-3" /> Fade out
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!probe}
            title={probe ? 'Set clip duration to the real source duration' : 'Source not probed yet'}
            onClick={() => props.onFitToSource(clip)}
          >
            Fit
          </Button>
        </div>
      )}

      {isVideo && (
        <>
          {/* compositing */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Opacity — {Math.round(clip.opacity * 100)}%</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={clip.opacity}
                className="h-1 w-full accent-mirai-pink"
                onChange={(e) => props.onClipPatch(clip.id, { opacity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-[10px]">Blend</Label>
              <Select
                className="h-7 text-xs"
                value={clip.blend}
                onChange={(e) => props.onClipPatch(clip.id, { blend: e.target.value })}
              >
                {BLEND_MODES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* effects (real, previewable, FFmpeg-mappable) */}
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-wider text-mirai-faint uppercase">Effects</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {(
                [
                  ['brightness', 'Brightness', 0, 3, 0.02],
                  ['contrast', 'Contrast', 0, 3, 0.02],
                  ['saturate', 'Saturation', 0, 3, 0.02],
                  ['hue', 'Hue (°)', -180, 180, 1],
                  ['blur', 'Blur (px)', 0, 20, 0.5],
                  ['grayscale', 'Grayscale', 0, 1, 0.02],
                  ['vignette', 'Vignette', 0, 1, 0.02],
                ] as Array<[keyof ClipEffects, string, number, number, number]>
              ).map(([key, label, min, max, step]) => (
                <div key={key}>
                  <Label className="text-[9px]">{label}</Label>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={clip.effects[key]}
                    className="h-1 w-full accent-mirai-violet"
                    onChange={(e) => setEffect(key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5 w-full"
              onClick={() =>
                props.onClipPatch(clip.id, {
                  effects: {
                    brightness: 1,
                    contrast: 1,
                    saturate: 1,
                    hue: 0,
                    blur: 0,
                    grayscale: 0,
                    vignette: 0,
                  },
                })
              }
            >
              Reset effects
            </Button>
          </div>

          {/* camera */}
          <Button size="sm" variant="outline" className="w-full" onClick={() => props.onCameraKeyframe(clip)}>
            <Camera className="h-3 w-3" /> Add camera keyframe at playhead
          </Button>
          <p className="text-[9px] leading-relaxed text-mirai-faint">
            Camera curves ({EASING_LABEL.linear}/{EASING_LABEL.easeInOut}/bézier) animate position,
            zoom, rotation and opacity over the clip — the pro "Ken Burns" toolkit.
          </p>
        </>
      )}
    </div>
  )
}
