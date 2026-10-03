/**
 * WorkflowsPage (Phase 8) — the visual AI workflow runner: the orchestrated
 * production review pipeline (Screenplay Analysis → Continuity Engine →
 * AI Director) with per-node results, plus run-all via the job queue.
 */
import { useEffect, useState } from 'react'
import type {
  ContinuityFinding,
  DirectorNotes,
  ScreenplayAnalysis,
} from '@mirai/shared'
import { CheckCircle2, ChevronRight, Loader2, Play, Sparkles } from 'lucide-react'
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

type NodeId = 'analysis' | 'continuity' | 'director'

export function WorkflowsPage() {
  const { data: episodes } = useEpisodes()
  const [episodeId, setEpisodeId] = useState('')
  const { data: scenes } = useScenes(episodeId || undefined)
  const [sceneId, setSceneId] = useState('')

  useEffect(() => {
    if (!episodeId && episodes && episodes.length > 0) setEpisodeId(episodes[0]!.id)
  }, [episodes, episodeId])
  useEffect(() => {
    if (scenes && scenes.length > 0 && !scenes.some((s) => s.id === sceneId)) {
      setSceneId(scenes[0]!.id)
    }
  }, [scenes, sceneId])

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
          <h1 className="font-display text-xl font-bold text-mirai-text">AI Workflows</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            The orchestrated production review pipeline. Run steps individually or the
            full flow — the model uses the same governed context as the rest of the studio
            (Style Bible discipline, consent-scoped scene data).
          </p>
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
