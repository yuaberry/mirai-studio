/**
 * PlaybackEngine (Phase 5) — real transport + Web Audio mixing.
 *
 * - The playhead is driven by the wall clock (rAF ticks) for video/canvas.
 * - Every audio clip is a real <audio> element routed through the Web Audio
 *   graph: element → clipGain → trackGain → panner → master → destination.
 * - Clip volume, track volume/pan, mute/solo, per-clip volume automation
 *   (CLIP keyframes) and per-track mixer automation (MIXER keyframes) are
 *   applied live with real gain/panner nodes.
 * - Drift is corrected by resynchronizing an element when it slips > 150 ms.
 */
import {
  sampleCurve,
  type KeyframeRecord,
  type TimelineBundle,
  type TimelineClip,
} from '@mirai/shared'

export interface EngineState {
  playing: boolean
  playheadSec: number
}

interface ClipWire {
  element: HTMLAudioElement
  source: MediaElementAudioSourceNode
  clipGain: GainNode
}

interface TrackWire {
  trackGain: GainNode
  panner: StereoPannerNode
  clips: Map<string, ClipWire>
}

/** Visual wires for generated videos (muted — audio comes from the mix). */
interface VideoWire {
  element: HTMLVideoElement
}

export interface EngineOptions {
  /** Absolute asset URL resolver (mirai-asset://). */
  assetUrl: (assetId: string) => string
  onTick: (state: EngineState) => void
}

const DRIFT_SEC = 0.15

export class PlaybackEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private wires = new Map<string, TrackWire>() // trackId → wire
  private videoWires = new Map<string, VideoWire>() // clipId → wire
  private bundle: TimelineBundle | null = null
  private keyframes = new Map<string, KeyframeRecord[]>() // `${target}:${id}` → curve list
  private playing = false
  private playheadSec = 0
  private originSec = 0
  private originWall = 0
  private raf = 0
  private disposed = false

  constructor(private readonly opts: EngineOptions) {}

  // ------------------------------------------------------------- inputs

  /** Full timeline snapshot — rebuilds the audio graph when the ids change. */
  setBundle(bundle: TimelineBundle | null): void {
    this.bundle = bundle
    this.rebuildGraph()
    if (this.playheadSec > (bundle?.durationSec ?? 0)) this.playheadSec = 0
  }

  /** Hot-swap the automation data without touching the audio graph. */
  setKeyframes(list: KeyframeRecord[]): void {
    this.keyframes = new Map()
    for (const kf of list) {
      const key = `${kf.targetType}:${kf.targetId}`
      const arr = this.keyframes.get(key) ?? []
      arr.push(kf)
      this.keyframes.set(key, arr)
    }
    for (const arr of this.keyframes.values()) arr.sort((a, b) => a.atSec - b.atSec)
  }

  setMasterVolume(volume: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.01)
    }
  }

  get playhead(): number {
    return this.playheadSec
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** The generated-video element for a clip (the preview mounts it visually). */
  videoElementFor(clipId: string): HTMLVideoElement | null {
    return this.videoWires.get(clipId)?.element ?? null
  }

  // ----------------------------------------------------------- transport

  async play(): Promise<void> {
    const bundle = this.bundle
    if (!bundle || bundle.clips.length === 0 || this.playing) return
    await this.ensureContext()
    if (this.playheadSec >= bundle.durationSec - 0.01) {
      this.playheadSec = 0
    }
    this.originSec = this.playheadSec
    this.originWall = performance.now()
    this.playing = true
    this.tick()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.emit()
    for (const wire of this.wires.values()) {
      for (const clip of wire.clips.values()) clip.element.pause()
    }
  }

  stop(): void {
    this.pause()
    this.playheadSec = 0
    this.emit()
  }

  seek(sec: number): void {
    const max = this.bundle?.durationSec ?? 0
    this.playheadSec = Math.max(0, Math.min(sec, max))
    this.originSec = this.playheadSec
    this.originWall = performance.now()
    // Restart audio at the new position immediately.
    if (this.playing) {
      for (const wire of this.wires.values()) {
        for (const clip of wire.clips.values()) clip.element.pause()
      }
      this.syncClips()
    } else {
      this.emit()
    }
  }

  dispose(): void {
    this.disposed = true
    this.playing = false
    cancelAnimationFrame(this.raf)
    for (const wire of this.wires.values()) {
      for (const clip of wire.clips.values()) {
        clip.element.pause()
        clip.element.src = ''
      }
    }
    this.wires.clear()
    for (const wire of this.videoWires.values()) {
      wire.element.pause()
      wire.element.src = ''
    }
    this.videoWires.clear()
    void this.ctx?.close()
    this.ctx = null
  }

  // ------------------------------------------------------------- internals

  private async ensureContext(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      this.rebuildGraph()
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  /** Build (or rebuild) the element graph for the current bundle. */
  private rebuildGraph(): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const bundle = this.bundle

    const keepTracks = new Set<string>()
    if (bundle) {
      for (const track of bundle.tracks) {
        if (track.kind === 'VIDEO') continue
        keepTracks.add(track.id)
        let wire = this.wires.get(track.id)
        if (!wire) {
          const trackGain = ctx.createGain()
          const panner = ctx.createStereoPanner()
          trackGain.connect(panner)
          panner.connect(this.master!)
          wire = { trackGain, panner, clips: new Map() }
          this.wires.set(track.id, wire)
        }
        const keepClips = new Set<string>()
        for (const clip of bundle.clips) {
          if (clip.trackId !== track.id) continue
          keepClips.add(clip.id)
          if (!wire.clips.has(clip.id)) {
            const assetId = this.audioAssetId(clip)
            if (!assetId) continue
            const element = new Audio()
            element.preload = 'auto'
            element.src = this.opts.assetUrl(assetId)
            const source = ctx.createMediaElementSource(element)
            const clipGain = ctx.createGain()
            source.connect(clipGain)
            clipGain.connect(wire.trackGain)
            wire.clips.set(clip.id, { element, source, clipGain })
          }
        }
        for (const [clipId, wireClip] of wire.clips) {
          if (!keepClips.has(clipId)) {
            wireClip.element.pause()
            wireClip.element.src = ''
            wire.clips.delete(clipId)
          }
        }
      }
    }
    for (const [trackId, wire] of this.wires) {
      if (!keepTracks.has(trackId)) {
        for (const clip of wire.clips.values()) {
          clip.element.pause()
          clip.element.src = ''
        }
        wire.trackGain.disconnect()
        wire.panner.disconnect()
        this.wires.delete(trackId)
      }
    }
  }

  /** Which concrete audio asset backs a clip (voice of a shot or media file). */
  private audioAssetId(clip: TimelineClip): string | null {
    const bundle = this.bundle
    if (!bundle) return null
    const src = bundle.sources[clip.sourceId]
    if (!src) return null
    if (src.type === 'MEDIA') return src.assetId
    return src.audioAssetId
  }

  /** Audible = not muted and (no solos anywhere or this track is soloed). */
  private trackAudible(bundle: TimelineBundle, trackId: string): boolean {
    const anySolo = bundle.tracks.some((t) => t.solo && t.kind !== 'VIDEO')
    if (anySolo) return bundle.tracks.find((t) => t.id === trackId)?.solo === true
    return bundle.tracks.find((t) => t.id === trackId)?.muted !== true
  }

  private sample(target: string, targetId: string, param: string, atSec: number): number | null {
    const curve = this.keyframes.get(`${target}:${targetId}`)
    if (!curve) return null
    const paramCurve = curve.filter((k) => k.param === param)
    if (paramCurve.length === 0) return null
    return sampleCurve(paramCurve, atSec)
  }

  private tick = (): void => {
    if (!this.playing || this.disposed) return
    const bundle = this.bundle
    if (bundle) {
      this.playheadSec = this.originSec + (performance.now() - this.originWall) / 1000
      if (this.playheadSec >= bundle.durationSec) {
        this.playheadSec = bundle.durationSec
        this.playing = false
        for (const wire of this.wires.values()) {
          for (const clip of wire.clips.values()) clip.element.pause()
        }
        this.emit()
        return
      }
      this.syncClips()
    }
    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Start/stop clip elements at their boundaries and apply automation. */
  private syncClips(): void {
    const bundle = this.bundle
    if (!bundle || !this.ctx) return
    const now = this.ctx.currentTime
    for (const track of bundle.tracks) {
      if (track.kind === 'VIDEO') continue
      const wire = this.wires.get(track.id)
      if (!wire) continue
      const audible = this.trackAudible(bundle, track.id)
      // Track volume + pan (+ MIXER automation sampled at the playhead).
      const autoVolume = this.sample('MIXER', track.id, 'volume', this.playheadSec)
      const trackVolume = track.volume * (autoVolume ?? 1)
      wire.trackGain.gain.setTargetAtTime(audible ? trackVolume : 0, now, 0.01)
      wire.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, track.pan)), now, 0.01)

      for (const clip of bundle.clips) {
        if (clip.trackId !== track.id) continue
        const wireClip = wire.clips.get(clip.id)
        if (!wireClip) continue
        const assetId = this.audioAssetId(clip)
        if (!assetId) continue
        const inClip = this.playheadSec >= clip.startSec && this.playheadSec < clip.startSec + clip.durationSec
        // Clip volume + CLIP automation (clip-local time).
        const clipLocal = this.playheadSec - clip.startSec
        const clipAuto = this.sample('CLIP', clip.id, 'volume', clipLocal)
        wireClip.clipGain.gain.setTargetAtTime(clip.volume * (clipAuto ?? 1), now, 0.01)

        if (inClip && audible) {
          const expected = clip.inOffsetSec + clipLocal
          const el = wireClip.element
          if (el.paused) {
            try {
              el.currentTime = Math.max(0, expected)
              void el.play()
            } catch {
              // Autoplay guard — retried on the next tick.
            }
          } else if (Math.abs(el.currentTime - expected) > DRIFT_SEC) {
            try {
              el.currentTime = Math.max(0, expected)
            } catch {
              // seek not ready yet
            }
          }
        } else if (!wireClip.element.paused) {
          wireClip.element.pause()
        }
      }
    }

    // Generated videos: start/stop at clip boundaries, drift-corrected.
    for (const clip of bundle.clips) {
      const wire = this.videoWires.get(clip.id)
      const track = bundle.tracks.find((t) => t.id === clip.trackId)
      if (!wire || !track || track.muted) continue
      const inClip =
        this.playheadSec >= clip.startSec && this.playheadSec < clip.startSec + clip.durationSec
      if (inClip && !track.muted) {
        const expected = clip.inOffsetSec + (this.playheadSec - clip.startSec)
        const el = wire.element
        if (el.paused) {
          try {
            el.currentTime = Math.max(0, expected)
            void el.play()
          } catch {
            // autoplay guard — retried next tick
          }
        } else if (Math.abs(el.currentTime - expected) > DRIFT_SEC) {
          try {
            el.currentTime = Math.max(0, expected)
          } catch {
            // seek not ready
          }
        }
      } else if (!wire.element.paused) {
        wire.element.pause()
      }
    }
  }

  private emit(): void {
    this.opts.onTick({ playing: this.playing, playheadSec: this.playhead })
  }
}
