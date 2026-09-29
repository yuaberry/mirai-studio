/**
 * Media Library (Phase 4) — Music, SFX & Ambience management.
 * Real files, real imports, real playback.
 */
import { useMemo, useState } from 'react'
import { Disc3, Music, Plus, Search, Trash2, Volume2, Zap } from 'lucide-react'
import {
  MiraiError,
  MEDIA_KINDS,
  MEDIA_KIND_LABEL,
  type MediaKind,
  type MediaTrack,
} from '@mirai/shared'
import { Badge, Button, Input, Label, Spinner, Textarea } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal, Modal } from '../../system/Modal'
import { useMediaLibrary, useMediaMutations, assetUrl } from '../../lib/queries'
import { toast } from '../../store/appStore'

const KIND_ICON: Record<string, typeof Music> = {
  MUSIC: Music,
  SFX: Zap,
  AMBIENCE: Volume2,
}

export function MediaLibraryPage() {
  const [kind, setKind] = useState<'all' | MediaKind>('all')
  const [search, setSearch] = useState('')
  const { data: tracks, isLoading, isError, error, refetch } = useMediaLibrary(kind)
  const mutations = useMediaMutations()
  const [editing, setEditing] = useState<MediaTrack | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MediaTrack | null>(null)

  const filtered = useMemo(() => {
    let list = tracks ?? []
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          (t.tags ?? '').toLowerCase().includes(needle),
      )
    }
    return list
  }, [tracks, search])

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text">Media Library</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            Music, sound effects and ambience for your production. Import real audio files —
            they're stored inside the project and available for every scene.
          </p>
        </div>
        <div className="flex gap-2">
          {(MEDIA_KINDS as readonly MediaKind[]).map((k) => {
            const Icon = KIND_ICON[k] ?? Music
            return (
              <Button
                key={k}
                size="sm"
                variant="outline"
                loading={mutations.import.isPending && mutations.import.variables === k}
                onClick={() =>
                  mutations.import.mutate(k, {
                    onSuccess: (track) =>
                      toast({ kind: 'success', title: `Imported: ${track.title}` }),
                    onError: (err) => {
                      if (err.message.includes('cancelled')) return
                      toast({ kind: 'error', title: 'Import failed', description: err.message })
                    },
                  })
                }
              >
                <Icon className="h-3.5 w-3.5" /> {MEDIA_KIND_LABEL[k]}
              </Button>
            )
          })}
        </div>
      </div>

      {/* filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <CategoryChip active={kind === 'all'} onClick={() => setKind('all')}>
          All ({(tracks ?? []).length})
        </CategoryChip>
        {MEDIA_KINDS.map((k) => (
          <CategoryChip key={k} active={kind === k} onClick={() => setKind(k)}>
            {MEDIA_KIND_LABEL[k]} ({(tracks ?? []).filter((t) => t.kind === k).length})
          </CategoryChip>
        ))}
        <div className="relative ml-auto w-64">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-mirai-faint" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search title, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* content */}
      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : isError ? (
        <ErrorState
          title="Media Library failed to load"
          message={error instanceof MiraiError ? error.message : 'Unknown error'}
          onRetry={() => void refetch()}
        />
      ) : filtered.length === 0 ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Disc3 className="h-5 w-5" />}
            title={search || kind !== 'all' ? 'No media matches' : 'Library is empty'}
            description={
              search || kind !== 'all'
                ? 'Try another filter.'
                : 'Import your OST, opening theme, battle themes and SFX — they live inside the project.'
            }
            className="min-h-40"
          />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((track) => (
            <div key={track.id} className="panel flex items-center gap-4 px-4 py-3">
              <Badge tone={track.kind === 'MUSIC' ? 'violet' : track.kind === 'SFX' ? 'warn' : 'info'}>
                {MEDIA_KIND_LABEL[track.kind]}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-mirai-text">{track.title}</p>
                {track.tags && <p className="mt-0.5 truncate text-[10px] text-mirai-faint">{track.tags}</p>}
              </div>
              {/* eslint-disable-next-line */}
              <audio controls preload="metadata" src={assetUrl(track.assetId)} className="h-8 w-56" />
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => mutations.reveal.mutate(track.id)}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(track)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(track)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* edit modal */}
      <EditModal track={editing} onClose={() => setEditing(null)} />

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        description="The track and its audio file are removed from the project. Scene assignments referencing it are also removed."
        confirmLabel="Delete Track"
        danger
        busy={mutations.remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return
          mutations.remove.mutate(confirmDelete.id, {
            onSuccess: () => {
              setConfirmDelete(null)
              toast({ kind: 'success', title: 'Track deleted' })
            },
            onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
          })
        }}
      />
    </div>
  )
}

function CategoryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
          : 'border-mirai-border-strong bg-mirai-panel text-mirai-faint hover:text-mirai-dim'
      }`}
    >
      {children}
    </button>
  )
}

function EditModal({ track, onClose }: { track: MediaTrack | null; onClose: () => void }) {
  const mutations = useMediaMutations()
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (track && !initialized) {
    setTitle(track.title)
    setTags(track.tags ?? '')
    setInitialized(true)
  }
  if (!track && initialized) setInitialized(false)

  const save = () => {
    if (!track || !title.trim()) return
    mutations.update.mutate(
      { id: track.id, title: title.trim(), tags: tags.trim() || undefined },
      {
        onSuccess: () => {
          toast({ kind: 'success', title: 'Track updated' })
          onClose()
        },
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  return (
    <Modal
      open={track !== null}
      onClose={onClose}
      title={`Edit "${track?.title ?? ''}"`}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutations.update.isPending} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="me-title">Title</Label>
          <Input id="me-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="me-tags">Tags</Label>
          <Textarea
            id="me-tags"
            rows={2}
            data-selectable="true"
            placeholder="opening, battle, emotional…"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  )
}
