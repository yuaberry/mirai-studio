/**
 * PageCanvas (v0.25, §8 slice 2) — the manga page LAYOUT editor: a B5
 * aspect canvas where panels are boxes at page-relative coordinates.
 * Drag moves, corner handle resizes; manual coordinates commit to the
 * panel on release (lettering/shot link preserved). Auto-stack panels
 * become manual the moment they are dragged. Right-to-left pages
 * mirror exactly like the exported proof.
 */
import { useMemo, useRef, useState } from 'react'
import { mirrorX, type MangaPageRecord, type MangaPanelRecord } from '@mirai/shared'
import { Badge, Button } from '../../system/ui'
import { toast } from '../../store/appStore'
import { assetUrl } from '../../lib/queries'

interface Box {
  panel: MangaPanelRecord
  n: number
  x: number // 0..1, already mirrored for RTL
  y: number
  w: number
  h: number
}

const CLAMP01 = (v: number) => Math.min(1, Math.max(0, v))

export function PageCanvas(props: {
  page: MangaPageRecord
  panels: MangaPanelRecord[]
  rtl: boolean
  onCommit: (panel: MangaPanelRecord, coords: { x: number; y: number; w: number; h: number }) => void
}) {
  const { page, panels, rtl, onCommit } = props
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; startX: number; startY: number; box: Box } | null>(null)

  const boxes = useMemo<Box[]>(() => {
    const n = Math.max(panels.length, 1)
    const gap = 0.008
    const slice = (1 - gap * (n - 1)) / n
    return panels.map((panel, i) => {
      if (panel.coords) {
        return { panel, n: i + 1, x: mirrorX(panel.coords.x, panel.coords.w, rtl), y: panel.coords.y, w: panel.coords.w, h: panel.coords.h }
      }
      return { panel, n: i + 1, x: 0, y: i * (slice + gap), w: 1, h: slice }
    })
  }, [panels, rtl])

  const onPointerDown = (e: React.PointerEvent, box: Box, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: box.panel.id, mode, startX: e.clientX, startY: e.clientY, box })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / rect.width
    const dy = (e.clientY - drag.startY) / rect.height
    setDrag((d) => {
      if (!d) return d
      if (d.mode === 'move') {
        const nx = CLAMP01(d.box.x + dx)
        const ny = CLAMP01(d.box.y + dy)
        return { ...d, box: { ...d.box, x: Math.min(nx, 1 - d.box.w), y: Math.min(ny, 1 - d.box.h) } }
      }
      const nw = Math.min(1, Math.max(0.05, d.box.w + dx))
      const nh = Math.min(1, Math.max(0.05, d.box.h + dy))
      return { ...d, box: { ...d.box, w: nw, h: nh } }
    })
  }

  const onPointerUp = () => {
    if (!drag) return
    const b = drag.box
    // un-mirror for storage (coords are stored in LAYOUT space, mirrored on render)
    const storedX = mirrorX(b.x, b.w, rtl)
    onCommit(b.panel, { x: storedX, y: CLAMP01(b.y), w: b.w, h: b.h })
    setDrag(null)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge tone="accent">{rtl ? '↤ RTL page' : '↦ LTR page'}</Badge>
        <span className="text-[10px] text-mirai-faint">
          drag panels to place them · corner handle resizes · auto panels become manual on first drag
        </span>
      </div>
      <div
        ref={canvasRef}
        className="relative mx-auto w-full max-w-md overflow-hidden rounded border-2 border-mirai-border-strong bg-white"
        style={{ aspectRatio: '1200 / 1697' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {boxes.map((box) => {
          const isDragging = drag?.id === box.panel.id
          return (
            <div
              key={box.panel.id}
              className={`absolute cursor-grab select-none ${isDragging ? 'z-20 ring-2 ring-mirai-accent' : 'z-10'}`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
              onPointerDown={(e) => onPointerDown(e, box, 'move')}
            >
              <div className="relative h-full w-full overflow-hidden border-2 border-black bg-[#f4f4f5]">
                {box.panel.imageAssetId ? (
                  <img
                    src={assetUrl(box.panel.imageAssetId)}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-[10px] text-zinc-400">PANEL {box.n} — no art</span>
                  </div>
                )}
                {box.panel.lettering.length > 0 ? (
                  <span className="absolute left-1 top-1 rounded-full bg-mirai-accent/90 px-1.5 text-[9px] font-bold text-white">
                    {box.panel.lettering.length} 🗨
                  </span>
                ) : null}
                <span className="absolute bottom-0 left-0 bg-black px-1 text-[9px] font-bold leading-4 text-white">
                  {box.n}
                </span>
                <button
                  className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-black bg-mirai-accent"
                  title="Resize"
                  onPointerDown={(e) => onPointerDown(e, box, 'resize')}
                />
              </div>
            </div>
          )
        })}
        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 select-none text-[10px] text-zinc-500">
          — {page.number} —
        </span>
      </div>
    </div>
  )
}

/** Commits coords through the REAL panel update (lettering preserved). */
export function usePanelCoordsCommit(
  update: {
    mutate: (vars: { id: string; input: { shotId?: string; lettering: import('@mirai/shared').BubbleInput[]; coords?: { x: number; y: number; w: number; h: number } } }, opts?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void
  },
) {
  return (panel: MangaPanelRecord, coords: { x: number; y: number; w: number; h: number }) =>
    update.mutate(
      {
        id: panel.id,
        input: {
          shotId: panel.shotId,
          lettering: panel.lettering.map((b) => ({
            kind: b.kind,
            characterId: b.characterId,
            text: b.text,
            x: b.x,
            y: b.y,
            width: b.width,
            tail: b.tail,
          })),
          coords,
        },
      },
      {
        onError: (err) => toast({ kind: 'error', title: 'Layout save failed', description: err.message }),
      },
    )
}

export function CanvasHint({ onReset }: { onReset: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onReset} title="Reset all panels to auto-stack">
      auto layout
    </Button>
  )
}
