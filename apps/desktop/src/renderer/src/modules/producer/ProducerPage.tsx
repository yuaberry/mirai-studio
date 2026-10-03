/**
 * ProducerPage (v0.10) — the Producer Agent: send your anime idea, the
 * studio produces the episode. Bible → characters → scenes → screenplays
 * → storyboard → keyframes (optional) → timelines, all as one job.
 */
import { useMemo, useState } from 'react'
import { type AutoproduceSummary } from '@mirai/shared'
import { Clapperboard, Sparkles, Wand2 } from 'lucide-react'
import { useAutoproduce, useCurrentProject, useJobs, useSettings } from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Badge, Button, Label, Select, Textarea } from '../../system/ui'
import { EmptyState } from '../../system/EmptyState'

const IDEAS = [
  'A yuri romance in a magic school where confession letters cast real spells — but hers keeps misfiring.',
  'Mecha pilot rookies in a sinking coastal city; each sortie buys the town one more week above water.',
  'An isekai where the hero is a retired accountant who audits the demon lord\'s kingdom instead of fighting it.',
]

export function ProducerPage() {
  const { data: current } = useCurrentProject()
  const { data: settings } = useSettings()
  const autoproduce = useAutoproduce()
  const { data: jobs } = useJobs()
  const [idea, setIdea] = useState('')
  const [scenesCount, setScenesCount] = useState(4)
  const [shotsPerScene, setShotsPerScene] = useState(4)
  const [generateFrames, setGenerateFrames] = useState(false)
  const [summary, setSummary] = useState<AutoproduceSummary | null>(null)

  const job = useMemo(
    () => (jobs ?? []).find((j) => j.type === 'ai.autoproduce' && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED'),
    [jobs],
  )
  const lastDone = useMemo(
    () => (jobs ?? []).find((j) => j.type === 'ai.autoproduce' && (j.status === 'COMPLETED' || j.status === 'FAILED')),
    [jobs],
  )
  const run = () => {
    if (idea.trim().length < 10) return
    setSummary(null)
    autoproduce.mutate(
      {
        idea: idea.trim(),
        scenesCount,
        shotsPerScene,
        generateFrames,
      },
      {
        onSuccess: (jobId) =>
          toast({
            kind: 'success',
            title: 'Production started',
            description: `Job ${jobId.slice(-6)} — the Producer Agent is building your episode. Watch the steps below.`,
          }),
        onError: (err) => toast({ kind: 'error', title: 'Producer failed to start', description: err.message }),
      },
    )
  }

  // Parse the completed job's result payload for the summary.
  const doneSummary = useMemo(() => {
    if (!lastDone || lastDone.status !== 'COMPLETED') return null
    const result = lastDone.result as unknown as AutoproduceSummary | undefined
    return result && typeof result === 'object' && 'steps' in result ? result : null
  }, [lastDone])

  const matureNote = settings?.content?.matureEnabled
    ? 'Mature Mode is ON — if your project is rated 18+, the Producer writes adult-oriented material (adults only, enforced).'
    : null

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <div className="mb-6">
        <h1 className="font-display text-xl font-bold text-mirai-text">Producer Agent</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
          Send your anime idea — the Producer builds a full episode in the open project: Story Bible
          draft, cast, scene structure, screenplays, storyboard shots, scene timelines and (optionally)
          AI keyframes. You direct and edit everything afterwards. Mature-rated projects follow the
          same flow with adult-content discipline.
        </p>
      </div>

      {!current ? (
        <div className="panel border-dashed">
          <EmptyState
            icon={<Clapperboard className="h-5 w-5" />}
            title="Open a project first"
            description="The Producer Agent works inside the open project — everything it creates lands in your story bible, storyboard and timelines."
          />
        </div>
      ) : (
        <div className="panel space-y-4 p-5">
          <div>
            <Label>Your anime idea</Label>
            <Textarea
              rows={4}
              placeholder="e.g. Two rival idol groups share the same haunted rehearsal hall at midnight…"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {IDEAS.map((ex) => (
                <button
                  key={ex}
                  className="rounded-full border border-mirai-line bg-mirai-panel px-2 py-0.5 text-[10px] text-mirai-faint transition-colors hover:border-mirai-pink/40 hover:text-mirai-pink"
                  onClick={() => setIdea(ex)}
                >
                  {ex.slice(0, 58)}…
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-[10px]">Scenes</Label>
              <Select className="h-8 text-xs" value={String(scenesCount)} onChange={(e) => setScenesCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Shots / scene</Label>
              <Select className="h-8 text-xs" value={String(shotsPerScene)} onChange={(e) => setShotsPerScene(Number(e.target.value))}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">AI keyframes</Label>
              <Select className="h-8 text-xs" value={generateFrames ? 'yes' : 'no'} onChange={(e) => setGenerateFrames(e.target.value === 'yes')}>
                <option value="no">Skip (faster)</option>
                <option value="yes">Generate per shot</option>
              </Select>
            </div>
          </div>

          {matureNote && (
            <p className="rounded-md border border-mirai-pink/30 bg-mirai-pink/5 px-3 py-2 text-[11px] text-mirai-pink">
              {matureNote}
            </p>
          )}

          <Button
            size="md"
            variant="primary"
            className="w-full"
            disabled={idea.trim().length < 10 || job !== undefined}
            loading={autoproduce.isPending}
            onClick={run}
          >
            <Wand2 className="h-4 w-4" /> Produce my episode
          </Button>
        </div>
      )}

      {/* live progress */}
      {job && (
        <div className="panel mt-5 p-5">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold text-mirai-pink">
            <Sparkles className="h-3.5 w-3.5" /> Producing — {job.status === 'RUNNING' ? `${job.progress ?? 0}%` : 'queued'}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-mirai-panel">
            <div
              className="h-full rounded-full bg-gradient-to-r from-mirai-pink to-mirai-violet transition-all"
              style={{ width: `${Math.max(3, job.progress ?? 0)}%` }}
            />
          </div>
          <p className="mt-2 text-[10px] text-mirai-faint">
            Steps: Story Bible → Cast → Episode structure → Screenplays → Storyboard → Keyframes → Timelines
          </p>
        </div>
      )}

      {/* summary */}
      {(doneSummary ?? summary) && (
        <div className="panel mt-5 p-5">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold text-emerald-400">
            <Clapperboard className="h-3.5 w-3.5" /> Episode produced: {(doneSummary ?? summary)!.episodeTitle}
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(doneSummary ?? summary)!.bibleDrafted && <Badge tone="accent">bible drafted</Badge>}
            <Badge>{(doneSummary ?? summary)!.charactersCreated} characters</Badge>
            <Badge>{(doneSummary ?? summary)!.scenesCreated} scenes</Badge>
            <Badge>{(doneSummary ?? summary)!.screenplaysDrafted} screenplays</Badge>
            <Badge>{(doneSummary ?? summary)!.shotsCreated} shots</Badge>
            {(doneSummary ?? summary)!.framesGenerated > 0 && <Badge tone="accent">{(doneSummary ?? summary)!.framesGenerated} keyframes</Badge>}
            <Badge tone="accent">{(doneSummary ?? summary)!.timelinesBuilt} timelines</Badge>
          </div>
          <div className="space-y-1">
            {(doneSummary ?? summary)!.steps.map((step, i) => (
              <p key={i} className="text-[11px] text-mirai-dim">
                <span className={step.ok ? 'text-emerald-400' : 'text-amber-400'}>{step.ok ? '✓' : '⚠'}</span>{' '}
                <span className="font-semibold text-mirai-text">{step.step}:</span> {step.detail}
              </p>
            ))}
          </div>
        </div>
      )}

      {lastDone?.status === 'FAILED' && !doneSummary && (
        <div className="panel mt-5 border-red-400/30 p-5">
          <p className="text-xs font-bold text-red-300">Last production failed</p>
          <p className="mt-1 text-[11px] text-mirai-dim">{typeof lastDone.error === 'string' ? lastDone.error : 'Check the Jobs panel for details.'}</p>
        </div>
      )}
    </div>
  )
}
