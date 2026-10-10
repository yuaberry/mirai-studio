/**
 * Storyboard Studio (Modules 16/17) — shots per scene with professional
 * camera metadata and REAL frames (imported via native dialog, stored in
 * the project, served through the restricted mirai-asset:// protocol).
 *
 * Layout: episodes ▸ scenes (left) · shot strip (center) · shot editor (right).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Clapperboard,
  Box,
  Film,
  ImagePlus,
  LayoutGrid,
  Mic,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import {
  MiraiError,
  SHOT_TYPES,
  SHOT_TYPE_LABEL,
  CAMERA_MOVEMENTS,
  CAMERA_MOVEMENT_LABEL,
  LENS_PRESETS,
  TASK_STATUSES,
  type ShotRecord,
  type ShotType,
  type CameraMovement,
  type LensPreset,
} from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Spinner, Textarea } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'
import {
  useEpisodes,
  useScenes,
  useShots,
  useShotMutations,
  useAiStatus,
  useGenerateAllFrames,
  useGenerateFrame,
  useGenerateVideo,
  useBlenderActions,
  useBlenderStatus,
  useVoiceActions,
  useRecordDecision,
  useRenderStatus,
  useRenderShot,
  assetUrl,
} from '../../lib/queries'
import { VersionHistoryButton, VersionHistoryModal } from '../production/VersionHistoryModal'
import { toast } from '../../store/appStore'

export function StoryboardPage() {
  const { data: episodes, isLoading, isError, error, refetch } = useEpisodes()
  const shotMutations = useShotMutations()
  const generateAllFrames = useGenerateAllFrames()
  const { data: ai } = useAiStatus()
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const { data: scenes } = useScenes(episodeId ?? undefined)
  const [sceneId, setSceneId] = useState<string | null>(null)
  const { data: shots, isLoading: shotsLoading, isError: shotsError, error: shotsError_, refetch: refetchShots } = useShots(sceneId ?? undefined)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId && episodes && episodes.length > 0) {
      setEpisodeId(episodes[0]!.id)
    }
  }, [episodes, episodeId])

  useEffect(() => {
    if (scenes && scenes.length > 0) {
      if (!sceneId || !scenes.some((s) => s.id === sceneId)) {
        setSceneId(scenes[0]!.id)
      }
    } else {
      setSceneId(null)
    }
  }, [scenes, sceneId])

  useEffect(() => {
    setSelectedShotId(null)
  }, [sceneId])

  const selectedShot = useMemo(
    () => (shots ?? []).find((s) => s.id === selectedShotId) ?? null,
    [shots, selectedShotId],
  )

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (isError) {
    return (
      <ErrorState
        title="Storyboard failed to load"
        message={error instanceof MiraiError ? error.message : 'Unknown error'}
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------------------------------------- episodes ▸ scenes */}
      <div className="flex w-64 shrink-0 flex-col border-r border-mirai-border px-4 py-6">
        <h1 className="mb-3 font-display text-sm font-bold text-mirai-text">Storyboard</h1>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {(episodes ?? []).length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="h-5 w-5" />}
              title="No episodes"
              description="Create episodes and scenes first — shots live inside scenes."
              className="min-h-40"
            />
          ) : (
            (episodes ?? []).map((episode) => (
              <div key={episode.id} className="mb-3">
                <button
                  onClick={() => setEpisodeId(episode.id)}
                  className={`w-full rounded-md px-2.5 py-1.5 text-left transition-colors ${
                    episode.id === episodeId
                      ? 'bg-mirai-hover text-mirai-text'
                      : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text'
                  }`}
                >
                  <p className="text-[10px] font-bold tracking-wider text-mirai-faint">
                    S{episode.season} · EP{episode.number}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-semibold">{episode.title}</p>
                </button>
                {episode.id === episodeId && (
                  <ul className="mt-0.5 space-y-0.5 pl-2">
                    {(scenes ?? []).map((scene) => (
                      <li key={scene.id}>
                        <button
                          onClick={() => setSceneId(scene.id)}
                          className={`flex w-full items-center justify-between gap-1 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                            scene.id === sceneId
                              ? 'bg-mirai-panel text-mirai-text'
                              : 'text-mirai-faint hover:bg-mirai-hover/60 hover:text-mirai-dim'
                          }`}
                        >
                          <span className="truncate text-[11px] font-medium">
                            {scene.orderIndex + 1}. {scene.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-mirai-faint uppercase">
                            {scene.timeOfDay.slice(0, 1)}
                          </span>
                        </button>
                      </li>
                    ))}
                    {(scenes ?? []).length === 0 && (
                      <li className="px-2.5 py-1 text-[10px] text-mirai-faint">no scenes</li>
                    )}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- shot strip */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-mirai-border px-6 py-6">
        {!sceneId ? (
          <EmptyState
            icon={<LayoutGrid className="h-5 w-5" />}
            title="Select a scene"
            description="Pick a scene on the left — its shots appear here."
            className="h-full"
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-semibold text-mirai-text">
                  Shots ({shots?.length ?? 0})
                </h2>
                <p className="mt-0.5 text-[11px] text-mirai-faint">
                  Total runtime: {totalSeconds(shots ?? []).toFixed(1)}s
                </p>
              </div>
              <Button
                size="sm"
                variant="primary"
                loading={shotMutations.create.isPending}
                onClick={() =>
                  shotMutations.create.mutate(
                    { sceneId: sceneId!, input: { title: 'New Shot' } },
                    {
                      onSuccess: (shot) => {
                        setSelectedShotId(shot.id)
                        toast({ kind: 'success', title: 'Shot created' })
                      },
                      onError: (err) => toast({ kind: 'error', title: 'Create failed', description: err.message }),
                    },
                  )
                }
              >
                <Plus className="h-3.5 w-3.5" /> New Shot
              </Button>
              {(shots ?? []).some((sh) => !sh.frameAssetId) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-mirai-violet/40 text-mirai-violet"
                  loading={generateAllFrames.isPending}
                  disabled={!ai?.imageConfigured}
                  title={
                    ai?.imageConfigured
                      ? `Generate AI keyframes for the ${(shots ?? []).filter((sh) => !sh.frameAssetId).length} frameless shot(s) — Style Bible canon applies to every frame`
                      : 'Configure an image provider in Settings → Providers first'
                  }
                  onClick={() =>
                    generateAllFrames.mutate(sceneId!, {
                      onSuccess: (jobId) =>
                        toast({
                          kind: 'success',
                          title: 'Batch keyframes queued',
                          description: `Job ${jobId.slice(-6)} — every frame lands on its shot automatically.`,
                        }),
                      onError: (err) => toast({ kind: 'error', title: 'Batch failed', description: err.message }),
                    })
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" /> Generate All Frames
                </Button>
              )}
            </div>

            {shotsLoading ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner className="h-4 w-4" />
              </div>
            ) : shotsError ? (
              <ErrorState
                title="Shots failed to load"
                message={shotsError_ instanceof Error ? shotsError_.message : 'Unknown error'}
                onRetry={() => void refetchShots()}
              />
            ) : (shots ?? []).length === 0 ? (
              <EmptyState
                icon={<LayoutGrid className="h-5 w-5" />}
                title="No shots yet"
                description="Break the scene into shots — set framing, lens, movement, and import a frame image for each."
                className="min-h-40"
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {(shots ?? []).map((shot) => (
                    <ShotCard
                      key={shot.id}
                      shot={shot}
                      index={shot.orderIndex}
                      selected={shot.id === selectedShotId}
                      onSelect={() => setSelectedShotId(shot.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ----------------------------------------------------- shot editor */}
      <div className="w-[26rem] shrink-0 border-l border-mirai-border px-6 py-6">
        {selectedShot ? (
          <ShotEditor key={selectedShot.id} shot={selectedShot} onClose={() => setSelectedShotId(null)} />
        ) : (
          <EmptyState
            icon={<LayoutGrid className="h-5 w-5" />}
            title="Select a shot"
            description="Edit framing, lens, movement, timing, dialogue — and import the frame."
            className="h-full"
          />
        )}
      </div>
    </div>
  )
}

function totalSeconds(shots: ShotRecord[]): number {
  return shots.reduce((acc, shot) => acc + shot.durationSeconds, 0)
}

function ShotCard({
  shot,
  index,
  selected,
  onSelect,
}: {
  shot: ShotRecord
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const mutations = useShotMutations()
  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer overflow-hidden rounded-lg border transition-colors ${
        selected
          ? 'border-mirai-accent/50 bg-mirai-panel'
          : 'border-mirai-border bg-mirai-raise hover:border-mirai-border-strong'
      }`}
    >
      <div className="relative aspect-video bg-mirai-base">
        {shot.frameAssetId ? (
          <img
            src={assetUrl(shot.frameAssetId)}
            alt={shot.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-display text-2xl font-bold text-mirai-faint/60">
              {index + 1}
            </span>
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 font-display text-[10px] font-bold text-white">
          {index + 1}
        </div>
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            title="Move up"
            className="rounded bg-black/60 p-1 text-white/80 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              mutations.move.mutate(
                { id: shot.id, sceneId: shot.sceneId, direction: 'up' },
                { onError: (err) => toast({ kind: 'error', title: 'Move failed', description: err.message }) },
              )
            }}
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            title="Move down"
            className="rounded bg-black/60 p-1 text-white/80 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              mutations.move.mutate(
                { id: shot.id, sceneId: shot.sceneId, direction: 'down' },
                { onError: (err) => toast({ kind: 'error', title: 'Move failed', description: err.message }) },
              )
            }}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            title="Delete shot"
            className="rounded bg-black/60 p-1 text-mirai-danger/80 hover:text-mirai-danger"
            onClick={(e) => {
              e.stopPropagation()
              mutations.remove.mutate(
                { id: shot.id, sceneId: shot.sceneId },
                { onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }) },
              )
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[11px] font-semibold text-mirai-text">{shot.title}</p>
        <div className="mt-1 flex items-center gap-1">
          <Badge tone="neutral" className="!px-1.5 !text-[9px]">
            {SHOT_TYPE_LABEL[shot.shotType]}
          </Badge>
          <Badge tone="info" className="!px-1.5 !text-[9px]">
            {shot.lens}
          </Badge>
          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-mirai-faint">
            <Clock className="h-2.5 w-2.5" />
            {shot.durationSeconds}s
          </span>
        </div>
      </div>
    </div>
  )
}

function ShotEditor({ shot, onClose }: { shot: ShotRecord; onClose: () => void }) {
  const mutations = useShotMutations()
  const { data: ai } = useAiStatus()
  const generateFrame = useGenerateFrame()
  const generateVideo = useGenerateVideo()
  const blender = useBlenderActions()
  const { data: blenderStatus } = useBlenderStatus()
  const voice = useVoiceActions()
  const recordDecision = useRecordDecision()
  const { data: renderStatus } = useRenderStatus()
  const renderShot = useRenderShot()
  const [form, setForm] = useState({
    title: shot.title,
    shotType: shot.shotType,
    lens: shot.lens,
    cameraMovement: shot.cameraMovement,
    durationSeconds: String(shot.durationSeconds),
    dialogue: shot.dialogue ?? '',
    notes: shot.notes ?? '',
    status: shot.status,
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const dirty =
    form.title !== shot.title ||
    form.shotType !== shot.shotType ||
    form.lens !== shot.lens ||
    form.cameraMovement !== shot.cameraMovement ||
    form.durationSeconds !== String(shot.durationSeconds) ||
    form.dialogue !== (shot.dialogue ?? '') ||
    form.notes !== (shot.notes ?? '') ||
    form.status !== shot.status

  const save = () => {
    const duration = Number(form.durationSeconds)
    if (!Number.isFinite(duration) || duration <= 0) {
      toast({ kind: 'warning', title: 'Duration must be a positive number of seconds.' })
      return
    }
    mutations.update.mutate(
      {
        id: shot.id,
        sceneId: shot.sceneId,
        input: {
          title: form.title.trim(),
          shotType: form.shotType,
          lens: form.lens,
          cameraMovement: form.cameraMovement,
          durationSeconds: duration,
          dialogue: form.dialogue.trim() || undefined,
          notes: form.notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Shot saved' }),
        onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
      },
    )
  }

  const importFrame = () => {
    mutations.importFrame.mutate(shot.id, {
      onSuccess: (asset) =>
        toast({ kind: 'success', title: `Frame imported (${(asset.bytes / 1024).toFixed(0)} KB)` }),
      onError: (err) => {
        if (err.message.includes('cancelled')) return
        toast({ kind: 'error', title: 'Import failed', description: err.message })
      },
    })
  }

  const generateWithAi = () => {
    generateFrame.mutate(
      { shotId: shot.id },
      {
        onSuccess: () => {
          recordDecision.mutate({
            kind: 'image',
            summary: `Queued AI frame generation for shot "${shot.title}" (${shot.shotType}).`,
            shotId: shot.id,
          })
          toast({
            kind: 'info',
            title: 'Frame generation queued',
            description: 'Watch the Jobs panel — the result attaches here automatically.',
          })
        },
        onError: (err) =>
          toast({ kind: 'error', title: 'Generation failed to start', description: err.message }),
      },
    )
  }

  const generateShotVideo = () => {
    generateVideo.mutate(
      { shotId: shot.id, seconds: Math.min(20, Math.max(1, Math.round(shot.durationSeconds))) },
      {
        onSuccess: () => {
          recordDecision.mutate({
            kind: 'video',
            summary: `Queued AI video generation for shot "${shot.title}" (${shot.durationSeconds}s).`,
            shotId: shot.id,
          })
          toast({
            kind: 'info',
            title: 'Video generation queued',
            description: 'The real video file attaches to the shot — preview & render use it automatically.',
          })
        },
        onError: (err) =>
          toast({ kind: 'error', title: 'Video generation failed to start', description: err.message }),
      },
    )
  }

  const importVoice = () => {
    voice.importVoice.mutate(shot.id, {
      onSuccess: (asset) =>
        toast({ kind: 'success', title: `Voice line imported (${(asset.bytes / 1024).toFixed(0)} KB)` }),
      onError: (err) => {
        if (err.message.includes('cancelled')) return
        toast({ kind: 'error', title: 'Voice import failed', description: err.message })
      },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <Badge tone="accent">Shot {shot.orderIndex + 1}</Badge>
        <div className="flex items-center gap-1.5">
          <VersionHistoryButton onClick={() => setHistoryOpen(true)} />
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty} loading={mutations.update.isPending} onClick={save}>
            Save Shot
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {/* frame */}
        <div>
          <Label>
            Frame
            <span className="ml-2 font-normal text-mirai-faint">
              import a real image — stored inside the project
            </span>
          </Label>
          <div className="relative aspect-video overflow-hidden rounded-lg border border-mirai-border bg-mirai-base">
            {shot.frameAssetId ? (
              <img src={assetUrl(shot.frameAssetId)} alt={shot.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-mirai-faint">
                <LayoutGrid className="h-5 w-5" />
                <span className="text-[10px]">no frame yet</span>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" loading={mutations.importFrame.isPending} onClick={importFrame}>
              <ImagePlus className="h-3.5 w-3.5" /> {shot.frameAssetId ? 'Replace' : 'Import'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={generateFrame.isPending}
              disabled={!ai?.imageConfigured}
              title={
                ai?.imageConfigured
                  ? 'Generate this frame with AI — Style Bible + camera context'
                  : 'Configure an image provider in Settings → Providers first'
              }
              onClick={generateWithAi}
            >
              <Sparkles className="h-3.5 w-3.5" /> Generate (AI)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-mirai-violet/40 text-mirai-violet"
              loading={generateVideo.isPending}
              disabled={!ai?.configured}
              title={
                ai?.configured
                  ? 'Generate a real video clip for this shot (video provider — Settings → Providers)'
                  : 'Configure the chat + video provider in Settings → Providers first'
              }
              onClick={generateShotVideo}
            >
              <Film className="h-3.5 w-3.5" /> {shot.videoAssetId ? 'Regenerate' : 'Generate'} Video
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title={
                blenderStatus?.available
                  ? 'Attach your own Blender scene (.blend) — headless-rendered into a real shot video'
                  : 'Install Blender (blender.org) to use your own 3D scenes'
              }
              onClick={() =>
                blender.attachBlend.mutate(shot.id, {
                  onSuccess: (asset) =>
                    toast({ kind: 'success', title: 'Blender scene attached', description: asset.originalName }),
                  onError: (err) => {
                    if (err.message.includes('cancelled')) return
                    toast({ kind: 'error', title: 'Attach failed', description: err.message })
                  },
                })
              }
            >
              <Box className="h-3.5 w-3.5" /> {shot.blendAssetId ? 'Replace .blend' : 'Attach .blend'}
            </Button>
            {shot.blendAssetId && (
              <Button
                size="sm"
                variant="outline"
                className="border-mirai-cyan/40 text-mirai-cyan"
                disabled={!blenderStatus?.available}
                loading={blender.renderShot.isPending && blender.renderShot.variables === shot.id}
                title={
                  blenderStatus?.available
                    ? `Headless Blender render → real MP4 attached to this shot (${blenderStatus.version})`
                    : 'Blender not detected on this system'
                }
                onClick={() =>
                  blender.renderShot.mutate(shot.id, {
                    onSuccess: (jobId) =>
                      toast({
                        kind: 'success',
                        title: 'Blender render queued',
                        description: `Job ${jobId.slice(-6)} — the MP4 attaches automatically.`,
                      }),
                    onError: (err) => toast({ kind: 'error', title: 'Render failed', description: err.message }),
                  })
                }
              >
                <Box className="h-3.5 w-3.5" /> Render with Blender
              </Button>
            )}
            {shot.frameAssetId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  mutations.clearFrame.mutate(
                    { shotId: shot.id, sceneId: shot.sceneId },
                    { onError: (err) => toast({ kind: 'error', title: 'Failed', description: err.message }) },
                  )
                }
              >
                Clear
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              loading={renderShot.isPending}
              disabled={!renderStatus?.available || (!shot.frameAssetId && !shot.voiceAssetId)}
              title={
                !renderStatus?.available
                  ? 'FFmpeg not found on system PATH'
                  : !shot.frameAssetId && !shot.voiceAssetId
                    ? 'Shot needs a frame or voice line first'
                    : 'Render this shot to MP4 with FFmpeg'
              }
              onClick={() =>
                renderShot.mutate(shot.id, {
                  onSuccess: () =>
                    toast({
                      kind: 'info',
                      title: 'Shot render queued',
                      description: 'Watch the Jobs panel — the MP4 appears in exports/ when done.',
                    }),
                  onError: (err) =>
                    toast({ kind: 'error', title: 'Render failed to start', description: err.message }),
                })
              }
            >
              <Clapperboard className="h-3.5 w-3.5" /> Render MP4
            </Button>
          </div>
          {!ai?.imageConfigured && (
            <p className="mt-1.5 text-[10px] text-mirai-faint">
              AI frame generation needs an image provider (Settings → Providers).
            </p>
          )}
        </div>

        {/* voice line */}
        <div>
          <Label>
            Voice line
            <span className="ml-2 font-normal text-mirai-faint">audio for this shot</span>
          </Label>
          {shot.voiceAssetId ? (
            <div className="space-y-1.5">
              <audio
                controls
                preload="metadata"
                src={assetUrl(shot.voiceAssetId)}
                className="h-8 w-full"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" loading={voice.importVoice.isPending} onClick={importVoice}>
                  <Volume2 className="h-3.5 w-3.5" /> Replace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    voice.clearVoice.mutate(
                      { shotId: shot.id },
                      { onError: (err) => toast({ kind: 'error', title: 'Failed', description: err.message }) },
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" loading={voice.importVoice.isPending} onClick={importVoice}>
              <Mic className="h-3.5 w-3.5" /> Import Voice Line
            </Button>
          )}
        </div>

        <div>
          <Label htmlFor="sh-title">Title</Label>
          <Input
            id="sh-title"
            className="h-8"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sh-type">Shot type</Label>
            <Select
              id="sh-type"
              className="h-8 text-xs"
              value={form.shotType}
              onChange={(e) => setForm((f) => ({ ...f, shotType: e.target.value as ShotType }))}
            >
              {SHOT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SHOT_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sh-lens">Lens</Label>
            <Select
              id="sh-lens"
              className="h-8 text-xs"
              value={form.lens}
              onChange={(e) => setForm((f) => ({ ...f, lens: e.target.value as LensPreset }))}
            >
              {LENS_PRESETS.map((lens) => (
                <option key={lens}>{lens}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sh-move">Camera movement</Label>
            <Select
              id="sh-move"
              className="h-8 text-xs"
              value={form.cameraMovement}
              onChange={(e) =>
                setForm((f) => ({ ...f, cameraMovement: e.target.value as CameraMovement }))
              }
            >
              {CAMERA_MOVEMENTS.map((movement) => (
                <option key={movement} value={movement}>
                  {CAMERA_MOVEMENT_LABEL[movement]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sh-dur">Duration (s)</Label>
            <Input
              id="sh-dur"
              className="h-8"
              inputMode="decimal"
              value={form.durationSeconds}
              onChange={(e) => setForm((f) => ({ ...f, durationSeconds: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="sh-dlg">Dialogue / audio for this shot</Label>
          <Textarea
            id="sh-dlg"
            rows={3}
            data-selectable="true"
            className="font-mono text-xs"
            value={form.dialogue}
            onChange={(e) => setForm((f) => ({ ...f, dialogue: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="sh-notes">Direction notes</Label>
          <Textarea
            id="sh-notes"
            rows={3}
            data-selectable="true"
            className="text-xs"
            placeholder="Acting notes, VFX, transitions…"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="sh-status">Status</Label>
          <Select
            id="sh-status"
            className="h-8 text-xs"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ShotRecord['status'] }))}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <VersionHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entityType="SHOT"
        entityId={shot.id}
        entityLabel={shot.title}
      />

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete shot “${shot.title}”?`}
        description="The shot and its imported frame (if any) are removed from the project."
        confirmLabel="Delete Shot"
        danger
        busy={mutations.remove.isPending}
        onConfirm={() =>
          mutations.remove.mutate(
            { id: shot.id, sceneId: shot.sceneId },
            {
              onSuccess: () => {
                setConfirmDelete(false)
                toast({ kind: 'success', title: 'Shot deleted' })
              },
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            },
          )
        }
      />
    </div>
  )
}
