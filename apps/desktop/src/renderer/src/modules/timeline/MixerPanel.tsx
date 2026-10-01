/**
 * MixerPanel — real channel strips for every audio track + master.
 *
 * Volume faders, pan, mute and solo drive the actual Web Audio graph during
 * playback (see PlaybackEngine); the "A" badge lights up when the track has
 * volume automation (MIXER keyframes).
 */
import { useEffect, useRef } from 'react'
import {
  KeyframeRecord,
  TRACK_KIND_LABEL,
  type TimelineBundle,
  type TimelineTrack,
} from '@mirai/shared'
import { AudioWaveform, Headphones, Plus, Trash2, VolumeX } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface MixerPanelProps {
  bundle: TimelineBundle
  mixerKeyframes: KeyframeRecord[]
  masterVolume: number
  onTrackUpdate: (id: string, patch: { muted?: boolean; solo?: boolean; volume?: number; pan?: number }) => void
  onTrackDelete: (id: string) => void
  onMasterVolume: (volume: number) => void
  onAutomate: (trackId: string) => void
  onAddTrack: () => void
}

/** dB display for a linear gain (pro convention). */
function toDb(v: number): string {
  if (v <= 0.001) return '-∞ dB'
  const db = 20 * Math.log10(v)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

/** Vertical fader — pointer-driven, real, no native range input. */
function Fader({
  value,
  min,
  max,
  onChange,
  height = 110,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  height?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef(false)

  const applyFromClientY = (clientY: number) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    onChange(min + t * (max - min))
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (activeRef.current) applyFromClientY(e.clientY)
    }
    const up = () => {
      activeRef.current = false
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  const t = (value - min) / (max - min)
  return (
    <div
      ref={ref}
      className="relative w-9 cursor-pointer rounded-md border border-mirai-line bg-mirai-panel"
      style={{ height }}
      onPointerDown={(e) => {
        activeRef.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        applyFromClientY(e.clientY)
      }}
    >
      <div
        className="absolute bottom-0 left-0 w-full rounded-b-md bg-gradient-to-t from-mirai-pink/40 to-mirai-violet/40"
        style={{ height: `${t * 100}%` }}
      />
      <div
        className="absolute left-0.5 h-2 w-8 rounded-sm bg-mirai-text shadow"
        style={{ bottom: `calc(${t * 100}% - 4px)` }}
      />
      <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-mirai-line" />
    </div>
  )
}

export function MixerPanel(props: MixerPanelProps) {
  const { bundle } = props
  const audioTracks = bundle.tracks.filter((t) => t.kind !== 'VIDEO')
  const automated = new Set(props.mixerKeyframes.map((k) => k.targetId))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center justify-between border-b border-mirai-line px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-mirai-dim uppercase">
          <Headphones className="h-3.5 w-3.5" /> Mixer
        </p>
        <button
          className="rounded p-1 text-mirai-faint transition-colors hover:bg-mirai-hover hover:text-mirai-text"
          title="Add audio track"
          onClick={props.onAddTrack}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch gap-1 overflow-x-auto p-2">
        {audioTracks.length === 0 && (
          <p className="m-auto text-[11px] text-mirai-faint">No audio tracks — build the timeline first.</p>
        )}
        {audioTracks.map((track) => (
          <ChannelStrip
            key={track.id}
            track={track}
            automated={automated.has(track.id)}
            onUpdate={props.onTrackUpdate}
            onDelete={props.onTrackDelete}
            onAutomate={props.onAutomate}
          />
        ))}
        {/* Master */}
        <div className="ml-1 flex w-24 flex-none flex-col items-center gap-1.5 rounded-lg border border-mirai-pink/30 bg-mirai-panel px-1.5 py-2">
          <p className="text-[10px] font-bold tracking-wider text-mirai-pink uppercase">Master</p>
          <Fader value={props.masterVolume} min={0} max={1.5} onChange={props.onMasterVolume} />
          <p className="font-mono text-[10px] text-mirai-dim">{toDb(props.masterVolume)}</p>
        </div>
      </div>
    </div>
  )
}

function ChannelStrip({
  track,
  automated,
  onUpdate,
  onDelete,
  onAutomate,
}: {
  track: TimelineTrack
  automated: boolean
  onUpdate: (id: string, patch: { muted?: boolean; solo?: boolean; volume?: number; pan?: number }) => void
  onDelete: (id: string) => void
  onAutomate: (trackId: string) => void
}) {
  return (
    <div className="flex w-24 flex-none flex-col items-center gap-1.5 rounded-lg border border-mirai-line bg-mirai-panel px-1.5 py-2">
      <div className="flex w-full items-center justify-between">
        <p className="truncate text-[10px] font-semibold text-mirai-dim" title={track.name}>
          {track.name}
        </p>
        <span className="text-[9px] text-mirai-faint">{TRACK_KIND_LABEL[track.kind].slice(0, 3)}</span>
      </div>
      <Fader value={track.volume} min={0} max={1.5} onChange={(v) => onUpdate(track.id, { volume: v })} />
      <p className="font-mono text-[10px] text-mirai-dim">{toDb(track.volume)}</p>
      {/* pan */}
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={track.pan}
        title={`Pan ${track.pan < -0.01 ? `L${Math.round(-track.pan * 100)}` : track.pan > 0.01 ? `R${Math.round(track.pan * 100)}` : 'C'}`}
        className="h-1 w-full accent-mirai-pink"
        onChange={(e) => onUpdate(track.id, { pan: Number(e.target.value) })}
      />
      <div className="flex gap-1">
        <button
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors',
            track.muted ? 'bg-red-500/80 text-black' : 'bg-mirai-hover text-mirai-faint hover:text-mirai-text',
          )}
          title="Mute"
          onClick={() => onUpdate(track.id, { muted: !track.muted })}
        >
          {track.muted ? <VolumeX className="h-3 w-3" /> : 'M'}
        </button>
        <button
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors',
            track.solo ? 'bg-amber-400/90 text-black' : 'bg-mirai-hover text-mirai-faint hover:text-mirai-text',
          )}
          title="Solo"
          onClick={() => onUpdate(track.id, { solo: !track.solo })}
        >
          S
        </button>
        <button
          className={cn(
            'rounded px-1 py-0.5 transition-colors',
            automated ? 'bg-mirai-pink/20 text-mirai-pink' : 'bg-mirai-hover text-mirai-faint hover:text-mirai-text',
          )}
          title={automated ? 'Volume automation (click to edit)' : 'Add volume automation'}
          onClick={() => onAutomate(track.id)}
        >
          <AudioWaveform className="h-3 w-3" />
        </button>
        <button
          className="rounded bg-mirai-hover p-0.5 text-mirai-faint transition-colors hover:text-red-400"
          title="Delete track"
          onClick={() => onDelete(track.id)}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

