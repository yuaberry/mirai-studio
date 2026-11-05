/**
 * MoodboardCard (v0.27, §7 Visual Dev Lab slice 1) — the project's
 * reference board inside the Style Bible: real images (asset pipeline),
 * captions, one palette color per item, orderable; the color strip at
 * the top is the board's color script.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Palette, Trash2 } from 'lucide-react'
import type { MoodboardItem } from '@mirai/shared'
import { Badge, Button, Input, Label } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { SkeletonList } from '../../system/Skeleton'
import { useMoodboard, useMoodboardMutations } from '../../lib/queries'
import { assetUrl } from '../../lib/queries'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

export function MoodboardCard() {
  const { data: items, isLoading, isError, refetch } = useMoodboard()
  const mutations = useMoodboardMutations()
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({})

  const palette = (items ?? [])
    .map((i) => i.color)
    .filter((c): c is string => c !== null)

  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-text uppercase">
            <Palette className="h-3.5 w-3.5 text-mirai-accent" /> <T k="Moodboard" />
          </h2>
          <p className="mt-1 text-[11px] text-mirai-faint">
            reference images + palette — the visual identity you collect, the color script your artists honor
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          loading={mutations.attach.isPending}
          title="Import a reference image (png/jpg/webp/gif)"
          onClick={() =>
            mutations.attach.mutate(undefined, {
              onSuccess: () => toast({ kind: 'success', title: 'Reference added to the board' }),
              onError: (err) => {
                if ((err as { code?: string }).code === 'CANCELLED') return
                toast({ kind: 'error', title: 'Import failed', description: err.message })
              },
            })
          }
        >
          <ImagePlus className="h-3.5 w-3.5" /> <T k="Add reference" />
        </Button>
      </div>

      {/* ---- color script strip ---- */}
      {palette.length > 0 ? (
        <div className="mb-4 flex items-center gap-2">
          <span className="font-display text-[9px] font-bold tracking-[0.2em] text-mirai-faint uppercase">
            <T k="Color script" />
          </span>
          <div className="flex h-4 flex-1 overflow-hidden rounded-full border border-mirai-border-strong">
            {palette.map((color, i) => (
              <span key={i} className="h-full flex-1" style={{ backgroundColor: color }} title={color} />
            ))}
          </div>
          <Badge tone="violet">{palette.length}</Badge>
        </div>
      ) : null}

      {isLoading ? (
        <SkeletonList rows={3} kind="card" />
      ) : isError ? (
        <p className="text-[11px] text-mirai-faint" role="button" onClick={() => void refetch()}>
          Failed to load the board — click to retry.
        </p>
      ) : (items ?? []).length === 0 ? (
        <EmptyState
          icon={<Palette className="h-5 w-5" />}
          title="No references yet"
          description="Collect the visual soul of your work — character art, settings, color swatches. Every image is a real file in the project."
          className="min-h-24"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {(items ?? []).map((item, i) => (
            <MoodboardTile
              key={item.id}
              item={item}
              isFirst={i === 0}
              isLast={i === (items ?? []).length - 1}
              captionDraft={captionDrafts[item.id] ?? item.caption ?? ''}
              onCaptionDraft={(v) => setCaptionDrafts((d) => ({ ...d, [item.id]: v }))}
              mutations={mutations}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MoodboardTile(props: {
  item: MoodboardItem
  isFirst: boolean
  isLast: boolean
  captionDraft: string
  onCaptionDraft: (v: string) => void
  mutations: ReturnType<typeof useMoodboardMutations>
}) {
  const { item, isFirst, isLast, captionDraft, onCaptionDraft, mutations } = props
  const [saved, setSaved] = useState(false)

  const save = () => {
    mutations.update.mutate(
      { id: item.id, input: { caption: captionDraft.trim() || undefined, color: item.color ?? undefined } },
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 1200)
        },
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <div className="group overflow-hidden rounded-lg border border-mirai-border bg-mirai-bg/50">
      <div className="relative">
        <img
          src={assetUrl(item.imageAssetId)}
          alt={item.caption ?? 'reference'}
          className="aspect-[4/3] w-full object-cover"
          draggable={false}
        />
        {item.color ? (
          <span
            className="absolute right-2 bottom-2 h-6 w-6 rounded-full border-2 border-white/80 shadow"
            style={{ backgroundColor: item.color }}
            title={item.color}
          />
        ) : null}
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="rounded bg-black/60 p-1 text-white hover:text-mirai-accent disabled:opacity-30"
            title="Move earlier"
            disabled={isFirst}
            onClick={() => mutations.move.mutate({ id: item.id, direction: 'up' })}
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            className="rounded bg-black/60 p-1 text-white hover:text-mirai-accent disabled:opacity-30"
            title="Move later"
            disabled={isLast}
            onClick={() => mutations.move.mutate({ id: item.id, direction: 'down' })}
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            className="rounded bg-black/60 p-1 text-white hover:text-red-400"
            title="Remove from the board"
            onClick={() =>
              mutations.remove.mutate(
                { id: item.id },
                { onError: (err) => toast({ kind: 'error', title: 'Remove failed', description: err.message }) },
              )
            }
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5 p-2">
        <Input
          className="h-7 text-[11px]"
          placeholder="caption — what this reference anchors"
          value={captionDraft}
          onChange={(e) => onCaptionDraft(e.target.value)}
          onBlur={save}
        />
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-mirai-faint">
            <T k="Swatch" />
          </Label>
          <input
            type="color"
            className="h-5 w-8 cursor-pointer rounded border border-mirai-border-strong bg-transparent"
            value={item.color ?? '#f472b6'}
            title="Pick this reference's palette color"
            onChange={(e) =>
              mutations.update.mutate(
                { id: item.id, input: { caption: item.caption ?? undefined, color: e.target.value } },
                {
                  onError: (err) =>
                    toast({ kind: 'error', title: 'Color save failed', description: err.message }),
                },
              )
            }
          />
          {saved ? <span className="text-[9px] font-semibold text-mirai-success">saved</span> : null}
        </div>
      </div>
    </div>
  )
}
