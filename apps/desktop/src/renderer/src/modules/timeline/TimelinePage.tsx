/**
 * TimelinePage (Phase 5) — the Editing workspace.
 *
 * Layout (custom dockable panels, sizes persisted in settings.editing):
 *   ┌ transport bar (scene picker · playback · zoom · snapping · build) ┐
 *   │ PreviewStage        │ Inspector / Keyframe editor (tabs)          │
 *   │─────────────────────│                                            │
 *   │ Mixer   │ TimelineCanvas (+ DOM track headers)                   │
 *
 * Playback is REAL: the engine mixes audio through Web Audio and the preview
 * composites video layers with camera keyframes at the playhead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AUDIO_TRACK_KINDS,
  formatTimelineTime,
  type CameraParam,
  type KeyframeInput,
  type KeyframeTarget,
  type TimelineBundle,
  type TimelineClip,
  type TrackKind,
} from '@mirai/shared'
import {
  GitCompareArrows,
  Layers,
  Magnet,
  PanelBottom,
  PanelLeft,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react'
import {
  useEpisodes,
  useScenes,
  useSettings,
  useUpdateSettings,
  useTimeline,
  useTimelineMutations,
  useSceneKeyframes,
  useKeyframes,
  useKeyframeMutations,
  assetUrl,
} from '../../lib/queries'
import { useAppStore, toast } from '../../store/appStore'
import { Button, Select, Spinner } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { ConfirmModal, Modal } from '../../system/Modal'
import { cn } from '../../lib/utils'
import { PlaybackEngine } from './PlaybackEngine'
import { TimelineCanvas, MAX_PPS, MIN_PPS } from './TimelineCanvas'
import { PreviewStage } from './PreviewStage'
import { MixerPanel } from './MixerPanel'
import { KeyframeEditor, type CurveTarget } from './KeyframeEditor'
import { InspectorPanel } from './InspectorPanel'
import { registerShortcutHandler } from '../../lib/shortcuts'

const DEFAULT_PPS = 60

interface DockSizes {
  previewW: number
  rightW: number
  timelineH: number
  mixerW: number
}

const DEFAULT_SIZES: DockSizes = { previewW: 0.62, rightW: 320, timelineH: 300, mixerW: 340 }

export function TimelinePage() {
  const setView = useAppStore((s) => s.setView)
  const { data: episodes } = useEpisodes()
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const { data: scenes } = useScenes(episodeId ?? undefined)
  const [sceneId, setSceneId] = useState<string | null>(null)
  useEffect(() => {
    if (episodeId === null && episodes && episodes.length > 0) setEpisodeId(episodes[0]!.id)
  }, [episodes, episodeId])
  useEffect(() => {
    if (scenes && scenes.length > 0) {
      if (!sceneId || !scenes.some((s) => s.id === sceneId)) setSceneId(scenes[0]!.id)
    } else {
      setSceneId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes])

  const { data: bundle, isLoading, isError, error } = useTimeline(sceneId ?? undefined)
  const mutations = useTimelineMutations(sceneId ?? undefined)

  // ---------------------------------------------------------------- view state
  const [playheadSec, setPlayheadSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PPS)
  const [scrollX, setScrollX] = useState(0)
  const [rightTab, setRightTab] = useState<'inspector' | 'curves'>('inspector')
  const [mixerTargetId, setMixerTargetId] = useState<string | null>(null)
  const [cameraParam, setCameraParam] = useState<CameraParam>('scale')
  const [addOpen, setAddOpen] = useState<{ trackId: string; kind: TrackKind } | null>(null)
  const [addTrackOpen, setAddTrackOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [probeTick, setProbeTick] = useState(0)

  const editing = settings?.editing
  const snapping = editing?.snapping ?? true
  const loop = editing?.loop ?? false
  const masterVolume = editing?.masterVolume ?? 1
  const layoutRaw = editing?.layout
  const dockRaw = useMemo(() => (layoutRaw ?? {}) as Partial<DockSizes>, [layoutRaw])
  const hiddenPanels = editing?.hiddenPanels ?? []
  const sizes: DockSizes = useMemo(() => ({ ...DEFAULT_SIZES, ...dockRaw }), [dockRaw])
  const previewHidden = hiddenPanels.includes('preview')
  const curvesHidden = hiddenPanels.includes('curves')
  const mixerHidden = hiddenPanels.includes('mixer')

  const persistLayout = useCallback(
    (patch: Partial<DockSizes>) => {
      void updateSettings.mutateAsync({
        ...settings,
        editing: { ...editing, layout: { ...sizes, ...patch } },
      } as never)
    },
    [updateSettings, settings, editing, sizes],
  )

  const persistEditing = useCallback(
    (patch: Record<string, unknown>) => {
      void updateSettings.mutateAsync({
        ...settings,
        editing: { ...editing, ...patch },
      } as never)
    },
    [updateSettings, settings, editing],
  )

  // ---------------------------------------------------------------- engine
  const engineRef = useRef<PlaybackEngine | null>(null)
  useEffect(() => {
    const engine = new PlaybackEngine({
      assetUrl,
      onTick: (state) => {
        setPlayheadSec(state.playheadSec)
        setPlaying(state.playing)
      },
    })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // Feed the engine the bundle + every keyframe curve of the scene in one pass.
  const { data: sceneKeyframes } = useSceneKeyframes(sceneId ?? undefined)
  void probeTick

  const keyframeMutations = useKeyframeMutations()

  useEffect(() => {
    engineRef.current?.setBundle(bundle ?? null)
  }, [bundle])
  useEffect(() => {
    engineRef.current?.setKeyframes(sceneKeyframes ?? [])
  }, [sceneKeyframes])
  useEffect(() => {
    engineRef.current?.setMasterVolume(masterVolume)
  }, [masterVolume])

  // Loop at the end: watch the tick.
  const loopRef = useRef(loop)
  loopRef.current = loop
  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current
      if (!engine) return
      if (!engine.isPlaying && loopRef.current && bundle && bundle.durationSec > 0) {
        // engine stopped at the end — restart when looping
        if (engine.playhead >= bundle.durationSec - 0.05) void engine.play()
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [bundle])

  // ---------------------------------------------------------------- actions
  const selectedClip = useMemo(
    () => (bundle && selectedClipId ? (bundle.clips.find((c) => c.id === selectedClipId) ?? null) : null),
    [bundle, selectedClipId],
  )

  const togglePlay = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.isPlaying) engine.pause()
    else void engine.play()
  }, [])

  const onStep = useCallback((deltaSec: number) => {
    const engine = engineRef.current
    if (!engine) return
    engine.pause()
    engine.seek(engine.playhead + deltaSec)
  }, [])

  const zoomFit = useCallback(() => {
    if (!bundle) return
    const width = window.innerWidth - sizes.mixerW - 40
    const pps = Math.min(MAX_PPS, Math.max(MIN_PPS, width / Math.max(bundle.durationSec, 1)))
    setPxPerSec(pps)
    setScrollX(0)
  }, [bundle, sizes.mixerW])

  const markersSorted = useMemo(
    () => [...(bundle?.markers ?? [])].sort((a, b) => a.atSec - b.atSec),
    [bundle],
  )
  const jumpMarker = useCallback(
    (dir: 1 | -1) => {
      const engine = engineRef.current
      if (!engine) return
      const t = engine.playhead
      const next =
        dir === 1
          ? markersSorted.find((m) => m.atSec > t + 0.01)
          : [...markersSorted].reverse().find((m) => m.atSec < t - 0.01)
      if (next) engine.seek(next.atSec)
    },
    [markersSorted],
  )

  const splitAtPlayhead = useCallback(() => {
    if (!selectedClip || !engineRef.current) return
    const t = engineRef.current.playhead
    mutations.clipSplit.mutate(
      { id: selectedClip.id, atSec: t },
      {
        onSuccess: () => toast({ kind: 'success', title: 'Clip split' }),
        onError: (err) => toast({ kind: 'error', title: 'Split failed', description: err.message }),
      },
    )
  }, [selectedClip, mutations.clipSplit])

  const deleteSelection = useCallback(
    (ripple: boolean) => {
      if (selectedMarkerId) {
        mutations.markerDelete.mutate(selectedMarkerId)
        setSelectedMarkerId(null)
        return
      }
      if (!selectedClip) return
      mutations.clipDelete.mutate(
        { id: selectedClip.id, ripple },
        {
          onSuccess: () => {
            setSelectedClipId(null)
            toast({ kind: 'success', title: ripple ? 'Ripple deleted' : 'Clip deleted' })
          },
          onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
        },
      )
    },
    [selectedClip, selectedMarkerId, mutations],
  )

  const addMarker = useCallback(() => {
    const engine = engineRef.current
    if (!engine || !sceneId) return
    mutations.markerCreate.mutate(
      { atSec: engine.playhead, label: `Marker ${(bundle?.markers.length ?? 0) + 1}` },
      {
        onSuccess: (marker) => setSelectedMarkerId(marker.id),
        onError: (err) => toast({ kind: 'error', title: 'Marker failed', description: err.message }),
      },
    )
  }, [sceneId, bundle, mutations.markerCreate, engineRef])

  // Camera keyframe at the playhead (K) — for the selected video clip.
  const cameraKeyframe = useCallback(
    (clip: TimelineClip | null) => {
      const target = clip ?? selectedClip
      if (!target || !engineRef.current) return
      const local = Math.max(0, engineRef.current.playhead - target.startSec)
      const kf: KeyframeInput = {
        targetType: 'CAMERA',
        targetId: target.sourceId,
        param: cameraParam,
        atSec: Number(local.toFixed(3)),
        value: cameraParam === 'opacity' ? 1 : cameraParam === 'scale' ? 1.2 : 10,
        easing: 'easeInOut',
      }
      keyframeMutations.upsert.mutate(kf, {
        onSuccess: () => {
          setRightTab('curves')
          toast({ kind: 'success', title: `Camera ${cameraParam} keyframe added` })
        },
      })
    },
    [selectedClip, cameraParam, engineRef, keyframeMutations],
  )

  const fadeClip = useCallback(
    (clip: TimelineClip, kind: 'in' | 'out') => {
      const dur = Math.min(1, clip.durationSec / 3)
      const at = kind === 'in' ? 0 : clip.durationSec - dur
      const list: KeyframeInput[] = [
        {
          targetType: 'CLIP',
          targetId: clip.id,
          param: 'volume',
          atSec: Number(at.toFixed(3)),
          value: kind === 'in' ? 0 : clip.volume,
          easing: 'easeInOut',
        },
        {
          targetType: 'CLIP',
          targetId: clip.id,
          param: 'volume',
          atSec: Number((at + dur).toFixed(3)),
          value: kind === 'in' ? clip.volume : 0,
          easing: 'easeInOut',
        },
      ]
      for (const kf of list) keyframeMutations.upsert.mutate(kf)
      toast({ kind: 'success', title: `Fade ${kind} (${dur.toFixed(1)}s)` })
    },
    [keyframeMutations],
  )

  const fitToSource = useCallback(
    (clip: TimelineClip) => {
      const src = bundle?.sources[clip.sourceId]
      if (!src) return
      void import('./waveform').then(({ cachedPeaks }) => {
        const assetId = src.type === 'MEDIA' ? src.assetId : src.audioAssetId
        const probe = assetId ? cachedPeaks(assetId) : null
        const duration = probe ? Math.max(0.05, probe.duration - clip.inOffsetSec) : clip.durationSec
        mutations.clipUpdate.mutate({ id: clip.id, patch: { durationSec: duration } })
      })
    },
    [bundle, mutations.clipUpdate],
  )

  // Re-render the inspector when a probe lands (Fit button enable state).
  useEffect(() => {
    const id = window.setInterval(() => setProbeTick((t) => t + 1), 1500)
    return () => window.clearInterval(id)
  }, [])

  // ---------------------------------------------------------------- shortcuts
  useEffect(() => {
    const cleanups = [
      registerShortcutHandler('timeline.togglePlay', togglePlay),
      registerShortcutHandler('timeline.stop', () => engineRef.current?.stop()),
      registerShortcutHandler('timeline.frameBack', () => onStep(-1 / 24)),
      registerShortcutHandler('timeline.frameFwd', () => onStep(1 / 24)),
      registerShortcutHandler('timeline.split', splitAtPlayhead),
      registerShortcutHandler('timeline.delete', () => deleteSelection(false)),
      registerShortcutHandler('timeline.rippleDelete', () => deleteSelection(true)),
      registerShortcutHandler('timeline.marker', addMarker),
      registerShortcutHandler('timeline.keyframe', () => cameraKeyframe(null)),
      registerShortcutHandler('timeline.zoomIn', () => setPxPerSec((p) => Math.min(MAX_PPS, p * 1.25))),
      registerShortcutHandler('timeline.zoomOut', () => setPxPerSec((p) => Math.max(MIN_PPS, p / 1.25))),
      registerShortcutHandler('timeline.zoomFit', zoomFit),
      registerShortcutHandler('timeline.snap', () => persistEditing({ snapping: !snapping })),
      registerShortcutHandler('timeline.prevMarker', () => jumpMarker(-1)),
      registerShortcutHandler('timeline.nextMarker', () => jumpMarker(1)),
    ]
    return () => cleanups.forEach((fn) => fn())
  }, [
    togglePlay,
    onStep,
    splitAtPlayhead,
    deleteSelection,
    addMarker,
    cameraKeyframe,
    zoomFit,
    persistEditing,
    snapping,
    jumpMarker,
  ])

  // ---------------------------------------------------------------- curve target
  const curveTarget: CurveTarget = useMemo(() => {
    if (mixerTargetId && bundle) {
      const track = bundle.tracks.find((t) => t.id === mixerTargetId)
      if (track) return { type: 'MIXER', targetId: track.id, spanSec: Math.max(1, bundle.durationSec), label: track.name }
    }
    if (selectedClip) {
      if (rightTab !== 'curves') return null
      const track = bundle?.tracks.find((t) => t.id === selectedClip.trackId)
      if (track?.kind === 'VIDEO') {
        return { type: 'CAMERA', targetId: selectedClip.sourceId, spanSec: selectedClip.durationSec, param: cameraParam }
      }
      return { type: 'CLIP', targetId: selectedClip.id, spanSec: selectedClip.durationSec, label: selectedClip.label }
    }
    return null
  }, [mixerTargetId, selectedClip, bundle, rightTab, cameraParam])

  const { data: curveKeyframes } = useKeyframes(
    (curveTarget?.type ?? 'CAMERA') as KeyframeTarget,
    curveTarget?.targetId,
    curveTarget?.type === 'CAMERA' ? cameraParam : undefined,
  )

  // ---------------------------------------------------------------- render
  if (episodes === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (episodes.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-16">
        <div className="panel">
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="No episodes yet"
            description="Create an episode and a scene first — the timeline assembles from its shots, voice lines and assigned music."
            action={
              <Button size="sm" variant="primary" onClick={() => setView('episodes')}>
                Go to Episodes & Scenes
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const scene = scenes?.find((s) => s.id === sceneId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------ transport bar */}
      <div className="flex flex-none items-center gap-2 border-b border-mirai-line px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Select
            className="h-7 w-44 text-xs"
            value={episodeId ?? ''}
            onChange={(e) => {
              setEpisodeId(e.target.value || null)
              setSceneId(null)
            }}
          >
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                S{ep.season}E{ep.number} — {ep.title}
              </option>
            ))}
          </Select>
          <Select
            className="h-7 w-44 text-xs"
            value={sceneId ?? ''}
            onChange={(e) => {
              setSceneId(e.target.value || null)
              setSelectedClipId(null)
              setSelectedMarkerId(null)
              engineRef.current?.stop()
            }}
          >
            {(scenes ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </div>

        <div className="mx-1 h-5 w-px bg-mirai-line" />

        <Button size="sm" variant="outline" onClick={() => setPxPerSec((p) => Math.min(MAX_PPS, p * 1.25))} title="Zoom in (=)">
          +
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPxPerSec((p) => Math.max(MIN_PPS, p / 1.25))} title="Zoom out (-)">
          −
        </Button>
        <Button size="sm" variant="outline" onClick={zoomFit} title="Zoom to fit (0)">
          Fit
        </Button>
        <Button
          size="sm"
          variant={snapping ? 'primary' : 'outline'}
          onClick={() => persistEditing({ snapping: !snapping })}
          title="Toggle snapping (Shift+S)"
        >
          <Magnet className="h-3.5 w-3.5" />
        </Button>

        <div className="mx-1 h-5 w-px bg-mirai-line" />

        <Button size="sm" variant="outline" disabled={!selectedClip} onClick={splitAtPlayhead} title="Split at playhead (S)">
          <Scissors className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={addMarker} title="Add marker (M)">
          <Plus className="h-3.5 w-3.5" /> Marker
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedClip && !selectedMarkerId}
          onClick={() => deleteSelection(false)}
          title="Delete (Del) · Ripple (Shift+Del)"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>

        <span className="ml-auto font-mono text-xs text-mirai-dim">
          {formatTimelineTime(playheadSec)} / {formatTimelineTime(bundle?.durationSec ?? 0)}
        </span>

        <Button
          size="sm"
          variant="primary"
          loading={mutations.build.isPending}
          onClick={() =>
            mutations.build.mutate(true, {
              onSuccess: (b) =>
                toast({
                  kind: 'success',
                  title: `Timeline assembled — ${b.tracks.length} tracks, ${b.clips.length} clips`,
                }),
              onError: (err) => toast({ kind: 'error', title: 'Build failed', description: err.message }),
            })
          }
          title="Assemble this scene's timeline from its shots, voice and media"
        >
          <Wand2 className="h-3.5 w-3.5" /> Build Timeline
        </Button>
      </div>

      {/* ------------------------------------------------ body */}
      {sceneId === null ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-mirai-faint">This episode has no scenes yet.</p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : isError ? (
        <div className="flex flex-1 items-center justify-center px-8">
          <p className="text-xs text-red-400">{error instanceof Error ? error.message : 'Timeline failed to load.'}</p>
        </div>
      ) : !bundle || bundle.tracks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="panel max-w-md border-dashed">
            <EmptyState
              icon={<GitCompareArrows className="h-5 w-5" />}
              title={`No timeline for "${scene?.title ?? 'this scene'}" yet`}
              description="Build it with one click — shots become video clips, voice lines align to their shots, and the scene's music/SFX/ambience drop on their tracks."
              action={
                <Button
                  size="sm"
                  variant="primary"
                  loading={mutations.build.isPending}
                  onClick={() =>
                    mutations.build.mutate(true, {
                      onSuccess: (b) => toast({ kind: 'success', title: `Assembled ${b.clips.length} clips` }),
                    })
                  }
                >
                  <Wand2 className="h-3.5 w-3.5" /> Build Timeline
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* top row: preview + right panel */}
          <div className="flex min-h-0 flex-1">
            {!previewHidden && (
              <div
                className="min-w-0 flex-1 p-3"
                style={{ flexGrow: sizes.previewW * 1000 }}
              >
                <PreviewStage
                  bundle={bundle}
                  playheadSec={playheadSec}
                  playing={playing}
                  loop={loop}
                  cameraKeyframes={sceneKeyframes ?? []}
                  onTogglePlay={togglePlay}
                  onStop={() => engineRef.current?.stop()}
                  onStep={onStep}
                  onToggleLoop={() => persistEditing({ loop: !loop })}
                  onOpenStoryboard={() => setView('storyboard')}
                />
              </div>
            )}
            <div className="flex min-h-0 flex-col" style={{ width: sizes.rightW }}>
              {/* right tabs */}
              <div className="flex flex-none gap-1 border-b border-mirai-line px-2 pt-2">
                <button
                  className={cn(
                    'rounded-t px-2.5 py-1 text-[11px] font-bold transition-colors',
                    rightTab === 'inspector' ? 'bg-mirai-panel text-mirai-text' : 'text-mirai-faint hover:text-mirai-dim',
                  )}
                  onClick={() => {
                    setRightTab('inspector')
                    setMixerTargetId(null)
                  }}
                >
                  Inspector
                </button>
                <button
                  className={cn(
                    'rounded-t px-2.5 py-1 text-[11px] font-bold transition-colors',
                    rightTab === 'curves' ? 'bg-mirai-panel text-mirai-text' : 'text-mirai-faint hover:text-mirai-dim',
                  )}
                  onClick={() => setRightTab('curves')}
                >
                  Curves
                </button>
                <button
                  className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-mirai-faint hover:text-mirai-text"
                  title={curvesHidden ? 'Show curves panel' : 'Hide curves panel'}
                  onClick={() => persistEditing({ hiddenPanels: togglePanel(hiddenPanels, 'curves') })}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-mirai-panel">
                {rightTab === 'inspector' ? (
                  <InspectorPanel
                    bundle={bundle}
                    clip={selectedClip}
                    playheadSec={playheadSec}
                    onClipPatch={(id, patch) =>
                      mutations.clipUpdate.mutate(
                        { id, patch: patch as never },
                        {
                          onError: (err) =>
                            toast({ kind: 'error', title: 'Update failed', description: err.message }),
                        },
                      )
                    }
                    onCameraKeyframe={(clip) => {
                      cameraKeyframe(clip)
                    }}
                    onFade={fadeClip}
                    onFitToSource={fitToSource}
                  />
                ) : curvesHidden ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-[11px] text-mirai-faint">Curves panel hidden — enable via the tab button.</p>
                  </div>
                ) : (
                  <KeyframeEditor
                    target={curveTarget}
                    keyframes={curveKeyframes ?? []}
                    playheadSec={
                      curveTarget?.type === 'CAMERA' || curveTarget?.type === 'CLIP'
                        ? Math.max(0, playheadSec - (selectedClip?.startSec ?? 0))
                        : playheadSec
                    }
                    onUpsert={(kf) => keyframeMutations.upsert.mutate(kf)}
                    onDelete={(id) => keyframeMutations.remove.mutate(id)}
                    onSeek={(sec) => engineRef.current?.seek(sec)}
                    onParamChange={setCameraParam}
                  />
                )}
              </div>
            </div>
          </div>

          {/* splitter */}
          <div
            className="h-1.5 flex-none cursor-row-resize bg-mirai-bg transition-colors hover:bg-mirai-pink/40"
            onPointerDown={(e) => {
              e.preventDefault()
              const startY = e.clientY
              const startH = sizes.timelineH
              const move = (ev: PointerEvent) => {
                const h = Math.max(140, Math.min(window.innerHeight - 260, startH - (ev.clientY - startY)))
                sizes.timelineH = h
                document.body.style.userSelect = 'none'
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                document.body.style.userSelect = ''
                persistLayout({ timelineH: sizes.timelineH })
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />

          {/* bottom row: mixer + timeline */}
          <div className="flex min-h-0 flex-none" style={{ height: sizes.timelineH }}>
            {!mixerHidden && (
              <div
                className="min-h-0 flex-none border-r border-mirai-line"
                style={{ width: sizes.mixerW }}
              >
                <MixerPanel
                  bundle={bundle}
                  mixerKeyframes={sceneKeyframes ?? []}
                  masterVolume={masterVolume}
                  onTrackUpdate={(id, patch) => mutations.trackUpdate.mutate({ id, patch })}
                  onTrackDelete={(id) =>
                    mutations.trackDelete.mutate(id, {
                      onError: (err) => toast({ kind: 'error', title: 'Delete failed', description: err.message }),
                    })
                  }
                  onMasterVolume={(v) => persistEditing({ masterVolume: v })}
                  onAutomate={(trackId) => {
                    setMixerTargetId(trackId)
                    setRightTab('curves')
                  }}
                  onAddTrack={() => setAddTrackOpen(true)}
                />
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* track headers */}
              <TrackHeaders
                bundle={bundle}
                mixerHidden={mixerHidden}
                previewHidden={previewHidden}
                onTogglePanel={(p) => persistEditing({ hiddenPanels: togglePanel(hiddenPanels, p) })}
                onReset={() => setConfirmReset(true)}
                onTrackUpdate={(id, patch) => mutations.trackUpdate.mutate({ id, patch })}
                onTrackMove={(id, dir) => {
                  const track = bundle.tracks.find((t) => t.id === id)
                  if (!track) return
                  mutations.trackMove.mutate({ id, toIndex: Math.max(0, track.orderIndex + dir) })
                }}
                onAddClip={(trackId, kind) => setAddOpen({ trackId, kind })}
              />
              {/* canvas */}
              <div className="min-h-0 flex-1">
                <TimelineCanvas
                  bundle={bundle}
                  pxPerSec={pxPerSec}
                  scrollX={scrollX}
                  playheadSec={playheadSec}
                  selectedClipId={selectedClipId}
                  selectedMarkerId={selectedMarkerId}
                  snapping={snapping}
                  onScrollX={setScrollX}
                  onZoom={setPxPerSec}
                  onSelectMarker={setSelectedMarkerId}
                  callbacks={{
                    onSeek: (sec) => engineRef.current?.seek(sec),
                    onSelect: (id) => {
                      setSelectedClipId(id)
                      if (id) setSelectedMarkerId(null)
                    },
                    onMoveClip: (id, startSec, toTrackId) => {
                      mutations.clipMove.mutate(
                        { id, startSec, toTrackId },
                        {
                          onError: (err) =>
                            toast({ kind: 'error', title: 'Move blocked', description: err.message }),
                        },
                      )
                    },
                    onTrimClip: (id, patch) => {
                      mutations.clipUpdate.mutate(
                        { id, patch: patch as never },
                        {
                          onError: (err) =>
                            toast({ kind: 'error', title: 'Trim blocked', description: err.message }),
                        },
                      )
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* add track modal */}
      {addTrackOpen && sceneId && (
        <Modal open title="Add audio track" onClose={() => setAddTrackOpen(false)} width="max-w-md">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-mirai-faint">
              Pick a lane kind — clips of that media type can then be placed on it.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {AUDIO_TRACK_KINDS.filter((k) => !bundle?.tracks.some((t) => t.kind === k)).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    mutations.trackCreate.mutate(
                      { kind },
                      {
                        onSuccess: () => toast({ kind: 'success', title: `${kind} track added` }),
                        onError: (err) => toast({ kind: 'error', title: 'Failed', description: err.message }),
                      },
                    )
                    setAddTrackOpen(false)
                  }}
                >
                  {kind}
                </Button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* reset confirm */}
      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false)
          mutations.reset.mutate(undefined, {
            onSuccess: () => {
              setSelectedClipId(null)
              setSelectedMarkerId(null)
              engineRef.current?.stop()
              toast({ kind: 'success', title: 'Timeline reset' })
            },
          })
        }}
        danger
        title="Reset this scene's timeline?"
        description="All tracks, clips and markers of this scene are removed. Keyframes are cleaned up. This can't be undone — but the shots/voice/media themselves stay untouched."
        confirmLabel="Reset timeline"
      />

      {/* add clip modal */}
      {addOpen && bundle && (
        <AddClipModal
          open
          bundle={bundle}
          trackId={addOpen.trackId}
          kind={addOpen.kind}
          onClose={() => setAddOpen(null)}
          onCreate={(input) => {
            mutations.clipCreate.mutate(input, {
              onSuccess: () => toast({ kind: 'success', title: 'Clip added' }),
              onError: (err) => toast({ kind: 'error', title: 'Add failed', description: err.message }),
            })
          }}
        />
      )}
    </div>
  )
}

function togglePanel(hidden: string[], panel: string): string[] {
  return hidden.includes(panel) ? hidden.filter((p) => p !== panel) : [...hidden, panel]
}

// ---------------------------------------------------------------- track headers

function TrackHeaders({
  bundle,
  mixerHidden,
  previewHidden,
  onTogglePanel,
  onReset,
  onTrackUpdate,
  onTrackMove,
  onAddClip,
}: {
  bundle: TimelineBundle
  mixerHidden: boolean
  previewHidden: boolean
  onTogglePanel: (p: 'mixer' | 'preview') => void
  onReset: () => void
  onTrackUpdate: (id: string, patch: { muted?: boolean; solo?: boolean; volume?: number; pan?: number }) => void
  onTrackMove: (id: string, dir: number) => void
  onAddClip: (trackId: string, kind: TrackKind) => void
}) {
  return (
    <div className="flex flex-none items-center gap-2 overflow-x-auto border-b border-mirai-line bg-mirai-bg px-2 py-1">
      <button
        className="rounded p-1 text-mirai-faint hover:text-red-400"
        title="Reset timeline (clears tracks & clips)"
        onClick={onReset}
      >
        <RotateCcw className="h-3 w-3" />
      </button>
      <button
        className={cn(
          'rounded p-1 transition-colors',
          previewHidden ? 'text-mirai-faint hover:text-mirai-pink' : 'text-mirai-pink',
        )}
        title={previewHidden ? 'Show preview' : 'Hide preview'}
        onClick={() => onTogglePanel('preview')}
      >
        <PanelLeft className="h-3 w-3" />
      </button>
      <button
        className={cn(
          'rounded p-1 transition-colors',
          mixerHidden ? 'text-mirai-faint hover:text-mirai-pink' : 'text-mirai-pink',
        )}
        title={mixerHidden ? 'Show mixer' : 'Hide mixer'}
        onClick={() => onTogglePanel('mixer')}
      >
        <PanelBottom className="h-3 w-3" />
      </button>
      <div className="h-4 w-px flex-none bg-mirai-line" />
      {bundle.tracks.map((track) => (
        <div key={track.id} className="flex flex-none items-center gap-1 rounded bg-mirai-panel px-1.5 py-0.5">
          <span className="text-[10px] font-bold text-mirai-dim">{track.name}</span>
          <span className="text-[9px] text-mirai-faint">{track.kind.slice(0, 3)}</span>
          {track.kind !== 'VIDEO' && (
            <>
              <button
                className={cn(
                  'rounded px-1 text-[9px] font-bold',
                  track.muted ? 'bg-red-500/70 text-black' : 'text-mirai-faint hover:text-mirai-text',
                )}
                title="Mute"
                onClick={() => onTrackUpdate(track.id, { muted: !track.muted })}
              >
                M
              </button>
              <button
                className={cn(
                  'rounded px-1 text-[9px] font-bold',
                  track.solo ? 'bg-amber-400/90 text-black' : 'text-mirai-faint hover:text-mirai-text',
                )}
                title="Solo"
                onClick={() => onTrackUpdate(track.id, { solo: !track.solo })}
              >
                S
              </button>
            </>
          )}
          <button
            className="rounded p-0.5 text-mirai-faint hover:text-mirai-pink"
            title="Add clip to this track"
            onClick={() => onAddClip(track.id, track.kind)}
          >
            <Plus className="h-3 w-3" />
          </button>
          <div className="flex flex-col">
            <button
              className="text-[8px] leading-none text-mirai-faint hover:text-mirai-text"
              title="Move up"
              onClick={() => onTrackMove(track.id, -1)}
            >
              ▲
            </button>
            <button
              className="text-[8px] leading-none text-mirai-faint hover:text-mirai-text"
              title="Move down"
              onClick={() => onTrackMove(track.id, 1)}
            >
              ▼
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- add clip modal

function AddClipModal({
  open,
  bundle,
  trackId,
  kind,
  onClose,
  onCreate,
}: {
  open: boolean
  bundle: TimelineBundle
  trackId: string
  kind: TrackKind
  onClose: () => void
  onCreate: (input: { trackId: string; sourceType: 'SHOT' | 'MEDIA'; sourceId: string; startSec: number; durationSec: number; inOffsetSec: number }) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [startSec, setStartSec] = useState(0)
  const [duration, setDuration] = useState(3)

  const options = useMemo(() => {
    if (kind === 'VIDEO' || kind === 'VOICE') {
      return Object.values(bundle.sources)
        .filter((s): s is Extract<typeof s, { type: 'SHOT' }> => s.type === 'SHOT')
        .map((s) => ({
          id: s.shotId,
          label: s.title,
          duration: s.durationSec,
          hasAudio: s.audioAssetId !== null,
        }))
    }
    return Object.values(bundle.sources)
      .filter((s): s is Extract<typeof s, { type: 'MEDIA' }> => s.type === 'MEDIA' && s.mediaKind === kind)
      .map((s) => ({ id: s.mediaId, label: s.title, duration: 10, hasAudio: true }))
  }, [bundle.sources, kind])

  const needsAudio = kind === 'VOICE'

  return (
    <Modal open={open} title={`Add ${kind.toLowerCase()} clip`} onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3">
        {options.length === 0 ? (
          <p className="text-xs text-mirai-faint">
            {needsAudio
              ? 'No shots with imported voice lines. Record/import voices in the Storyboard first.'
              : kind === 'VIDEO'
                ? 'No shots in this scene yet — create them in the Storyboard.'
                : `No ${kind.toLowerCase()} in the Media Library assigned to this scene. Import media first.`}
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-md border border-mirai-line">
            {options.map((opt) => (
              <button
                key={opt.id}
                className={cn(
                  'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors',
                  selected === opt.id ? 'bg-mirai-pink/15 text-mirai-text' : 'text-mirai-dim hover:bg-mirai-hover',
                  needsAudio && !opt.hasAudio && 'cursor-not-allowed opacity-40',
                )}
                disabled={needsAudio && !opt.hasAudio}
                onClick={() => {
                  setSelected(opt.id)
                  setDuration(Math.max(0.5, opt.duration))
                }}
              >
                <span>{opt.label}</span>
                <span className="text-[10px] text-mirai-faint">
                  {needsAudio ? (opt.hasAudio ? 'voice ✓' : 'no voice') : formatTimelineTime(opt.duration)}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-[10px] font-bold text-mirai-faint uppercase">Start (s)</p>
            <input
              type="number"
              min={0}
              step={0.1}
              value={startSec}
              onChange={(e) => setStartSec(Math.max(0, Number(e.target.value)))}
              className="h-7 w-full rounded border border-mirai-line bg-mirai-bg px-2 text-xs"
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold text-mirai-faint uppercase">Duration (s)</p>
            <input
              type="number"
              min={0.05}
              step={0.1}
              value={duration}
              onChange={(e) => setDuration(Math.max(0.05, Number(e.target.value)))}
              className="h-7 w-full rounded border border-mirai-line bg-mirai-bg px-2 text-xs"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              onCreate({
                trackId,
                sourceType: kind === 'VIDEO' || kind === 'VOICE' ? 'SHOT' : 'MEDIA',
                sourceId: selected,
                startSec,
                durationSec: duration,
                inOffsetSec: 0,
              })
              onClose()
            }}
          >
            Add clip
          </Button>
        </div>
      </div>
    </Modal>
  )
}
