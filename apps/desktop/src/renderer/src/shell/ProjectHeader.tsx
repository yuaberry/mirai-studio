/**
 * ProjectHeader — shared header of every project view: identity, key actions,
 * and the "Recovered Jobs" banner (spec §43).
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, HardDriveDownload, Package, ShieldCheck, Wand2, X } from 'lucide-react'
import { Badge, Button } from '../system/ui'
import { ConfirmModal } from '../system/Modal'
import {
  useCurrentProject,
  useJobs,
  useJobActions,
  useValidateProject,
  useCloseProject,
  useProjectAction,
} from '../lib/queries'
import { useAppStore, toast } from '../store/appStore'

export function ProjectHeader() {
  const { data: project } = useCurrentProject()
  const { data: jobs } = useJobs()
  const jobActions = useJobActions()
  const validate = useValidateProject()
  const closeProject = useCloseProject()
  const projectAction = useProjectAction()
  const setView = useAppStore((s) => s.setView)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const pausedJobs = useMemo(() => (jobs ?? []).filter((j) => j.status === 'PAUSED'), [jobs])

  if (!project) return null

  return (
    <div className="sticky top-0 z-30 border-b border-mirai-border bg-mirai-base/95 px-8 py-4 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-lg font-bold text-mirai-text">
              {project.manifest.name}
            </h1>
            <Badge tone={project.status === 'ACTIVE' ? 'success' : 'neutral'}>{project.status}</Badge>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-mirai-faint" title={project.path}>
            {project.path}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {(project.manifest.config.genres ?? []).slice(0, 5).map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-mirai-border bg-mirai-panel px-2 py-0.5 text-[9px] font-semibold text-mirai-dim"
              >
                {genre}
              </span>
            ))}
            {project.manifest.config.contentRating && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                  project.manifest.config.contentRating === '18+'
                    ? 'border-mirai-danger/40 text-mirai-danger'
                    : 'border-mirai-border text-mirai-faint'
                }`}
              >
                {project.manifest.config.contentRating}
              </span>
            )}
            <span className="text-[9px] text-mirai-faint">
              · {project.manifest.config.fps ?? 24}fps · {project.manifest.config.aspectRatio ?? '16:9'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={validate.isPending}
            onClick={() =>
              validate.mutate(undefined, {
                onSuccess: () =>
                  toast({
                    kind: 'info',
                    title: 'Validation queued',
                    description: 'Results land in the Jobs panel.',
                  }),
                onError: (err) =>
                  toast({ kind: 'error', title: 'Validation failed to start', description: err.message }),
              })
            }
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Validate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              projectAction.mutate(
                { kind: 'backup', id: project.id },
                {
                  onSuccess: (r) => {
                    toast({
                      kind: 'success',
                      title: `Backup created (${(r as { backup: { id: string } }).backup.id})`,
                    })
                    setView('backups')
                  },
                  onError: (err) => toast({ kind: 'error', title: 'Backup failed', description: err.message }),
                },
              )
            }
          >
            <HardDriveDownload className="h-3.5 w-3.5" /> Back Up
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => projectAction.mutate({ kind: 'revealInFolder', id: project.id })}
          >
            <Package className="h-3.5 w-3.5" /> Reveal
          </Button>
          <Button
            variant="primary"
            size="sm"
            title="Producer Agent — describe your idea, the studio builds the episode"
            onClick={() => setView('producer')}
          >
            <Wand2 className="h-3.5 w-3.5" /> Produce Episode
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={closeProject.isPending}
            onClick={() =>
              closeProject.mutate(undefined, {
                onSuccess: () => {
                  toast({ kind: 'info', title: `Closed “${project.manifest.name}”` })
                  setView('hub')
                },
              })
            }
          >
            <X className="h-3.5 w-3.5" /> Close Project
          </Button>
        </div>
      </div>

      {pausedJobs.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-mirai-accent-2/30 bg-mirai-accent-2/10 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-mirai-accent-2" />
            <div>
              <p className="text-xs font-semibold text-mirai-text">
                Recovered jobs — {pausedJobs.length} unfinished{' '}
                {pausedJobs.length === 1 ? 'operation' : 'operations'} found
              </p>
              <p className="text-[11px] text-mirai-dim">
                Interrupted the last time the app closed. Resume them or discard for good.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => jobActions.mutate({ kind: 'resumeInterrupted' })}
            >
              Resume All
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(true)}>
              Discard All
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() =>
          jobActions.mutate({ kind: 'discardInterrupted' }, { onSuccess: () => setConfirmDiscard(false) })
        }
        title="Discard interrupted jobs?"
        description={`${pausedJobs.length} paused ${pausedJobs.length === 1 ? 'job' : 'jobs'} will be marked as cancelled. This only clears the queue — no project files are touched.`}
        confirmLabel="Discard Jobs"
        danger
        busy={jobActions.isPending}
      />
    </div>
  )
}
