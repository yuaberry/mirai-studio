/**
 * Jobs panel — the live queue of the open project (spec §8).
 * Retry / cancel / progress / errors with useful messages (spec §26).
 */
import { Ban, CheckCircle2, Loader2, Play, RotateCcw, X } from 'lucide-react'
import { MiraiError, jobIsActive, type JobRecord, type JobStatus } from '@mirai/shared'
import { Badge, Spinner } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { formatWhen } from '../../lib/utils'
import { useJobs, useJobActions } from '../../lib/queries'

const STATUS_META: Record<JobStatus, { tone: 'success' | 'warn' | 'danger' | 'info' | 'accent' | 'neutral'; label: string }> = {
  QUEUED: { tone: 'neutral', label: 'Queued' },
  RUNNING: { tone: 'accent', label: 'Running' },
  RETRYING: { tone: 'warn', label: 'Retrying' },
  PAUSED: { tone: 'info', label: 'Paused (recovered)' },
  COMPLETED: { tone: 'success', label: 'Completed' },
  FAILED: { tone: 'danger', label: 'Failed' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
}

export function JobsPanel() {
  const { data: jobs, isLoading, isError, error, refetch } = useJobs()

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  if (isError) {
    return (
      <ErrorState
        title="Jobs failed to load"
        message={error instanceof MiraiError ? error.message : 'Unknown error'}
        onRetry={() => void refetch()}
      />
    )
  }
  if (!jobs || jobs.length === 0) {
    return (
      <EmptyState
        icon={<Play className="h-5 w-5" />}
        title="Queue is empty"
        description="Heavy operations — AI generation, renders, validation — appear here. Press Validate in the toolbar to enqueue a real project check."
      />
    )
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </div>
  )
}

function JobRow({ job }: { job: JobRecord }) {
  const actions = useJobActions()
  const meta = STATUS_META[job.status]
  const active = jobIsActive(job)
  const result = job.status === 'COMPLETED' ? (job.result as Record<string, unknown> | null) : null
  const issues = Array.isArray(result?.issues) ? (result.issues as string[]) : null

  return (
    <div className="panel animate-in flex flex-col gap-2.5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {job.status === 'RUNNING' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-mirai-accent" />
          ) : job.status === 'COMPLETED' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-mirai-success" />
          ) : job.status === 'FAILED' ? (
            <X className="h-4 w-4 shrink-0 text-mirai-danger" />
          ) : job.status === 'CANCELLED' ? (
            <Ban className="h-4 w-4 shrink-0 text-mirai-faint" />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-full border border-mirai-border-strong" />
          )}
          <code className="truncate text-xs font-semibold text-mirai-text">{job.type}</code>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {job.interrupted && <Badge tone="info">Interrupted</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] text-mirai-faint">
            {formatWhen(job.createdAt)} · attempt {job.attempts}/{job.maxAttempts}
          </span>
          {job.status === 'FAILED' && (
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-mirai-dim transition-colors hover:bg-mirai-hover hover:text-mirai-text"
              onClick={() => actions.mutate({ kind: 'retry', id: job.id })}
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
          )}
          {active && (
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-mirai-dim transition-colors hover:bg-mirai-hover hover:text-mirai-danger"
              onClick={() => actions.mutate({ kind: 'cancel', id: job.id })}
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          )}
        </div>
      </div>

      {job.status === 'RUNNING' && typeof job.progress === 'number' && (
        <div className="h-1 overflow-hidden rounded-full bg-mirai-hover">
          <div
            className="h-full rounded-full bg-gradient-mirai transition-[width] duration-300"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {job.status === 'FAILED' && job.error && (
        <div className="rounded-md border border-mirai-danger/25 bg-mirai-danger/10 px-3 py-2">
          <p className="text-[11px] font-semibold text-mirai-danger">{job.error.code}</p>
          <p className="mt-0.5 text-xs text-mirai-dim">{job.error.message}</p>
          <p className="mt-1 text-[10px] text-mirai-faint">
            {job.error.retryable ? 'This operation can be retried.' : 'Adjust the cause before retrying.'}
          </p>
        </div>
      )}

      {issues && issues.length > 0 && (
        <ul className="space-y-1 rounded-md border border-mirai-warn/25 bg-mirai-warn/10 px-3 py-2 text-[11px] text-mirai-warn">
          {issues.map((issue) => (
            <li key={issue}>⚠ {issue}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
