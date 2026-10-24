/**
 * WorkflowsPage (Phase 8) — the visual AI workflow runner: the orchestrated
 * production review pipeline (Screenplay Analysis → Continuity Engine →
 * AI Director) with per-node results, plus run-all via the job queue.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { usePersistedState } from '../../lib/usePersistedState'
import type {
  ContinuityFinding,
  DirectorNotes,
  ScreenplayAnalysis,
} from '@mirai/shared'
import { CheckCircle2, ChevronLeft, ChevronRight, GripHorizontal, Loader2, Play, Plus, Sparkles, X } from 'lucide-react'
import {
  useAnalyzeScreenplay,
  useContinuityCheck,
  useDirectorNotes,
  useEpisodes,
  useProductionReview,
  useScenes,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Badge, Button, Select, Spinner } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'
import { cn } from '../../lib/utils'
import { T } from '../../system/T'

type NodeId = 'analysis' | 'continuity' | 'director'

export function WorkflowsPage() {
  const { data: episodes } = useEpisodes()
  const [episodeId, setEpisodeId] = usePersistedState('workflows.episode', '')
  const { data: scenes } = useScenes(episodeId || undefined)
  const [sceneId, setSceneId] = usePersistedState('workflows.scene', '')
  const [view, setView] = useState<'pipeline' | 'builder'>('pipeline')

  useEffect(() => {
    if (!episodeId && episodes && episodes.length > 0) setEpisodeId(episodes[0]!.id)
  }, [episodes, episodeId, setEpisodeId])
  useEffect(() => {
    if (scenes && scenes.length > 0 && !scenes.some((s) => s.id === sceneId)) {
      setSceneId(scenes[0]!.id)
    }
  }, [scenes, sceneId, setSceneId])

  const analysis = useAnalyzeScreenplay()
  const continuity = useContinuityCheck()
  const director = useDirectorNotes()
  const review = useProductionReview()

  const [results, setResults] = useState<{
    analysis: ScreenplayAnalysis | null
    continuity: ContinuityFinding[] | null
    director: DirectorNotes | null
  }>({ analysis: null, continuity: null, director: null })

  const nodeState = (id: NodeId): 'idle' | 'running' | 'done' => {
    if (id === 'analysis') return analysis.isPending ? 'running' : results.analysis ? 'done' : 'idle'
    if (id === 'continuity') return continuity.isPending ? 'running' : results.continuity ? 'done' : 'idle'
    return director.isPending ? 'running' : results.director ? 'done' : 'idle'
  }

  const runNode = (id: NodeId) => {
    if (!sceneId) return
    if (id === 'analysis') {
      analysis.mutate(sceneId, {
        onSuccess: (data) => setResults((r) => ({ ...r, analysis: data })),
        onError: (err) => toast({ kind: 'error', title: 'Analysis failed', description: err.message }),
      })
    } else if (id === 'continuity') {
      continuity.mutate(sceneId, {
        onSuccess: (data) => setResults((r) => ({ ...r, continuity: data })),
        onError: (err) => toast({ kind: 'error', title: 'Continuity check failed', description: err.message }),
      })
    } else {
      director.mutate(sceneId, {
        onSuccess: (data) => setResults((r) => ({ ...r, director: data })),
        onError: (err) => toast({ kind: 'error', title: 'Director notes failed', description: err.message }),
      })
    }
  }

  const runAll = () => {
    if (!sceneId) return
    review.mutate(sceneId, {
      onSuccess: (jobId) =>
        toast({
          kind: 'success',
          title: 'Production review queued',
          description: `The full pipeline runs as job ${jobId.slice(-6)} — the result is recorded in the decision log.`,
        }),
      onError: (err) => toast({ kind: 'error', title: 'Queue failed', description: err.message }),
    })
  }

  const nodes: Array<{ id: NodeId; title: string; desc: string; run: () => void }> = [
    {
      id: 'analysis',
      title: 'Screenplay Analysis',
      desc: 'Pacing score, dialogue quality, repetition flags, voice notes.',
      run: () => runNode('analysis'),
    },
    {
      id: 'continuity',
      title: 'Continuity Engine',
      desc: 'Cast cross-checks + AI-assisted costume/location/temporal contradictions.',
      run: () => runNode('continuity'),
    },
    {
      id: 'director',
      title: 'AI Director',
      desc: 'Narrative, composition, rhythm, emotion + per-shot camera suggestions.',
      run: () => runNode('director'),
    },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-8 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text"><T k="AI Workflows" /></h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            The orchestrated production review pipeline. Run steps individually or the
            full flow — the model uses the same governed context as the rest of the studio
            (Style Bible discipline, consent-scoped scene data).
          </p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-mirai-line">
          <button
            className={cn(
              'px-3 py-1.5 text-[10px] font-semibold transition-colors',
              view === 'pipeline' ? 'bg-mirai-pink/15 text-mirai-pink' : 'text-mirai-dim hover:text-mirai-text',
            )}
            onClick={() => setView('pipeline')}
          >
            Pipeline
          </button>
          <button
            className={cn(
              'px-3 py-1.5 text-[10px] font-semibold transition-colors',
              view === 'builder' ? 'bg-mirai-pink/15 text-mirai-pink' : 'text-mirai-dim hover:text-mirai-text',
            )}
            onClick={() => setView('builder')}
          >
            Node Builder
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
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
        <Select className="h-8 w-48 text-xs" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
          {(scenes ?? []).map((sc) => (
            <option key={sc.id} value={sc.id}>
              {sc.title}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="primary" className="ml-auto" disabled={!sceneId} loading={review.isPending} onClick={runAll}>
          <Play className="h-3.5 w-3.5" /> Run full pipeline (job)
        </Button>
      </div>

      {!sceneId ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            title="No scenes yet"
            description="Create a scene with a screenplay — the workflows analyze real content."
          />
        </div>
      ) : view === 'builder' ? (
        <WorkflowBuilder sceneId={sceneId} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {nodes.map((node, i) => {
            const state = nodeState(node.id)
            return (
              <div key={node.id} className="relative">
                {i < nodes.length - 1 && (
                  <ChevronRight className="absolute top-1/2 -right-3 z-10 hidden h-4 w-4 -translate-y-1/2 text-mirai-faint md:block" />
                )}
                <div className="panel flex h-full flex-col p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-mirai-text">{node.title}</p>
                    {state === 'done' ? (
                      <Badge tone="accent">done</Badge>
                    ) : state === 'running' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-mirai-pink" />
                    ) : (
                      <span className="text-[9px] font-bold tracking-widest text-mirai-faint uppercase">
                        node {i + 1}
                      </span>
                    )}
                  </div>
                  <p className="mb-3 flex-1 text-[11px] leading-relaxed text-mirai-faint">{node.desc}</p>
                  <Button size="sm" variant="outline" disabled={analysis.isPending || continuity.isPending || director.isPending} onClick={node.run}>
                    Run step
                  </Button>

                  {/* result */}
                  {state === 'done' && node.id === 'analysis' && results.analysis && (
                    <AnalysisResult result={results.analysis} />
                  )}
                  {state === 'done' && node.id === 'continuity' && results.continuity && (
                    <ContinuityResult result={results.continuity} />
                  )}
                  {state === 'done' && node.id === 'director' && results.director && (
                    <DirectorResult result={results.director} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {review.isPending && (
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-mirai-dim">
          <Spinner className="h-3.5 w-3.5" /> Full pipeline queued — follow it in Jobs.
        </div>
      )}
    </div>
  )
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-[10px] font-bold tracking-wide text-mirai-faint uppercase">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-mirai-hover">
        <div
          className="h-full rounded-full bg-gradient-to-r from-mirai-pink to-mirai-violet"
          style={{ width: `${value * 10}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-mirai-text">{value}/10</span>
    </div>
  )
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: 'good' | 'bad' }) {
  if (items.length === 0) return null
  return (
    <div className="mt-2">
      <p className="text-[9px] font-bold tracking-widest text-mirai-faint uppercase">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.slice(0, 4).map((item, i) => (
          <li
            key={i}
            className={cn(
              'flex gap-1 text-[11px] leading-snug',
              tone === 'good' ? 'text-emerald-300/90' : tone === 'bad' ? 'text-amber-300/90' : 'text-mirai-dim',
            )}
          >
            <span className="text-mirai-faint">•</span> {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AnalysisResult({ result }: { result: ScreenplayAnalysis }) {
  return (
    <div className="mt-3 rounded-md border border-mirai-line bg-mirai-bg p-2">
      <Score label="Pacing" value={result.pacingScore} />
      <Score label="Dialogue" value={result.dialogueQuality} />
      <List title="Strengths" items={result.strengths} tone="good" />
      <List title="Issues" items={result.issues} tone="bad" />
      <List title="Suggestions" items={result.suggestions} />
      <List title="Repetition" items={result.repetitionFlags} tone="bad" />
    </div>
  )
}

function ContinuityResult({ result }: { result: ContinuityFinding[] }) {
  return (
    <div className="mt-3 rounded-md border border-mirai-line bg-mirai-bg p-2">
      {result.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-300/90">
          <CheckCircle2 className="h-3.5 w-3.5" /> No continuity issues found.
        </p>
      ) : (
        <ul className="space-y-1">
          {result.slice(0, 6).map((f, i) => (
            <li key={i} className="text-[11px] leading-snug">
              <span
                className={cn(
                  'mr-1 font-bold',
                  f.severity === 'ERROR' ? 'text-red-400' : f.severity === 'WARNING' ? 'text-amber-400' : 'text-mirai-faint',
                )}
              >
                {f.severity}
              </span>
              <span className="text-mirai-text">{f.title}</span>
              <span className="block text-mirai-faint">{f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DirectorResult({ result }: { result: DirectorNotes }) {
  return (
    <div className="mt-3 rounded-md border border-mirai-line bg-mirai-bg p-2">
      <List title="Narrative" items={result.narrative} />
      <List title="Composition" items={result.composition} />
      <List title="Rhythm" items={result.rhythm} />
      <List title="Emotion" items={result.emotion} />
      <List title="Camera" items={result.camera} />
      {result.perShot.length > 0 && (
        <div className="mt-2">
          <p className="text-[9px] font-bold tracking-widest text-mirai-faint uppercase">Per shot</p>
          <ul className="mt-1 space-y-0.5">
            {result.perShot.slice(0, 5).map((s, i) => (
              <li key={i} className="text-[11px] leading-snug text-mirai-dim">
                <span className="font-semibold text-mirai-text">{s.shotTitle}:</span> {s.suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ node builder
// Phase 8 completion: drag-and-drop node EDITING beyond the fixed runner.
// The user composes their own chain (add/remove/reorder/drag), positions are
// persisted locally, and Run executes the chain sequentially on the scene.

type BuilderNodeType = 'analysis' | 'continuity' | 'director'

interface BuilderNode {
  key: string
  type: BuilderNodeType
  x: number
  y: number
}

const BUILDER_LS_KEY = 'mirai-workflow-builder-v1'

const NODE_META: Record<BuilderNodeType, { title: string; desc: string; tone: string }> = {
  analysis: {
    title: 'Screenplay Analysis',
    desc: 'Pacing, dialogue quality, repetition, voice notes.',
    tone: 'border-mirai-pink/50',
  },
  continuity: {
    title: 'Continuity Engine',
    desc: 'Costume/location/temporal contradictions.',
    tone: 'border-emerald-400/50',
  },
  director: {
    title: 'AI Director',
    desc: 'Narrative, composition, rhythm, camera notes.',
    tone: 'border-mirai-violet/50',
  },
}

const NODE_W = 250
const NODE_H = 110

function loadNodes(): BuilderNode[] {
  try {
    const raw = localStorage.getItem(BUILDER_LS_KEY)
    if (!raw) throw new Error('empty')
    const parsed = JSON.parse(raw) as BuilderNode[]
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty')
    return parsed
  } catch {
    // Sensible default chain: analysis → continuity → director.
    return [
      { key: 'n1', type: 'analysis', x: 40, y: 40 },
      { key: 'n2', type: 'continuity', x: 360, y: 40 },
      { key: 'n3', type: 'director', x: 680, y: 40 },
    ]
  }
}

function WorkflowBuilder({ sceneId }: { sceneId: string }) {
  const [nodes, setNodes] = useState<BuilderNode[]>(loadNodes)
  const [running, setRunning] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, 'ok' | 'error' | 'running'>>({})
  const dragRef = useRef<{ key: string; dx: number; dy: number } | null>(null)

  const analysis = useAnalyzeScreenplay()
  const continuity = useContinuityCheck()
  const director = useDirectorNotes()
  const runners: Record<BuilderNodeType, (id: string) => Promise<unknown>> = {
    analysis: (id) => analysis.mutateAsync(id),
    continuity: (id) => continuity.mutateAsync(id),
    director: (id) => director.mutateAsync(id),
  }

  useEffect(() => {
    localStorage.setItem(BUILDER_LS_KEY, JSON.stringify(nodes))
  }, [nodes])

  const addNode = (type: BuilderNodeType) => {
    setNodes((ns) => [
      ...ns,
      {
        key: `n${Date.now().toString(36)}`,
        type,
        x: 40 + (ns.length % 3) * 320,
        y: 40 + Math.floor(ns.length / 3) * 180,
      },
    ])
  }

  const removeNode = (key: string) => {
    setNodes((ns) => ns.filter((n) => n.key !== key))
    setResults((r) => {
      const copy = { ...r }
      delete copy[key]
      return copy
    })
  }

  const moveNode = (key: string, dir: -1 | 1) => {
    setNodes((ns) => {
      const idx = ns.findIndex((n) => n.key === key)
      const target = idx + dir
      if (idx < 0 || target < 0 || target >= ns.length) return ns
      const copy = [...ns]
      const [item] = copy.splice(idx, 1)
      copy.splice(target, 0, item!)
      return copy
    })
  }

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setNodes((ns) =>
      ns.map((n) =>
        n.key === d.key
          ? { ...n, x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) }
          : n,
      ),
    )
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove])

  const startDrag = (e: ReactPointerEvent, node: BuilderNode) => {
    dragRef.current = { key: node.key, dx: e.clientX - node.x, dy: e.clientY - node.y }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const runChain = async () => {
    if (running || nodes.length === 0) return
    setRunning(true)
    try {
      for (const node of nodes) {
        setActiveKey(node.key)
        setResults((r) => ({ ...r, [node.key]: 'running' }))
        try {
          await runners[node.type](sceneId)
          setResults((r) => ({ ...r, [node.key]: 'ok' }))
        } catch {
          setResults((r) => ({ ...r, [node.key]: 'error' }))
          break // stop the chain on the first failure
        }
      }
    } finally {
      setActiveKey(null)
      setRunning(false)
    }
  }

  const busy = analysis.isPending || continuity.isPending || director.isPending

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(NODE_META) as BuilderNodeType[]).map((type) => (
          <Button key={type} size="sm" variant="outline" disabled={running} onClick={() => addNode(type)}>
            <Plus className="h-3.5 w-3.5" /> {NODE_META[type].title}
          </Button>
        ))}
        <Button size="sm" variant="primary" className="ml-auto" disabled={running || nodes.length === 0} loading={running} onClick={runChain}>
          <Play className="h-3.5 w-3.5" /> Run chain ({nodes.length})
        </Button>
      </div>

      <div
        className="relative min-h-72 overflow-hidden rounded-lg border border-mirai-line bg-mirai-base"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(138,147,178,0.15) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      >
        {nodes.length > 1 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            {nodes.slice(0, -1).map((node, i) => {
              const next = nodes[i + 1]!
              return (
                <line
                  key={node.key}
                  x1={node.x + NODE_W}
                  y1={node.y + NODE_H / 2}
                  x2={next.x}
                  y2={next.y + NODE_H / 2}
                  stroke="rgba(244,114,182,0.4)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )
            })}
          </svg>
        )}
        {nodes.map((node, i) => {
          const meta = NODE_META[node.type]
          const state = results[node.key]
          return (
            <div
              key={node.key}
              className={cn(
                'absolute w-64 cursor-grab touch-none rounded-lg border bg-mirai-panel p-3 shadow-lg shadow-black/30 select-none active:cursor-grabbing',
                meta.tone,
                state === 'running' && 'ring-2 ring-mirai-pink/60',
              )}
              style={{ left: node.x, top: node.y }}
              onPointerDown={(e) => startDrag(e, node)}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[9px] font-bold tracking-widest text-mirai-faint uppercase">
                  <GripHorizontal className="h-3 w-3" /> step {i + 1}
                </span>
                <span className="flex items-center gap-0.5">
                  <button
                    className="rounded p-0.5 text-mirai-faint transition-colors hover:text-mirai-text"
                    title="Move earlier in the chain"
                    disabled={i === 0 || running}
                    onClick={(e) => {
                      e.stopPropagation()
                      moveNode(node.key, -1)
                    }}
                  >
                    <ChevronLeft />
                  </button>
                  <button
                    className="rounded p-0.5 text-mirai-faint transition-colors hover:text-mirai-text"
                    title="Move later in the chain"
                    disabled={i === nodes.length - 1 || running}
                    onClick={(e) => {
                      e.stopPropagation()
                      moveNode(node.key, 1)
                    }}
                  >
                    <ChevronRight />
                  </button>
                  <button
                    className="rounded p-0.5 text-mirai-faint transition-colors hover:text-red-400"
                    title="Remove node"
                    disabled={running}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeNode(node.key)
                    }}
                  >
                    <X />
                  </button>
                </span>
              </div>
              <p className="text-xs font-bold text-mirai-text">{meta.title}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-mirai-faint">{meta.desc}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[9px] font-bold tracking-widest text-mirai-faint uppercase">
                  {state === 'ok' ? (
                    <span className="text-emerald-300">done</span>
                  ) : state === 'error' ? (
                    <span className="text-red-400">failed — chain stopped</span>
                  ) : state === 'running' || activeKey === node.key ? (
                    <span className="text-mirai-pink">running…</span>
                  ) : (
                    'idle'
                  )}
                </span>
                {state === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-mirai-pink" />}
                {state === 'ok' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
              </div>
            </div>
          )
        })}
        {nodes.length === 0 && (
          <div className="flex h-72 items-center justify-center text-xs text-mirai-faint">
            Add nodes above to compose your own pipeline — drag to arrange, arrows to reorder.
          </div>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-mirai-faint">
        The chain runs top-to-bottom in step order and stops at the first failure. Node positions are
        remembered locally. Drag anywhere on a card to move it.
        {busy && <span className="ml-1 text-mirai-pink">A node is executing…</span>}
      </p>
    </div>
  )
}
