/**
 * TimelineCanvas — the visual editing surface (canvas 2D).
 *
 * Real interactions: select, drag-move (with magnetic snapping + cross-track
 * moves), trim both edges, playhead scrubbing on the ruler, wheel zoom
 * around the cursor, real waveform peaks for audio clips and real frame
 * thumbnails for video clips.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatTimelineTime,
  type TimelineBundle,
  type TimelineClip,
  type TimelineTrack,
} from '@mirai/shared'
import { cachedPeaks, probeAsset } from './waveform'
import { assetUrl } from '../../lib/queries'

export const RULER_HEIGHT = 26
export const VIDEO_LANE_HEIGHT = 72
export const AUDIO_LANE_HEIGHT = 54
const CLIP_GAP = 2
const HANDLE_PX = 7
const SNAP_PX = 8
export const MIN_PPS = 4
export const MAX_PPS = 480

export interface CanvasCallbacks {
  onSeek: (sec: number) => void
  onSelect: (clipId: string | null) => void
  onMoveClip: (id: string, startSec: number, toTrackId?: string) => void
  onTrimClip: (id: string, patch: { startSec: number; durationSec: number; inOffsetSec: number }) => void
}

interface Props {
  bundle: TimelineBundle
  pxPerSec: number
  scrollX: number
  playheadSec: number
  selectedClipId: string | null
  selectedMarkerId: string | null
  snapping: boolean
  onScrollX: (x: number) => void
  onZoom: (pxPerSec: number) => void
  onSelectMarker: (id: string | null) => void
  callbacks: CanvasCallbacks
}

interface LaneLayout {
  track: TimelineTrack
  top: number
  height: number
}

type DragState =
  | { kind: 'none' }
  | { kind: 'scrub' }
  | { kind: 'move'; clipId: string; grabOffsetSec: number; fromTrackId: string; lastStart: number; lastTrackId: string }
  | { kind: 'trimL'; clipId: string; lastStart: number; lastDur: number; lastIn: number }
  | { kind: 'trimR'; clipId: string; lastDur: number }

const CLIP_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  VIDEO: { fill: '#2d1b4e', stroke: '#a78bfa', text: '#ede9fe' },
  VOICE: { fill: '#0f2e2b', stroke: '#2dd4bf', text: '#ccfbf1' },
  MUSIC: { fill: '#1b1035', stroke: '#e879f9', text: '#f5d0fe' },
  SFX: { fill: '#3a2506', stroke: '#fbbf24', text: '#fef3c7' },
  AMBIENCE: { fill: '#0a1f33', stroke: '#38bdf8', text: '#e0f2fe' },
}

export function TimelineCanvas(props: Props) {
  const { bundle, pxPerSec, scrollX, playheadSec, selectedClipId, selectedMarkerId, snapping } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 800, h: 320 })
  const dragRef = useRef<DragState>({ kind: 'none' })
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const [dragging, setDragging] = useState(false)
  const thumbnails = useRef(new Map<string, HTMLImageElement>())

  const lanes = useMemo<LaneLayout[]>(() => {
    let top = RULER_HEIGHT
    return bundle.tracks.map((track) => {
      const height = track.kind === 'VIDEO' ? VIDEO_LANE_HEIGHT : AUDIO_LANE_HEIGHT
      const lane = { track, top, height }
      top += height + CLIP_GAP
      return lane
    })
  }, [bundle.tracks])

  const contentHeight = RULER_HEIGHT + lanes.reduce((h, l) => h + l.height + CLIP_GAP, 0)

  // ---------------------------------------------------------------- resize
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: Math.max(el.clientHeight, contentHeight) })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: Math.max(el.clientHeight, contentHeight) })
    return () => ro.disconnect()
  }, [contentHeight])

  // ------------------------------------------------------------- thumbnail
  useEffect(() => {
    for (const clip of bundle.clips) {
      if (clip.sourceType !== 'SHOT') continue
      const src = bundle.sources[clip.sourceId]
      if (src?.type !== 'SHOT' || !src.frameAssetId) continue
      if (thumbnails.current.has(src.frameAssetId)) continue
      const img = new Image()
      img.src = assetUrl(src.frameAssetId)
      thumbnails.current.set(src.frameAssetId, img)
    }
  }, [bundle])

  // ------------------------------------------------------------- geometry
  const xOf = useCallback((sec: number) => sec * pxPerSec - scrollX, [pxPerSec, scrollX])
  const secOfX = useCallback((x: number) => (x + scrollX) / pxPerSec, [pxPerSec, scrollX])

  const laneAt = useCallback(
    (y: number): LaneLayout | null => lanes.find((l) => y >= l.top && y < l.top + l.height) ?? null,
    [lanes],
  )

  const clipAt = useCallback(
    (x: number, y: number): { clip: TimelineClip; lane: LaneLayout } | null => {
      const lane = laneAt(y)
      if (!lane) return null
      for (const clip of bundle.clips) {
        if (clip.trackId !== lane.track.id) continue
        const cx = xOf(clip.startSec)
        const cw = clip.durationSec * pxPerSec
        if (x >= cx && x <= cx + cw) return { clip, lane }
      }
      return null
    },
    [bundle.clips, laneAt, xOf, pxPerSec],
  )

  /** Magnetic snapping against clip edges, markers and the playhead. */
  const snap = useCallback(
    (sec: number, excludeClipId: string | null): number => {
      if (!snapping) return Math.max(0, sec)
      const candidates: number[] = [0]
      for (const clip of bundle.clips) {
        if (clip.id === excludeClipId) continue
        candidates.push(clip.startSec, clip.startSec + clip.durationSec)
      }
      for (const marker of bundle.markers) candidates.push(marker.atSec)
      candidates.push(playheadSec)
      let best = sec
      let bestDist = (SNAP_PX / pxPerSec) + 1e-9
      for (const c of candidates) {
        const d = Math.abs(c - sec)
        if (d < bestDist) {
          bestDist = d
          best = c
        }
      }
      return Math.max(0, best)
    },
    [bundle.clips, bundle.markers, playheadSec, pxPerSec, snapping],
  )


  // ---------------------------------------------------------------- draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size.w, size.h)

    // ---- ruler + adaptive ticks
    g.fillStyle = '#0d0b14'
    g.fillRect(0, 0, size.w, RULER_HEIGHT)
    const tickCandidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const tickStep = tickCandidates.find((s) => s * pxPerSec >= 70) ?? 600
    g.strokeStyle = '#3f3a4d'
    g.fillStyle = '#8f89a3'
    g.font = '10px "Inter Variable", system-ui, sans-serif'
    g.textBaseline = 'middle'
    const firstTick = Math.floor(scrollX / pxPerSec / tickStep) * tickStep
    for (let t = firstTick; xOf(t) < size.w; t += tickStep) {
      const x = xOf(t)
      if (x < -40) continue
      g.beginPath()
      g.moveTo(x + 0.5, RULER_HEIGHT - 8)
      g.lineTo(x + 0.5, RULER_HEIGHT)
      g.stroke()
      g.fillText(formatTimelineTime(t), x + 4, (RULER_HEIGHT - 4) / 2)
      // sub-ticks
      const sub = tickStep / 5
      for (let i = 1; i < 5; i++) {
        const sx = xOf(t + sub * i)
        g.beginPath()
        g.moveTo(sx + 0.5, RULER_HEIGHT - 4)
        g.lineTo(sx + 0.5, RULER_HEIGHT)
        g.stroke()
      }
    }
    // duration end marker
    const endX = xOf(bundle.durationSec)
    if (endX < size.w) {
      g.strokeStyle = '#f472b6'
      g.beginPath()
      g.moveTo(endX + 0.5, 0)
      g.lineTo(endX + 0.5, RULER_HEIGHT)
      g.stroke()
    }

    // ---- lanes
    for (const lane of lanes) {
      g.fillStyle = '#12101b'
      g.fillRect(0, lane.top, size.w, lane.height)
      g.strokeStyle = '#1e1a2c'
      g.beginPath()
      g.moveTo(0, lane.top + 0.5)
      g.lineTo(size.w, lane.top + 0.5)
      g.stroke()
      // beat grid inside lanes (1s)
      if (pxPerSec >= 40) {
        g.strokeStyle = '#191527'
        for (let t = firstTick; xOf(t) < size.w; t += 1) {
          const x = xOf(t)
          if (x < 0) continue
          g.beginPath()
          g.moveTo(x + 0.5, lane.top)
          g.lineTo(x + 0.5, lane.top + lane.height)
          g.stroke()
        }
      }
    }

    // ---- clips
    for (const clip of bundle.clips) {
      const lane = lanes.find((l) => l.track.id === clip.trackId)
      if (!lane) continue
      const cx = xOf(clip.startSec)
      const cw = Math.max(2, clip.durationSec * pxPerSec)
      if (cx + cw < 0 || cx > size.w) continue
      const cy = lane.top + 2
      const ch = lane.height - 4
      const palette = (CLIP_COLORS[lane.track.kind] ?? CLIP_COLORS.VIDEO)!
      const selected = clip.id === selectedClipId
      const src = bundle.sources[clip.sourceId]

      g.fillStyle = palette.fill
      g.beginPath()
      g.roundRect(cx, cy, cw, ch, 6)
      g.fill()
      g.lineWidth = selected ? 2 : 1
      g.strokeStyle = selected ? '#f472b6' : palette.stroke
      g.stroke()

      if (lane.track.kind === 'VIDEO' && src?.type === 'SHOT' && src.frameAssetId) {
        const img = thumbnails.current.get(src.frameAssetId)
        if (img && img.complete && img.naturalWidth > 0) {
          g.save()
          g.beginPath()
          g.roundRect(cx + 1, cy + 1, cw - 2, ch - 2, 5)
          g.clip()
          const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight)
          const dw = img.naturalWidth * scale
          const dh = img.naturalHeight * scale
          g.globalAlpha = 0.9
          g.drawImage(img, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh)
          g.restore()
        }
      } else if (lane.track.kind !== 'VIDEO' && src) {
        // Real waveform from decoded peaks.
        const assetId = src.type === 'MEDIA' ? src.assetId : src.audioAssetId
        const probe = assetId ? cachedPeaks(assetId) : null
        if (probe && cw > 8) {
          g.save()
          g.beginPath()
          g.roundRect(cx + 1, cy + 1, cw - 2, ch - 2, 5)
          g.clip()
          g.strokeStyle = palette.stroke
          g.globalAlpha = 0.85
          g.lineWidth = 1
          const mid = cy + ch / 2
          const usableW = cw - 8
          const peaksW = probe.peaks.length
          for (let px = 0; px < usableW; px += 2) {
            const idx = Math.floor((px / usableW) * peaksW)
            const v = probe.peaks[idx] ?? 0
            const h = Math.max(1, v * (ch / 2 - 4))
            g.beginPath()
            g.moveTo(cx + 4 + px, mid - h)
            g.lineTo(cx + 4 + px, mid + h)
            g.stroke()
          }
          g.restore()
        } else if (assetId) {
          void probeAsset(assetUrl(assetId), assetId).catch(() => undefined)
        }
      }

      // label
      if (cw > 34) {
        g.save()
        g.beginPath()
        g.roundRect(cx, cy, cw, ch, 6)
        g.clip()
        g.font = '10px "Inter Variable", system-ui, sans-serif'
        g.fillStyle = palette.text
        g.textBaseline = 'top'
        const label = clip.label.length > 40 ? `${clip.label.slice(0, 38)}…` : clip.label
        g.fillText(label, cx + 6, cy + 4)
        if (cw > 90) {
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.fillText(formatTimelineTime(clip.durationSec), cx + 6, cy + ch - 15)
        }
        g.restore()
      }
      // trim handles on selection
      if (selected) {
        g.fillStyle = '#f472b6'
        g.fillRect(cx, cy + ch / 2 - 10, HANDLE_PX, 20)
        g.fillRect(cx + cw - HANDLE_PX, cy + ch / 2 - 10, HANDLE_PX, 20)
      }
    }

    // ---- markers (ruler flags)
    for (const marker of bundle.markers) {
      const x = xOf(marker.atSec)
      if (x < -60 || x > size.w + 10) continue
      const sel = marker.id === selectedMarkerId
      g.fillStyle = sel ? '#f472b6' : '#fbbf24'
      g.beginPath()
      g.moveTo(x, 4)
      g.lineTo(x + 10, 10)
      g.lineTo(x, 16)
      g.closePath()
      g.fill()
      g.strokeStyle = 'rgba(251,191,36,0.5)'
      g.setLineDash([3, 4])
      g.beginPath()
      g.moveTo(x + 0.5, RULER_HEIGHT)
      g.lineTo(x + 0.5, size.h)
      g.stroke()
      g.setLineDash([])
    }

    // ---- playhead
    const px = xOf(playheadSec)
    if (px >= -20 && px <= size.w + 20) {
      g.strokeStyle = '#f472b6'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(px, 0)
      g.lineTo(px, size.h)
      g.stroke()
      g.fillStyle = '#f472b6'
      g.beginPath()
      g.moveTo(px - 6, 0)
      g.lineTo(px + 6, 0)
      g.lineTo(px, 9)
      g.closePath()
      g.fill()
    }
  }, [bundle, lanes, size, pxPerSec, scrollX, playheadSec, selectedClipId, selectedMarkerId, xOf])

  // ---------------------------------------------------------------- probe
  // Kick off waveform probes for every visible audio asset (idempotent).
  useEffect(() => {
    for (const clip of bundle.clips) {
      if (clip.trackId === '') continue
      const lane = lanes.find((l) => l.track.id === clip.trackId)
      if (!lane || lane.track.kind === 'VIDEO') continue
      const src = bundle.sources[clip.sourceId]
      if (!src) continue
      const assetId = src.type === 'MEDIA' ? src.assetId : src.audioAssetId
      if (assetId && !cachedPeaks(assetId)) {
        void probeAsset(assetUrl(assetId), assetId).catch(() => undefined)
      }
    }
  }, [bundle, lanes])

  // ---------------------------------------------------------- interactions
  const hitHandle = (x: number, clip: TimelineClip): 'L' | 'R' | null => {
    const cx = xOf(clip.startSec)
    const cw = clip.durationSec * pxPerSec
    if (x >= cx && x <= cx + HANDLE_PX + 2) return 'L'
    if (x >= cx + cw - HANDLE_PX - 2 && x <= cx + cw) return 'R'
    return null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    mouseRef.current = { x, y, inside: true }

    if (y < RULER_HEIGHT) {
      // Marker flag hit → select the marker (deletion happens via shortcut/UI).
      for (const marker of bundle.markers) {
        const mx = xOf(marker.atSec)
        if (x >= mx - 2 && x <= mx + 12) {
          props.onSelectMarker(marker.id)
          props.callbacks.onSelect(null)
          dragRef.current = { kind: 'none' }
          return
        }
      }
      props.onSelectMarker(null)
      props.callbacks.onSeek(snap(secOfX(x), null))
      dragRef.current = { kind: 'scrub' }
      setDragging(true)
      return
    }

    const hit = clipAt(x, y)
    if (!hit) {
      props.callbacks.onSelect(null)
      dragRef.current = { kind: 'none' }
      return
    }
    props.callbacks.onSelect(hit.clip.id)
    const handle = selectedClipId === hit.clip.id ? hitHandle(x, hit.clip) : null
    if (handle === 'L') {
      dragRef.current = {
        kind: 'trimL',
        clipId: hit.clip.id,
        lastStart: hit.clip.startSec,
        lastDur: hit.clip.durationSec,
        lastIn: hit.clip.inOffsetSec,
      }
    } else if (handle === 'R') {
      dragRef.current = { kind: 'trimR', clipId: hit.clip.id, lastDur: hit.clip.durationSec }
    } else {
      dragRef.current = {
        kind: 'move',
        clipId: hit.clip.id,
        grabOffsetSec: secOfX(x) - hit.clip.startSec,
        fromTrackId: hit.clip.trackId,
        lastStart: hit.clip.startSec,
        lastTrackId: hit.clip.trackId,
      }
    }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    mouseRef.current = { x, y, inside: true }
    const drag = dragRef.current
    if (drag.kind === 'none' || !dragging) {
      // cursor affordances
      if (drag.kind === 'none') {
        const hit = clipAt(x, y)
        const handle = hit && selectedClipId === hit.clip.id ? hitHandle(x, hit.clip) : null
        canvas.style.cursor = handle === 'L' || handle === 'R' ? 'ew-resize' : hit ? 'grab' : 'default'
      }
      return
    }
    if (drag.kind === 'scrub') {
      props.callbacks.onSeek(Math.max(0, secOfX(x)))
      return
    }
    const clip = bundle.clips.find((c) => c.id === drag.clipId)
    if (!clip) return

    if (drag.kind === 'move') {
      const lane = laneAt(y)
      let targetTrack = lane?.track.id === clip.trackId ? clip.trackId : lane?.track.id
      // Cross-track only within the same kind family.
      if (targetTrack && targetTrack !== clip.trackId && lane) {
        const target = lane.track
        const compatible =
          (clip.sourceType === 'SHOT' && (target.kind === 'VIDEO' || target.kind === 'VOICE')) ||
          (clip.sourceType === 'MEDIA' && target.kind !== 'VIDEO' && target.kind !== 'VOICE')
        if (!compatible) targetTrack = drag.lastTrackId
      }
      const rawStart = secOfX(x) - drag.grabOffsetSec
      const next = snap(Math.max(0, rawStart), clip.id)
      if (next !== drag.lastStart || targetTrack !== drag.lastTrackId) {
        drag.lastStart = next
        drag.lastTrackId = targetTrack ?? clip.trackId
        props.callbacks.onMoveClip(clip.id, next, targetTrack)
      }
    } else if (drag.kind === 'trimL') {
      const raw = snap(secOfX(x), clip.id)
      const maxStart = clip.startSec + clip.durationSec - 0.05
      const newStart = Math.max(0, Math.min(raw, maxStart))
      const delta = newStart - drag.lastStart
      const newDur = drag.lastDur - delta
      const newIn = Math.max(0, drag.lastIn + delta)
      if (newDur >= 0.05) {
        props.callbacks.onTrimClip(clip.id, { startSec: newStart, durationSec: newDur, inOffsetSec: newIn })
      }
    } else if (drag.kind === 'trimR') {
      const rawEnd = snap(secOfX(x), clip.id)
      const newDur = Math.max(0.05, rawEnd - clip.startSec)
      if (Math.abs(newDur - drag.lastDur) > 1e-3) {
        drag.lastDur = newDur
        props.callbacks.onTrimClip(clip.id, { startSec: clip.startSec, durationSec: newDur, inOffsetSec: clip.inOffsetSec })
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    dragRef.current = { kind: 'none' }
    setDragging(false)
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pxPerSec * factor))
      // Zoom around the cursor: keep the time under the cursor stable.
      const tAt = secOfX(x)
      props.onZoom(next)
      props.onScrollX(Math.max(0, tAt * next - x))
    } else {
      props.onScrollX(Math.max(0, scrollX + (e.deltaY !== 0 ? e.deltaY : e.deltaX) * 0.8))
    }
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          mouseRef.current.inside = false
        }}
        onWheel={onWheel}
      />
    </div>
  )
}
