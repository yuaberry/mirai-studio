/**
 * RenderPage — the Export Center (Phase 6).
 *
 * REAL renders: scene → MP4 and episode → MP4 through the job queue
 * (FFmpeg bakes the timeline: camera moves, effects, audio mixdown),
 * plus the outputs browser for the project's exports/ folder.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  EXPORT_PRESETS,
  QUALITY_LABEL,
  formatTimelineTime,
  type ExportPreset,
  type RenderQuality,
} from '@mirai/shared'
import { Clapperboard, Film, FolderOpen, Play, Trash2 } from 'lucide-react'
import {
  useEpisodes,
  useJobs,
  usePlugins,
  useRenderOutputs,
  useRenderMutations,
  useRenderStatus,
  useScenes,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Badge, Button, Select, Spinner } from '../../system/ui'
import { ConfirmModal } from '../../system/Modal'
import { EmptyState } from '../../system/EmptyState'
import { cn } from '../../lib/utils'

export function RenderPage() {
  const queryClient = useQueryClient()
  const { data: episodes } = useEpisodes()
  const { data: renderStatus } = useRenderStatus()
  const { data: jobs } = useJobs()
  const renderJobs = useMemo(
    () => (jobs ?? []).filter((j) => j.type === 'render.scene' || j.type === 'render.episode'),
    [jobs],
  )
  const activeRender = renderJobs.find((j) => j.status === 'RUNNING' || j.status === 'QUEUED')

  const [episodeId, setEpisodeId] = useState<string>('')
  const { data: scenes } = useScenes(episodeId || undefined)
  const [sceneId, setSceneId] = useState<string>('')
  const [presetId, setPresetId] = useState<string>(EXPORT_PRESETS[0]!.id)
  const [quality, setQuality] = useState<RenderQuality>('MASTER')
  // Plugin-contributed export presets (SUGGEST capability) — real render params.
  const { data: pluginRecords } = usePlugins()
  const pluginPresets = (pluginRecords ?? [])
    .filter((pl) => pl.enabled && pl.errors.length === 0)
    .flatMap((pl) =>
      pl.manifest.exportPresets.map((preset) => ({ ...preset, plugin: pl.manifest.name })),
    )
  const allPresets = [...EXPORT_PRESETS, ...pluginPresets]
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId && episodes && episodes.length > 0) setEpisodeId(episodes[0]!.id)
  }, [episodes, episodeId])
  useEffect(() => {
    if (scenes && scenes.length > 0 && !scenes.some((s) => s.id === sceneId)) {
      setSceneId(scenes[0]!.id)
    }
  }, [scenes, sceneId])

  const outputs = useRenderOutputs()
  const mutations = useRenderMutations()

  // Live outputs while a render finishes.
  useEffect(() => {
    if (!activeRender) return
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['render', 'outputs'] })
    }, 1500)
    return () => window.clearInterval(id)
  }, [activeRender, queryClient])

  const onRenderScene = () => {
    if (!sceneId) return
    mutations.renderScene.mutate(
      { sceneId, presetId, quality },
      {
        onSuccess: (jobId) =>
          toast({ kind: 'success', title: 'Scene render queued', description: `Job ${jobId.slice(-6)} — follow progress below.` }),
        onError: (err) => toast({ kind: 'error', title: 'Render failed', description: err.message }),
      },
    )
  }

  const onRenderEpisode = () => {
    if (!episodeId) return
    mutations.renderEpisode.mutate(
      { episodeId, presetId, quality },
      {
        onSuccess: () =>
          toast({ kind: 'success', title: 'Episode render queued', description: 'Every scene renders in order, then stitches losslessly.' }),
        onError: (err) => toast({ kind: 'error', title: 'Render failed', description: err.message }),
      },
    )
  }

  const preset: ExportPreset | undefined = allPresets.find(
    (p): p is ExportPreset => p.id === presetId && !('plugin' in p),
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-mirai-text">Render & Export</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
          FFmpeg bakes your timeline into a real MP4 — camera moves, effects and the full audio mix.
          Scenes render individually; episodes render every scene in order and stitch losslessly.
        </p>
      </div>

      {!renderStatus?.available && (
        <div className="panel mb-5 border-amber-400/30 bg-amber-400/5">
          <p className="text-xs text-amber-300">
            FFmpeg wasn't found on this system. Install it (e.g. <code>sudo apt install ffmpeg</code>)
            and restart the app to enable rendering.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ---- render cards ---- */}
        <div className="panel space-y-4 p-5">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-mirai-dim uppercase">
              <Clapperboard className="h-3.5 w-3.5" /> Export settings
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[10px] font-bold text-mirai-faint uppercase">Preset</p>
              <Select className="h-8 text-xs" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                {allPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.width}×{p.height} @ {p.fps}fps{'plugin' in p && p.plugin ? ` (plugin: ${p.plugin})` : ''}
                  </option>
                ))}
              </Select>
              {preset && (
                <p className="mt-1 text-[10px] leading-relaxed text-mirai-faint">{preset.description}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold text-mirai-faint uppercase">Quality</p>
              <Select
                className="h-8 text-xs"
                value={quality}
                onChange={(e) => setQuality(e.target.value as RenderQuality)}
              >
                {(Object.keys(QUALITY_LABEL) as RenderQuality[]).map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABEL[q]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[10px] text-mirai-faint">
                {quality === 'MASTER' ? 'CRF 18 · x264 medium · AAC' : 'CRF 30 · ultrafast (draft checks)'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-mirai-line pt-4">
            <div>
              <p className="mb-1 text-[10px] font-bold text-mirai-faint uppercase">Episode</p>
              <Select className="mb-2 h-8 text-xs" value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
                {(episodes ?? []).map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    S{ep.season}E{ep.number} — {ep.title}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="primary"
                className="w-full"
                disabled={!episodeId || !renderStatus?.available || !!activeRender}
                loading={mutations.renderEpisode.isPending}
                onClick={onRenderEpisode}
              >
                <Film className="h-3.5 w-3.5" /> Render Episode
              </Button>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold text-mirai-faint uppercase">Scene</p>
              <Select className="mb-2 h-8 text-xs" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
                {(scenes ?? []).map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.title}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!sceneId || !renderStatus?.available || !!activeRender}
                loading={mutations.renderScene.isPending}
                onClick={onRenderScene}
              >
                <Play className="h-3.5 w-3.5" /> Render Scene
              </Button>
            </div>
          </div>

          {/* live render progress */}
          {activeRender && (
            <div className="rounded-md border border-mirai-pink/30 bg-mirai-pink/5 p-3">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-mirai-pink">
                  {activeRender.type === 'render.episode' ? 'Episode' : 'Scene'} render —{' '}
                  {activeRender.status === 'RUNNING' ? 'encoding' : 'queued'}
                </span>
                <span className="font-mono text-mirai-dim">{activeRender.progress ?? 0}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-mirai-panel">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-mirai-pink to-mirai-violet transition-all"
                  style={{ width: `${Math.max(3, activeRender.progress ?? 0)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ---- outputs ---- */}
        <div className="panel flex max-h-[560px] flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold tracking-wider text-mirai-dim uppercase">Outputs</p>
            {outputs.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          {outputs.isError ? (
            <p className="text-xs text-red-400">Failed to list outputs.</p>
          ) : (outputs.data ?? []).length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-5 w-5" />}
              title="No renders yet"
              description="Rendered scenes and episodes appear here, ready to reveal in your file manager."
            />
          ) : (
            <div className="-mx-2 flex-1 overflow-y-auto px-2">
              {(outputs.data ?? []).map((out) => (
                <div
                  key={out.path}
                  className="mb-2 flex items-center gap-3 rounded-md border border-mirai-line bg-mirai-panel px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-mirai-text" title={out.fileName}>
                      {out.fileName}
                    </p>
                    <p className="text-[10px] text-mirai-faint">
                      {new Date(out.createdAt).toLocaleString()} ·{' '}
                      {(out.fileBytes / 1024 / 1024).toFixed(1)} MB
                      {out.durationSec !== null && ` · ${formatTimelineTime(out.durationSec)}`}
                      {out.resolution && ` · ${out.resolution}`}
                    </p>
                  </div>
                  <Badge
                    className={cn(
                      out.kind === 'EPISODE' && 'border-mirai-violet/40 text-mirai-violet',
                      out.kind === 'SCENE' && 'border-mirai-pink/40 text-mirai-pink',
                    )}
                  >
                    {out.kind}
                  </Badge>
                  <button
                    className="rounded p-1 text-mirai-faint transition-colors hover:bg-mirai-hover hover:text-mirai-text"
                    title="Reveal in file manager"
                    onClick={() => mutations.revealOutput.mutate(out.path)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-mirai-faint transition-colors hover:bg-mirai-hover hover:text-red-400"
                    title="Delete file"
                    onClick={() => setConfirmDelete(out.path)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            mutations.deleteOutput.mutate(confirmDelete, {
              onSuccess: () => toast({ kind: 'success', title: 'Output deleted' }),
              onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
            })
          }
          setConfirmDelete(null)
        }}
        title="Delete this render?"
        description="The MP4 file is permanently removed from exports/. Renders can always be re-run from the timeline."
        confirmLabel="Delete file"
        danger
      />
    </div>
  )
}
