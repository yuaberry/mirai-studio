/**
 * Episode Manager + Scene Manager (Modules 14/15):
 * episodes list → episode detail & scene list → scene editor with cast,
 * location, time of day and screenplay text (the "write dialogue" step).
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, ListVideo, Plus, Trash2, X } from 'lucide-react'
import {
  MiraiError,
  TASK_STATUSES,
  TIMES_OF_DAY,
  type EpisodeWithStats,
  type SceneRecord,
  type TimeOfDay,
} from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Spinner, Textarea } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal, Modal } from '../../system/Modal'
import {
  MEDIA_KIND_LABEL,
  MEDIA_ROLES,
  MEDIA_ROLE_LABEL,
  type MediaRole,
} from '@mirai/shared'
import {
  useEpisodes,
  useEpisodeMutations,
  useScenes,
  useSceneMutations,
  useCharacters,
  useLocations,
  useMediaLibrary,
  useMediaMutations,
} from '../../lib/queries'
import { invoke } from '../../lib/ipc'
import { toast } from '../../store/appStore'

const TIME_LABEL: Record<TimeOfDay, string> = {
  DAY: '☀ Day',
  NIGHT: '☾ Night',
  DAWN: '✦ Dawn',
  DUSK: '◐ Dusk',
  UNSPECIFIED: '—',
}

export function EpisodesPage() {
  const { data: episodes, isLoading, isError, error, refetch } = useEpisodes()
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false)

  const selected = useMemo(
    () => (episodes ?? []).find((e) => e.id === selectedEpisodeId) ?? null,
    [episodes, selectedEpisodeId],
  )

  useEffect(() => {
    if (!selectedEpisodeId && episodes && episodes.length > 0) {
      setSelectedEpisodeId(episodes[0]!.id)
    }
  }, [episodes, selectedEpisodeId])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r border-mirai-border px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-sm font-bold text-mirai-text">Episodes</h1>
          <Button size="sm" variant="primary" onClick={() => setNewEpisodeOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner className="h-4 w-4" />
            </div>
          ) : isError ? (
            <ErrorState
              title="Episodes failed to load"
              message={error instanceof MiraiError ? error.message : 'Unknown error'}
              onRetry={() => void refetch()}
            />
          ) : (episodes ?? []).length === 0 ? (
            <EmptyState
              icon={<ListVideo className="h-5 w-5" />}
              title="No episodes yet"
              description="Structure your work: S1E1 is waiting to be written."
              className="min-h-40"
            />
          ) : (
            <ul className="space-y-0.5">
              {(episodes ?? []).map((episode) => (
                <li key={episode.id}>
                  <button
                    onClick={() => setSelectedEpisodeId(episode.id)}
                    className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                      episode.id === selectedEpisodeId
                        ? 'bg-mirai-hover text-mirai-text'
                        : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text'
                    }`}
                  >
                    <p className="text-[10px] font-bold tracking-wider text-mirai-faint">
                      S{episode.season} · EP{episode.number}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-semibold">{episode.title}</p>
                    <p className="mt-0.5 text-[10px] text-mirai-faint">
                      {episode.sceneCount} {episode.sceneCount === 1 ? 'scene' : 'scenes'} · {episode.status.replaceAll('_', ' ')}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-r border-mirai-border px-6 py-6">
        {selected ? (
          <EpisodeDetail episode={selected} />
        ) : (
          <EmptyState
            icon={<ListVideo className="h-5 w-5" />}
            title="Select an episode"
            description="Or create the first one — scenes live inside episodes."
            className="h-full"
          />
        )}
      </div>

      <NewEpisodeModal
        open={newEpisodeOpen}
        onClose={() => setNewEpisodeOpen(false)}
        onCreate={(episode) => {
          setSelectedEpisodeId(episode.id)
          setNewEpisodeOpen(false)
        }}
      />
    </div>
  )
}

function EpisodeDetail({ episode }: { episode: EpisodeWithStats }) {
  const mutations = useEpisodeMutations()
  const { data: scenes, isLoading } = useScenes(episode.id)
  const sceneMutations = useSceneMutations()
  const [form, setForm] = useState({
    title: episode.title,
    season: String(episode.season),
    number: String(episode.number),
    synopsis: episode.synopsis ?? '',
    status: episode.status,
  })
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setForm({
      title: episode.title,
      season: String(episode.season),
      number: String(episode.number),
      synopsis: episode.synopsis ?? '',
      status: episode.status,
    })
  }, [episode])

  useEffect(() => {
    setSelectedSceneId(null)
  }, [episode.id])

  const dirty =
    form.title !== episode.title ||
    form.season !== String(episode.season) ||
    form.number !== String(episode.number) ||
    form.synopsis !== (episode.synopsis ?? '') ||
    form.status !== episode.status

  const save = () => {
    mutations.update.mutate(
      {
        id: episode.id,
        input: {
          season: Number(form.season) || 1,
          number: Number(form.number) || 0,
          title: form.title.trim(),
          synopsis: form.synopsis.trim() || undefined,
        },
      },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Episode saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  const selectedScene = (scenes ?? []).find((s) => s.id === selectedSceneId) ?? null

  return (
    <div className="flex h-full min-h-0 gap-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="w-16">
              <Label htmlFor="ep-season">Season</Label>
              <Input id="ep-season" className="h-8" value={form.season} onChange={(e) => setForm((f) => ({ ...f, season: e.target.value }))} />
            </div>
            <div className="w-16">
              <Label htmlFor="ep-number">Number</Label>
              <Input id="ep-number" className="h-8" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
            </div>
            <div className="min-w-0 flex-1">
              <Label htmlFor="ep-title">Title</Label>
              <Input id="ep-title" className="h-8" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_140px_auto_auto] items-end gap-2">
            <div>
              <Label htmlFor="ep-synopsis">Synopsis</Label>
              <Textarea id="ep-synopsis" rows={2} data-selectable="true" className="text-xs" value={form.synopsis} onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="ep-status">Status</Label>
              <Select
                id="ep-status"
                className="h-8 text-xs"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EpisodeWithStats['status'] }))}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" variant="primary" disabled={!dirty} loading={mutations.update.isPending} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-[11px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
              Scenes ({scenes?.length ?? 0})
            </h2>
            <Button
              size="sm"
              variant="outline"
              loading={sceneMutations.create.isPending}
              onClick={() =>
                sceneMutations.create.mutate(
                  { episodeId: episode.id, input: { title: 'New Scene' } },
                  {
                    onSuccess: (scene) => {
                      setSelectedSceneId(scene.id)
                      toast({ kind: 'success', title: 'Scene created' })
                    },
                    onError: (err) => toast({ kind: 'error', title: 'Create failed', description: err.message }),
                  },
                )
              }
            >
              <Plus className="h-3.5 w-3.5" /> New Scene
            </Button>
          </div>

          {isLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Spinner className="h-4 w-4" />
            </div>
          ) : (scenes ?? []).length === 0 ? (
            <EmptyState
              icon={<ListVideo className="h-5 w-5" />}
              title="No scenes yet"
              description="Scenes are the units of production — create the first and write the dialogue."
              className="min-h-32"
            />
          ) : (
            <ul className="space-y-1">
              {(scenes ?? []).map((scene, index) => (
                <li key={scene.id} className="panel group flex items-center gap-2 px-3 py-2">
                  <button
                    onClick={() => setSelectedSceneId(scene.id)}
                    className={`min-w-0 flex-1 text-left ${scene.id === selectedSceneId ? 'text-mirai-text' : 'text-mirai-dim'}`}
                  >
                    <p className="truncate text-xs font-semibold">
                      {index + 1}. {scene.title}
                    </p>
                    <p className="mt-0.5 text-[10px] text-mirai-faint">
                      {TIME_LABEL[scene.timeOfDay]} · {scene.characterIds.length} cast
                      {scene.locationId ? ' · location set' : ''}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      title="Move up"
                      className="rounded p-1 text-mirai-faint hover:bg-mirai-hover hover:text-mirai-text"
                      onClick={() => sceneMutations.move.mutate({ id: scene.id, episodeId: episode.id, direction: 'up' })}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      title="Move down"
                      className="rounded p-1 text-mirai-faint hover:bg-mirai-hover hover:text-mirai-text"
                      onClick={() => sceneMutations.move.mutate({ id: scene.id, episodeId: episode.id, direction: 'down' })}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      title="Delete scene"
                      className="rounded p-1 text-mirai-faint hover:bg-mirai-hover hover:text-mirai-danger"
                      onClick={() =>
                        sceneMutations.remove.mutate(
                          { id: scene.id, episodeId: episode.id },
                          { onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }) },
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ConfirmModal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={`Delete episode “${episode.title}”?`}
          description={`All ${episode.sceneCount} scene(s) inside are deleted with it. This cannot be undone.`}
          confirmLabel="Delete Episode"
          danger
          busy={mutations.remove.isPending}
          onConfirm={() =>
            mutations.remove.mutate(episode.id, {
              onSuccess: () => {
                setConfirmDelete(false)
                toast({ kind: 'success', title: 'Episode deleted' })
              },
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            })
          }
        />
      </div>

      <div className="min-w-0 flex-1 border-l border-mirai-border pl-6">
        {selectedScene ? (
          <SceneEditor key={selectedScene.id} scene={selectedScene} onClose={() => setSelectedSceneId(null)} />
        ) : (
          <EmptyState
            icon={<ListVideo className="h-5 w-5" />}
            title="Select a scene"
            description="Set the cast, the location, and write the dialogue."
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}

function SceneEditor({ scene, onClose }: { scene: SceneRecord; onClose: () => void }) {
  const mutations = useSceneMutations()
  const { data: characters } = useCharacters()
  const { data: locations } = useLocations()
  const { data: media } = useMediaLibrary('all')
  const mediaMutations = useMediaMutations()
  const queryClient = useQueryClient()
  const { data: sceneMedia } = useQuery({
    queryKey: ['scene-media', scene.id],
    queryFn: () =>
      invoke('media:listSceneMedia', { sceneId: scene.id }).then((r) => r.assignments),
  })

  const [mediaAssign, setMediaAssign] = useState<{ mediaId: string; role: MediaRole }>({
    mediaId: '',
    role: 'BACKGROUND',
  })

  const [form, setForm] = useState({
    title: scene.title,
    timeOfDay: scene.timeOfDay,
    locationId: scene.locationId ?? '',
    characterIds: scene.characterIds as string[],
    synopsis: scene.synopsis ?? '',
    screenplay: scene.screenplay ?? '',
    status: scene.status,
  })

  const dirty =
    form.title !== scene.title ||
    form.timeOfDay !== scene.timeOfDay ||
    form.locationId !== (scene.locationId ?? '') ||
    JSON.stringify(form.characterIds) !== JSON.stringify(scene.characterIds) ||
    form.synopsis !== (scene.synopsis ?? '') ||
    form.screenplay !== (scene.screenplay ?? '') ||
    form.status !== scene.status

  const save = () => {
    mutations.update.mutate(
      {
        id: scene.id,
        episodeId: scene.episodeId,
        input: {
          title: form.title.trim(),
          timeOfDay: form.timeOfDay,
          locationId: form.locationId || undefined,
          characterIds: form.characterIds,
          synopsis: form.synopsis.trim() || undefined,
          screenplay: form.screenplay.trim() || undefined,
        },
      },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Scene saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  const toggleCharacter = (id: string) => {
    setForm((f) => ({
      ...f,
      characterIds: f.characterIds.includes(id)
        ? f.characterIds.filter((c) => c !== id)
        : [...f.characterIds, id],
    }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col py-1">
      <div className="mb-3 flex items-center justify-between">
        <Badge tone="accent">Scene {scene.orderIndex + 1}</Badge>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" disabled={!dirty} loading={mutations.update.isPending} onClick={save}>
            Save Scene
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        <div>
          <Label htmlFor="sc-title">Title</Label>
          <Input id="sc-title" className="h-8" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sc-time">Time of day</Label>
            <Select
              id="sc-time"
              className="h-8 text-xs"
              value={form.timeOfDay}
              onChange={(e) => setForm((f) => ({ ...f, timeOfDay: e.target.value as TimeOfDay }))}
            >
              {TIMES_OF_DAY.map((t) => (
                <option key={t} value={t}>
                  {TIME_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sc-loc">Location</Label>
            <Select
              id="sc-loc"
              className="h-8 text-xs"
              value={form.locationId}
              onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
            >
              <option value="">— none —</option>
              {(locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label>
            Cast
            <span className="ml-2 font-normal text-mirai-faint">who is in this scene</span>
          </Label>
          {(characters ?? []).length === 0 ? (
            <p className="text-[11px] text-mirai-faint">Create characters first — they appear here.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(characters ?? []).map((character) => {
                const active = form.characterIds.includes(character.id)
                return (
                  <button
                    key={character.id}
                    onClick={() => toggleCharacter(character.id)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
                        : 'border-mirai-border-strong bg-mirai-panel text-mirai-faint hover:text-mirai-dim'
                    }`}
                  >
                    {character.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="sc-synopsis">Synopsis</Label>
          <Textarea
            id="sc-synopsis"
            rows={2}
            data-selectable="true"
            className="text-xs"
            value={form.synopsis}
            onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
          />
        </div>

        <div>
          {/* ---- Scene music / SFX assignment (real, feeds Build Timeline) ---- */}
          <div>
            <Label>
              Music, SFX & ambience
              <span className="ml-2 font-normal text-mirai-faint">imported in the Media Library</span>
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {(sceneMedia ?? []).map((a) => {
                const track = (media ?? []).find((m) => m.id === a.mediaId)
                return (
                  <span
                    key={a.mediaId}
                    className="flex items-center gap-1.5 rounded-full border border-mirai-pink/40 bg-mirai-pink/10 px-2.5 py-1 text-[11px] font-semibold text-mirai-pink"
                  >
                    {MEDIA_ROLE_LABEL[a.role]}: {track?.title ?? a.mediaId.slice(-4)}
                    <button
                      className="opacity-60 transition-opacity hover:opacity-100"
                      title="Remove from scene"
                      onClick={() =>
                        mediaMutations.removeFromScene.mutate({ sceneId: scene.id, mediaId: a.mediaId })
                      }
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Select
                className="h-7 w-44 text-[11px]"
                value={mediaAssign.mediaId}
                onChange={(e) => setMediaAssign((f) => ({ ...f, mediaId: e.target.value }))}
              >
                <option value="">Add a media track…</option>
                {(media ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {MEDIA_KIND_LABEL[m.kind]} — {m.title}
                  </option>
                ))}
              </Select>
              <Select
                className="h-7 w-36 text-[11px]"
                value={mediaAssign.role}
                onChange={(e) => setMediaAssign((f) => ({ ...f, role: e.target.value as MediaRole }))}
              >
                {MEDIA_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {MEDIA_ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={!mediaAssign.mediaId}
                onClick={() => {
                  mediaMutations.assignToScene.mutate(
                    { sceneId: scene.id, mediaId: mediaAssign.mediaId, role: mediaAssign.role, volume: 1 },
                    {
                      onSuccess: () => {
                        void queryClient.invalidateQueries({ queryKey: ['scene-media', scene.id] })
                        setMediaAssign((f) => ({ ...f, mediaId: '' }))
                      },
                    },
                  )
                }}
              >
                Assign
              </Button>
            </div>
          </div>

          <Label htmlFor="sc-screenplay">
            Screenplay
            <span className="ml-2 font-normal text-mirai-faint">
              sluglines, action, dialogue — free format for now (typed screenplay elements arrive in Phase 2+)
            </span>
          </Label>
          <Textarea
            id="sc-screenplay"
            rows={10}
            data-selectable="true"
            className="font-mono text-xs leading-relaxed"
            placeholder={'INT. ACADEMY ROOFTOP — NIGHT\n\nYuna and Mio lean on the railing, city lights below.\n\nYUNA\n"I will become strong enough to protect you."'}
            value={form.screenplay}
            onChange={(e) => setForm((f) => ({ ...f, screenplay: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="sc-status">Status</Label>
          <Select
            id="sc-status"
            className="h-8 text-xs"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as SceneRecord['status'] }))}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  )
}

function NewEpisodeModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (episode: { id: string }) => void
}) {
  const mutations = useEpisodeMutations()
  const { data: episodes } = useEpisodes()
  const [form, setForm] = useState({ season: '1', number: '', title: '', synopsis: '' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const existing = episodes ?? []
      const nextNumber = existing.filter((e) => e.season === Number(form.season)).length + 1
      setForm({ season: '1', number: String(nextNumber), title: '', synopsis: '' })
      setError(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!form.title.trim()) {
      setError('Give the episode a title.')
      return
    }
    mutations.create.mutate(
      {
        season: Number(form.season) || 1,
        number: Number(form.number) || 0,
        title: form.title.trim(),
        synopsis: form.synopsis.trim() || undefined,
      },
      {
        onSuccess: (episode) => {
          toast({ kind: 'success', title: `Episode created: ${episode.title}` })
          onCreate(episode)
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Episode"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutations.create.isPending} onClick={submit}>
            Create Episode
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-md border border-mirai-danger/30 bg-mirai-danger/10 px-3 py-2 text-xs text-mirai-danger">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ne-season">Season</Label>
          <Input id="ne-season" inputMode="numeric" value={form.season} onChange={(e) => setForm((f) => ({ ...f, season: e.target.value }))} />
        </div>
        <div>
          <Label htmlFor="ne-number">Number</Label>
          <Input id="ne-number" inputMode="numeric" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="ne-title">Title</Label>
          <Input
            id="ne-title"
            autoFocus
            placeholder="Petals of a Promise"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="ne-synopsis">Synopsis</Label>
          <Textarea
            id="ne-synopsis"
            rows={2}
            data-selectable="true"
            value={form.synopsis}
            onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  )
}
