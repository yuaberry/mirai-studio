/**
 * Overview — project facts, production config (editable) and last validation.
 */
import { useEffect, useState } from 'react'
import { Pencil, ShieldCheck, AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import {
  ANIME_GENRES,
  ASPECT_RATIOS,
  FPS_OPTIONS,
  MiraiError,
  ProjectConfig,
  type JobRecord,
} from '@mirai/shared'
import { Button, Card, Input, Label, Select } from '../../system/ui'
import { ErrorState } from '../../system/EmptyState'
import { Modal } from '../../system/Modal'
import { formatWhen } from '../../lib/utils'
import {
  useCurrentProject,
  useJobs,
  useUpdateProjectConfig,
  useCharacters,
  useLocations,
  useEpisodes,
  usePrompts,
} from '../../lib/queries'
import { toast } from '../../store/appStore'

export function OverviewPage() {
  const { data: project, isLoading, isError, error, refetch } = useCurrentProject()
  const { data: jobs } = useJobs()
  const { data: characters } = useCharacters()
  const { data: locations } = useLocations()
  const { data: episodes } = useEpisodes()
  const { data: prompts } = usePrompts()
  const [configOpen, setConfigOpen] = useState(false)

  const lastValidation = (jobs ?? []).find((j) => j.type === 'project.validate')

  if (isLoading) {
    return <div className="p-10 text-sm text-mirai-dim">Loading project…</div>
  }
  if (isError || !project) {
    return (
      <ErrorState
        title="Project failed to load"
        message={error instanceof MiraiError ? error.message : 'Unknown error'}
        onRetry={() => void refetch()}
      />
    )
  }

  const { manifest } = project
  const config = manifest.config

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Card className="col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[11px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
              Production configuration
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3">
            <Fact label="Work title" value={config.title} />
            <Fact label="Language" value={config.language} />
            <Fact label="Aspect ratio" value={config.aspectRatio} />
            <Fact label="Resolution" value={`${config.resolution.width} × ${config.resolution.height}`} />
            <Fact label="Frame rate" value={`${config.fps} fps`} />
            <Fact label="Episodes planned" value={config.episodeCount != null ? String(config.episodeCount) : '—'} />
            <Fact label="Visual style" value={config.visualStyle ?? '—'} />
            <Fact label="Content rating" value={config.contentRating ?? '—'} />
          </div>
          {(config.genres.length > 0 || manifest.description) && (
            <div className="mt-4 space-y-3 border-t border-mirai-border pt-3">
              {config.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {config.genres.map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full border border-mirai-accent-2/30 bg-mirai-accent-2/10 px-2.5 py-0.5 text-[11px] font-semibold text-mirai-accent-2"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}
              {manifest.description && (
                <p className="text-xs leading-relaxed text-mirai-dim">{manifest.description}</p>
              )}
            </div>
          )}
        </Card>

        <div className="col-span-2 flex flex-col gap-4 xl:col-span-1">
          <Card className="p-5">
            <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
              Production progress
            </h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Characters" value={characters?.length ?? 0} />
              <Stat label="Locations" value={locations?.length ?? 0} />
              <Stat label="Episodes" value={episodes?.length ?? 0} />
              <Stat label="Prompts" value={prompts?.length ?? 0} />
              <Stat label="Scenes" value={(episodes ?? []).reduce((acc, e) => acc + e.sceneCount, 0)} />
              <Stat label="Jobs" value={(jobs ?? []).length} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
              Project facts
            </h2>
            <div className="grid gap-3">
              <Fact label="Created" value={formatWhen(manifest.createdAt)} />
              <Fact label="Updated" value={formatWhen(manifest.updatedAt)} />
              <Fact label="Project ID" value={<code className="text-[10px] text-mirai-faint">{manifest.id}</code>} />
              <Fact label="App version" value={manifest.appVersion} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-[11px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
              <ShieldCheck className="h-3.5 w-3.5" /> Last validation
            </h2>
            <ValidationInfo lastValidation={lastValidation} />
          </Card>
        </div>
      </div>

      <ConfigEditModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  )
}

function ValidationInfo({ lastValidation }: { lastValidation: JobRecord | undefined }) {
  if (!lastValidation) {
    return (
      <p className="text-xs text-mirai-faint">
        Not run yet. Press <span className="text-mirai-dim">Validate</span> to check folders,
        manifest and database.
      </p>
    )
  }
  const result =
    lastValidation.status === 'COMPLETED'
      ? (lastValidation.result as { issues?: string[] } | null)
      : null
  const issues = result?.issues ?? []
  if (lastValidation.status !== 'COMPLETED') {
    return (
      <p className="flex items-center gap-2 text-xs text-mirai-dim">
        <Clock className="h-3.5 w-3.5" /> Last run is {lastValidation.status.toLowerCase()}.
      </p>
    )
  }
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-mirai-success">
        <CheckCircle2 className="h-4 w-4" /> All checks passed.
      </p>
    )
  }
  return (
    <ul className="space-y-1.5 text-xs text-mirai-warn">
      {issues.map((issue) => (
        <li key={issue} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {issue}
        </li>
      ))}
    </ul>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wider text-mirai-faint uppercase">{label}</p>
      <p className="mt-0.5 truncate text-xs text-mirai-text" title={typeof value === 'string' ? value : undefined}>
        {value}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-mirai-border bg-mirai-panel px-2 py-2.5">
      <p className="font-display text-lg font-bold text-mirai-text">{value}</p>
      <p className="text-[10px] font-semibold tracking-wider text-mirai-faint uppercase">{label}</p>
    </div>
  )
}

function ConfigEditModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: project } = useCurrentProject()
  const update = useUpdateProjectConfig()
  const manifest = project?.manifest
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [fps, setFps] = useState('24')

  useEffect(() => {
    if (manifest) {
      setTitle(manifest.config.title)
      setGenre(manifest.config.genre ?? '')
      setGenres(manifest.config.genres ?? [])
      setAspectRatio(manifest.config.aspectRatio)
      setFps(String(manifest.config.fps))
    }
  }, [manifest, open])

  if (!manifest) return null

  const submit = () => {
    const parsed = ProjectConfig.safeParse({
      ...manifest.config,
      title,
      genre: genre.trim() || undefined,
      genres,
      aspectRatio,
      fps: Number(fps),
    })
    if (!parsed.success) {
      toast({ kind: 'error', title: 'Invalid configuration', description: parsed.error.issues[0]?.message })
      return
    }
    update.mutate(parsed.data, {
      onSuccess: () => {
        toast({ kind: 'success', title: 'Configuration saved' })
        onClose()
      },
      onError: (err) => toast({ kind: 'error', title: 'Save failed', description: err.message }),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit production configuration"
      description="Changes persist to project.mirai immediately (atomically written)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={update.isPending} onClick={submit}>
            Save Configuration
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="ce-title">Work title</Label>
          <Input id="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="ce-genre">Genre (free text)</Label>
          <Input id="ce-genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Romance, Fantasy…" />
        </div>
        <div className="col-span-2">
          <Label>
            Anime genres
            <span className="ml-2 font-normal text-mirai-faint">(max 12)</span>
          </Label>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-mirai-border bg-mirai-panel p-2">
            {ANIME_GENRES.map((g) => {
              const active = genres.includes(g)
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() =>
                    setGenres((list) =>
                      list.includes(g) ? list.filter((x) => x !== g) : list.length >= 12 ? list : [...list, g],
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'border-mirai-accent/40 bg-mirai-accent/15 text-mirai-accent'
                      : 'border-mirai-border-strong bg-mirai-raise text-mirai-faint hover:text-mirai-dim'
                  }`}
                >
                  {g}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <Label htmlFor="ce-aspect">Aspect ratio</Label>
          <Select id="ce-aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
            {ASPECT_RATIOS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ce-fps">FPS</Label>
          <Select id="ce-fps" value={fps} onChange={(e) => setFps(e.target.value)}>
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={String(f)}>
                {f}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Modal>
  )
}
