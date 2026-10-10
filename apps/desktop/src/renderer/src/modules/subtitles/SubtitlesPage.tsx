/**
 * SubtitlesPage (Phase 4 wrap-up) — the Subtitle Studio: per-scene cue editor
 * with REAL SRT/VTT import & export. The cues also burn into scene renders
 * and overlay live in the Timeline preview.
 */
import { useEffect, useState } from 'react'
import {
  formatTimelineTime,
  type SubtitleRecord,
} from '@mirai/shared'
import { Captions, Download, Plus, Trash2, Upload } from 'lucide-react'
import {
  useEpisodes,
  useScenes,
  useSubtitleMutations,
  useSubtitles,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Button, Input, Select, Spinner } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'

export function SubtitlesPage() {
  const { data: episodes } = useEpisodes()
  const [episodeId, setEpisodeId] = useState('')
  const { data: scenes } = useScenes(episodeId || undefined)
  const [sceneId, setSceneId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<SubtitleRecord | null>(null)

  useEffect(() => {
    if (!episodeId && episodes && episodes.length > 0) setEpisodeId(episodes[0]!.id)
  }, [episodes, episodeId])
  useEffect(() => {
    if (scenes && scenes.length > 0 && !scenes.some((s) => s.id === sceneId)) {
      setSceneId(scenes[0]!.id)
    }
  }, [scenes, sceneId])

  const { data: subtitles, isLoading } = useSubtitles(sceneId || undefined)
  const mutations = useSubtitleMutations(sceneId || undefined)

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text">Subtitles</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            Per-scene subtitle cues. Import real .srt/.vtt files, fine-tune timing,
            export delivery files — and scene renders burn them in automatically.
          </p>
        </div>
        <Captions className="hidden h-6 w-6 text-mirai-faint md:block" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          className="h-8 w-48 text-xs"
          value={episodeId}
          onChange={(e) => {
            setEpisodeId(e.target.value)
            setSceneId('')
          }}
        >
          {(episodes ?? []).map((ep) => (
            <option key={ep.id} value={ep.id}>
              S{ep.season}E{ep.number} — {ep.title}
            </option>
          ))}
        </Select>
        <Select
          className="h-8 w-48 text-xs"
          value={sceneId}
          onChange={(e) => setSceneId(e.target.value)}
        >
          {(scenes ?? []).map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.title}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!sceneId}
            loading={mutations.importFile.isPending}
            onClick={() =>
              mutations.importFile.mutate(undefined, {
                onSuccess: (n) =>
                  toast({
                    kind: 'success',
                    title: `Imported ${n} cues`,
                    description: 'Existing cues for this scene were replaced.',
                  }),
                onError: (err) => {
                  if (err.message.includes('cancelled')) return
                  toast({ kind: 'error', title: 'Import failed', description: err.message })
                },
              })
            }
          >
            <Upload className="h-3.5 w-3.5" /> Import .srt/.vtt
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!sceneId || (subtitles ?? []).length === 0}
            loading={mutations.exportFile.isPending}
            onClick={() =>
              mutations.exportFile.mutate('srt', {
                onSuccess: (path) =>
                  toast({ kind: 'success', title: 'Exported', description: path }),
                onError: (err) =>
                  toast({ kind: 'error', title: 'Export failed', description: err.message }),
              })
            }
          >
            <Download className="h-3.5 w-3.5" /> Export SRT
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!sceneId || (subtitles ?? []).length === 0}
            onClick={() =>
              mutations.exportFile.mutate('vtt', {
                onSuccess: (path) =>
                  toast({ kind: 'success', title: 'Exported', description: path }),
              })
            }
          >
            VTT
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!sceneId}
            onClick={() => {
              const last = (subtitles ?? [])[(subtitles ?? []).length - 1]
              const start = last ? last.endSec : 0
              mutations.create.mutate(
                { startSec: start, endSec: start + 2, text: 'New subtitle' },
                { onError: (err) => toast({ kind: 'error', title: err.message }) },
              )
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add cue
          </Button>
        </div>
      </div>

      {!sceneId ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Captions className="h-5 w-5" />}
            title="No scenes yet"
            description="Create an episode scene first — subtitles are timed per scene."
          />
        </div>
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (subtitles ?? []).length === 0 ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Captions className="h-5 w-5" />}
            title="No subtitles in this scene"
            description="Import an .srt/.vtt file or add cues manually — they overlay in the Timeline preview and burn into scene renders."
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          {(subtitles ?? []).map((cue) => (
            <div
              key={cue.id}
              className="flex items-center gap-2 rounded-md border border-mirai-line bg-mirai-panel px-3 py-2"
            >
              <span className="font-mono text-[10px] text-mirai-faint">
                {formatTimelineTime(cue.startSec)} → {formatTimelineTime(cue.endSec)}
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Number(cue.startSec.toFixed(2))}
                className="h-6 w-16 rounded border border-mirai-line bg-mirai-bg px-1 text-[10px]"
                title="Start (s)"
                onChange={(e) =>
                  mutations.update.mutate({
                    id: cue.id,
                    patch: { startSec: Math.max(0, Number(e.target.value)) },
                  })
                }
              />
              <span className="text-[10px] text-mirai-faint">→</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Number(cue.endSec.toFixed(2))}
                className="h-6 w-16 rounded border border-mirai-line bg-mirai-bg px-1 text-[10px]"
                title="End (s)"
                onChange={(e) =>
                  mutations.update.mutate({ id: cue.id, patch: { endSec: Number(e.target.value) } })
                }
              />
              <Input
                className="h-7 flex-1 text-xs"
                value={cue.text}
                onChange={(e) => {
                  const text = e.target.value
                  if (text.trim().length > 0) {
                    mutations.update.mutate({ id: cue.id, patch: { text } })
                  }
                }}
              />
              <button
                className="rounded p-1 text-mirai-faint transition-colors hover:text-red-400"
                title="Delete cue"
                onClick={() => setConfirmDelete(cue)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) mutations.remove.mutate(confirmDelete.id)
          setConfirmDelete(null)
        }}
        title="Delete this subtitle?"
        description="The cue is removed from the scene. Imports/exports always re-run from the live list."
        confirmLabel="Delete cue"
        danger
      />
    </div>
  )
}
