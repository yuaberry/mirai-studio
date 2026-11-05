/**
 * KeyframeEditor — the curve editor for the camera system, per-clip volume
 * automation and per-track mixer automation.
 *
 * An SVG plot draws the REAL sampled curve (using the same shared
 * interpolation as playback); keyframe dots are draggable, easing (incl.
 * cubic bézier) is per keyframe, and values are clamped to each param's
 * professional range.
 */
import { useMemo, useRef, useState } from 'react'
import {
  CAMERA_PARAMS,
  CAMERA_PARAM_LABEL,
  CAMERA_PARAM_RANGE,
  DEFAULT_BEZIER,
  EASING_LABEL,
  KEYFRAME_EASINGS,
  sampleCurve,
  type CameraParam,
  type KeyframeEasing,
  type KeyframeInput,
  type KeyframeRecord,
  type KeyframeTarget,
} from '@mirai/shared'
import { Diamond, Plus, Trash2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../../system/ui'

export type CurveTarget =
  | { type: 'CAMERA'; targetId: string; spanSec: number; param: CameraParam }
  | { type: 'CLIP'; targetId: string; spanSec: number; label: string }
  | { type: 'MIXER'; targetId: string; spanSec: number; label: string }
  | null

export interface KeyframeEditorProps {
  target: CurveTarget
  keyframes: KeyframeRecord[]
  playheadSec: number
  onUpsert: (kf: KeyframeInput) => void
  onDelete: (id: string) => void
  onSeek: (sec: number) => void
  /** Camera curves: switch the edited param. */
  onParamChange?: (param: CameraParam) => void
}

const PLOT_W = 100
const PLOT_H = 160

/** Volume param bounds (CLIP & MIXER curves). */
const VOLUME_RANGE: readonly [number, number] = [0, 2]

export function KeyframeEditor(props: KeyframeEditorProps) {
  const { target, keyframes, playheadSec } = props
  const [selectedKf, setSelectedKf] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ id: string } | null>(null)

  const param: string = target
    ? target.type === 'CAMERA'
      ? target.param
      : 'volume'
    : 'volume'
  const range = target?.type === 'CAMERA' ? CAMERA_PARAM_RANGE[target.param] : VOLUME_RANGE
  const spanSec = Math.max(0.1, target?.spanSec ?? 10)

  const curve = useMemo(
    () =>
      [...keyframes]
        .filter((k) => k.param === param)
        .sort((a, b) => a.atSec - b.atSec),
    [keyframes, param],
  )

  const toX = (sec: number) => (sec / spanSec) * PLOT_W
  const toY = (value: number) =>
    PLOT_H - ((Math.max(range[0], Math.min(range[1], value)) - range[0]) / (range[1] - range[0])) * PLOT_H

  const sampledPath = useMemo(() => {
    if (curve.length < 2) return ''
    const pts: string[] = []
    const steps = 160
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * spanSec
      const v = sampleCurve(curve, t)
      if (v === null) continue
      pts.push(`${i === 0 ? 'M' : 'L'}${toX(t).toFixed(2)},${toY(v).toFixed(2)}`)
    }
    return pts.join(' ')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, spanSec, range[0], range[1]])

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-[11px] leading-relaxed text-mirai-faint">
          Select a video clip to edit its camera curve,
          <br />
          or an audio clip/track for volume automation.
        </p>
      </div>
    )
  }

  const title =
    target.type === 'CAMERA'
      ? `Camera — ${CAMERA_PARAM_LABEL[target.param]}`
      : `Volume — ${target.label}`

  const addAt = (sec: number) => {
    const v = sampleCurve(curve, sec)
    props.onUpsert({
      targetType: target.type as KeyframeTarget,
      targetId: target.targetId,
      param,
      atSec: Math.max(0, Math.min(spanSec, sec)),
      value: v ?? range[0],
      easing: 'easeInOut',
    })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * PLOT_W
    const y = ((e.clientY - rect.top) / rect.height) * PLOT_H
    const sec = Math.max(0, Math.min(spanSec, (x / PLOT_W) * spanSec))
    const value = range[0] + (1 - y / PLOT_H) * (range[1] - range[0])
    const existing = curve.find((k) => k.id === drag.id)
    if (!existing) return
    props.onUpsert({
      targetType: existing.targetType,
      targetId: existing.targetId,
      param: existing.param,
      atSec: sec,
      value,
      easing: existing.easing,
      bezier: existing.bezier ?? undefined,
    })
  }

  const selected = curve.find((k) => k.id === selectedKf) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex flex-none items-center justify-between gap-2">
        <p className="truncate text-[11px] font-bold text-mirai-dim">{title}</p>
        <Button size="sm" variant="outline" onClick={() => addAt(Math.min(playheadSec, spanSec))} title="Add keyframe at playhead (K)">
          <Plus className="h-3 w-3" /> Key
        </Button>
      </div>

      {/* param tabs (camera only) */}
      {target.type === 'CAMERA' && (
        <ParamTabs current={target.param} onChange={(p) => props.onParamChange?.(p)} />
      )}

      <div className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="none"
          className="h-full w-full cursor-crosshair rounded-md border border-mirai-line bg-mirai-panel"
          onDoubleClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - rect.left) / rect.width) * PLOT_W
            addAt((x / PLOT_W) * spanSec)
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onPointerLeave={() => {
            dragRef.current = null
          }}
        >
          {/* grid */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={PLOT_W}
              y1={PLOT_H * f}
              y2={PLOT_H * f}
              stroke="#221d33"
              strokeWidth={0.5}
            />
          ))}
          <line x1={0} x2={PLOT_W} y1={PLOT_H / 2} y2={PLOT_H / 2} stroke="#2a2440" strokeWidth={0.7} />
          {/* sampled curve */}
          {sampledPath && <path d={sampledPath} fill="none" stroke="#e879f9" strokeWidth={1.2} />}
          {/* playhead */}
          <line
            x1={toX(Math.min(playheadSec, spanSec))}
            x2={toX(Math.min(playheadSec, spanSec))}
            y1={0}
            y2={PLOT_H}
            stroke="#f472b6"
            strokeWidth={0.8}
            strokeDasharray="2,2"
          />
          {/* keyframes */}
          {curve.map((kf) => (
            <g
              key={kf.id}
              transform={`translate(${toX(kf.atSec)},${toY(kf.value)})`}
              className="cursor-grab"
              onPointerDown={(e) => {
                e.stopPropagation()
                dragRef.current = { id: kf.id }
                setSelectedKf(kf.id)
              }}
            >
              <Diamond
                className={cn(
                  kf.id === selectedKf ? 'fill-mirai-pink stroke-white' : 'fill-mirai-violet stroke-mirai-pink',
                )}
                width={12}
                height={12}
              />
            </g>
          ))}
        </svg>
      </div>

      {/* selected keyframe panel */}
      {selected && (
        <div className="flex flex-none flex-col gap-1.5 rounded-md border border-mirai-line bg-mirai-panel p-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-mirai-faint uppercase">Easing</span>
            <select
              className="h-6 flex-1 rounded border border-mirai-line bg-mirai-bg px-1 text-[11px] text-mirai-text"
              value={selected.easing}
              onChange={(e) => {
                const easing = e.target.value as KeyframeEasing
                props.onUpsert({
                  targetType: selected.targetType,
                  targetId: selected.targetId,
                  param: selected.param,
                  atSec: selected.atSec,
                  value: selected.value,
                  easing,
                  bezier:
                    easing === 'bezier'
                      ? (selected.bezier ?? ([...DEFAULT_BEZIER] as [number, number, number, number]))
                      : null,
                })
              }}
            >
              {KEYFRAME_EASINGS.map((es) => (
                <option key={es} value={es}>
                  {EASING_LABEL[es]}
                </option>
              ))}
            </select>
            <button
              className="rounded bg-mirai-hover p-1 text-mirai-faint transition-colors hover:text-red-400"
              title="Delete keyframe"
              onClick={() => {
                props.onDelete(selected.id)
                setSelectedKf(null)
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {selected.easing === 'bezier' && selected.bezier && (
            <div className="flex items-center gap-2 text-[10px] text-mirai-faint">
              <span>P1</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selected.bezier[0]}
                onChange={(e) => {
                  const b = [...selected.bezier!] as [number, number, number, number]
                  b[0] = Number(e.target.value)
                  props.onUpsert({
                    targetType: selected.targetType,
                    targetId: selected.targetId,
                    param: selected.param,
                    atSec: selected.atSec,
                    value: selected.value,
                    easing: 'bezier',
                    bezier: b,
                  })
                }}
                className="h-1 flex-1 accent-mirai-pink"
              />
              <span>P2</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selected.bezier[2]}
                onChange={(e) => {
                  const b = [...selected.bezier!] as [number, number, number, number]
                  b[2] = Number(e.target.value)
                  props.onUpsert({
                    targetType: selected.targetType,
                    targetId: selected.targetId,
                    param: selected.param,
                    atSec: selected.atSec,
                    value: selected.value,
                    easing: 'bezier',
                    bezier: b,
                  })
                }}
                className="h-1 flex-1 accent-mirai-pink"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Camera param tabs — the parent swaps the target param. */
function ParamTabs({
  current,
  onChange,
}: {
  current: CameraParam
  onChange: (p: CameraParam) => void
}) {
  return (
    <div className="flex flex-none gap-1">
      {CAMERA_PARAMS.map((p) => (
        <button
          key={p}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors',
            p === current ? 'bg-mirai-pink/20 text-mirai-pink' : 'text-mirai-faint hover:bg-mirai-hover',
          )}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )
}
