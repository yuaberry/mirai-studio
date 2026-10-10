/**
 * ProductionPage (Phase 7) — the production management suite:
 *   Dashboard  — real analytics + quality control report
 *   Tasks       — kanban board (drag between columns, crew assignment)
 *   Approvals   — the governed pipeline browser + full audit log
 */
import { useEffect, useMemo, useState } from 'react'
import {
  APPROVAL_ENTITY_LABEL,
  APPROVAL_PIPELINES,
  isTransitionAllowed,
  PRIORITY_LABEL,
  TASK_STATUSES,
  type ApprovalPosition,
  type CrewMember,
  type QcSeverity,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from '@mirai/shared'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  History,
  Info,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react'
import {
  useAnalytics,
  useApprovalTransition,
  useApprovals,
  useCrew,
  useCrewMutations,
  useEpisodes,
  useQc,
  useScenes,
  useShots,
  useTaskMutations,
  useTasks,
} from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Button, Input, Label, Select, Spinner } from '../../system/ui'
import { ConfirmModal, Modal } from '../../system/Modal'
import { EmptyState } from '../../system/EmptyState'
import { cn } from '../../lib/utils'

type Tab = 'dashboard' | 'tasks' | 'approvals'

export function ProductionPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  return (
    <div className="mx-auto w-full max-w-7xl px-8 py-8">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-mirai-text">Production</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mirai-dim">
            The studio side: track work on the task board, govern approvals with an audited
            pipeline, run quality control and watch the numbers.
          </p>
        </div>
        <div className="flex gap-1">
          {(
            [
              ['dashboard', 'Dashboard', BarChart3],
              ['tasks', 'Tasks', ClipboardList],
              ['approvals', 'Approvals', ShieldCheck],
            ] as Array<[Tab, string, typeof BarChart3]>
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors',
                tab === id ? 'bg-mirai-hover text-mirai-text' : 'text-mirai-faint hover:text-mirai-dim',
              )}
              onClick={() => setTab(id)}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'approvals' && <ApprovalsTab />}
    </div>
  )
}

// ---------------------------------------------------------------- dashboard

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-[10px] font-bold tracking-[0.14em] text-mirai-faint uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-mirai-text">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-mirai-faint">{sub}</p>}
    </div>
  )
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-mirai-dim">{label}</span>
        <span className="font-mono text-mirai-faint">
          {done}/{total} · {pct}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-mirai-panel">
        <div
          className="h-full rounded-full bg-gradient-to-r from-mirai-pink to-mirai-violet transition-all"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  )
}

function DashboardTab() {
  const { data: analytics, isLoading } = useAnalytics()
  const { data: qc, isFetching, refetch } = useQc()

  if (isLoading || !analytics) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  const approvedScenes = analytics.scenes.byStatus['APPROVED'] ?? 0
  const finalShots = analytics.shots.byStatus['FINAL'] ?? 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Episodes"
          value={analytics.episodes.total}
          sub={`${Object.values(analytics.episodes.byStatus).reduce((a, b) => a + b, 0)} tracked`}
        />
        <StatCard
          label="Scenes"
          value={analytics.scenes.total}
          sub={`${analytics.scenes.withTimeline} with timeline`}
        />
        <StatCard
          label="Shots"
          value={analytics.shots.total}
          sub={`${analytics.shots.withFrame} with frames`}
        />
        <StatCard
          label="Assets"
          value={analytics.assets.total}
          sub={`${analytics.assets.images} images · ${analytics.assets.audio} audio`}
        />
      </div>

      <div className="panel space-y-4 p-5">
        <p className="text-xs font-bold tracking-wider text-mirai-dim uppercase">Production health</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Progress label="Shots with frames" done={analytics.shots.withFrame} total={analytics.shots.total} />
          <Progress label="Shots with voice" done={analytics.shots.withVoice} total={analytics.shots.total} />
          <Progress label="Scenes with timeline" done={analytics.scenes.withTimeline} total={analytics.scenes.total} />
          <Progress label="Scenes with screenplay" done={analytics.scenes.withScreenplay} total={analytics.scenes.total} />
          <Progress label="Scenes approved" done={approvedScenes} total={analytics.scenes.total} />
          <Progress label="Shots final" done={finalShots} total={analytics.shots.total} />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-mirai-line pt-3 text-center">
          <div>
            <p className="font-display text-lg font-bold text-mirai-text">{analytics.tasks.total}</p>
            <p className="text-[10px] text-mirai-faint uppercase">Tasks</p>
          </div>
          <div>
            <p className="font-display text-lg font-bold text-mirai-text">{analytics.approvals.events}</p>
            <p className="text-[10px] text-mirai-faint uppercase">Approval events</p>
          </div>
          <div>
            <p className="font-display text-lg font-bold text-mirai-text">{analytics.crew.total}</p>
            <p className="text-[10px] text-mirai-faint uppercase">Crew members</p>
          </div>
        </div>
      </div>

      <div className="panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold tracking-wider text-mirai-dim uppercase">Quality control</p>
          <Button size="sm" variant="outline" loading={isFetching} onClick={() => void refetch()}>
            Run checks
          </Button>
        </div>
        {!qc ? (
          <p className="text-xs text-mirai-faint">Run the automated checks to audit the production.</p>
        ) : qc.findings.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> No issues found — the production is clean.
          </div>
        ) : (
          <>
            <div className="mb-3 flex gap-3 text-[11px]">
              <span className="text-red-400">{qc.errorCount} errors</span>
              <span className="text-amber-400">{qc.warningCount} warnings</span>
              <span className="text-mirai-faint">{qc.infoCount} hints</span>
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {qc.findings.map((f, i) => (
                <QcRow key={`${f.checkId}-${f.entityId ?? i}`} severity={f.severity} finding={f} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function QcRow({ severity, finding }: { severity: QcSeverity; finding: { title: string; detail: string; fixHint: string } }) {
  const Icon = severity === 'ERROR' ? XCircle : severity === 'WARNING' ? AlertTriangle : Info
  const color =
    severity === 'ERROR' ? 'text-red-400' : severity === 'WARNING' ? 'text-amber-400' : 'text-mirai-faint'
  return (
    <div className="rounded-md border border-mirai-line bg-mirai-panel px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-mirai-text">
        <Icon className={cn('h-3.5 w-3.5 flex-none', color)} /> {finding.title}
      </p>
      <p className="mt-0.5 pl-5 text-[11px] text-mirai-dim">{finding.detail}</p>
      <p className="mt-0.5 pl-5 text-[10px] text-mirai-faint">Fix: {finding.fixHint}</p>
    </div>
  )
}

// ---------------------------------------------------------------- tasks

const PRIORITY_TONE: Record<TaskPriority, string> = {
  LOW: 'text-mirai-faint',
  NORMAL: 'text-mirai-dim',
  HIGH: 'text-amber-400',
  CRITICAL: 'text-red-400',
}

function TasksTab() {
  const { data: tasks, isLoading } = useTasks()
  const { data: crew } = useCrew()
  const mutations = useTaskMutations()
  const [creating, setCreating] = useState(false)
  const [crewOpen, setCrewOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TaskRecord | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, TaskRecord[]> = { TODO: [], IN_PROGRESS: [], REVIEW: [], APPROVED: [], FINAL: [] }
    for (const task of tasks ?? []) map[task.status].push(task)
    return map
  }, [tasks])

  const onDrop = (status: TaskStatus) => {
    if (!dragId) return
    mutations.setStatus.mutate({ id: dragId, status })
    setDragId(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-mirai-dim">
          Drag cards between columns — the board is the single source of truth for production work.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCrewOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Crew
          </Button>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {TASK_STATUSES.map((status) => (
            <div
              key={status}
              className="panel flex min-h-56 flex-col p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(status)}
            >
              <p className="mb-2 flex items-center justify-between px-1 text-[10px] font-bold tracking-wider text-mirai-faint uppercase">
                {status.replace('_', ' ')}
                <span className="rounded bg-mirai-panel px-1.5">{byStatus[status].length}</span>
              </p>
              <div className="flex-1 space-y-2">
                {byStatus[status].map((task) => {
                  const assignee = crew?.find((m) => m.id === task.assigneeId)
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onDragEnd={() => setDragId(null)}
                      className="cursor-grab rounded-md border border-mirai-line bg-mirai-panel px-2.5 py-2 transition-colors hover:border-mirai-pink/40"
                    >
                      <p className="text-xs font-semibold text-mirai-text">{task.title}</p>
                      {task.description && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-mirai-faint">{task.description}</p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className={cn('text-[9px] font-bold', PRIORITY_TONE[task.priority])}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        {assignee && (
                          <span
                            className="max-w-24 truncate rounded bg-mirai-hover px-1.5 py-0.5 text-[9px] text-mirai-dim"
                            title={assignee.name}
                          >
                            {assignee.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1">
                        <Select
                          className="h-5 flex-1 px-1 text-[9px]"
                          value={task.assigneeId ?? ''}
                          onChange={(e) =>
                            mutations.update.mutate({
                              id: task.id,
                              patch: { assigneeId: e.target.value || null },
                            })
                          }
                        >
                          <option value="">Unassigned</option>
                          {(crew ?? []).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </Select>
                        <button
                          className="text-mirai-faint transition-colors hover:text-red-400"
                          title="Delete task"
                          onClick={() => setConfirmDelete(task)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <TaskCreateModal crew={crew ?? []} onClose={() => setCreating(false)} />}
      {crewOpen && <CrewModal onClose={() => setCrewOpen(false)} />}

      <ConfirmModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) mutations.remove.mutate(confirmDelete.id)
          setConfirmDelete(null)
        }}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        description="The task is removed from the board. This can't be undone."
        confirmLabel="Delete task"
        danger
      />
    </div>
  )
}

function TaskCreateModal({ crew, onClose }: { crew: CrewMember[]; onClose: () => void }) {
  const mutations = useTaskMutations()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('NORMAL')
  const [assigneeId, setAssigneeId] = useState('')
  return (
    <Modal open title="New task" onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-[10px]">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Approve rooftop scene" />
        </div>
        <div>
          <Label className="text-[10px]">Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px]">Priority</Label>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-[10px]">Assignee</Label>
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {crew.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={title.trim().length === 0}
            onClick={() => {
              mutations.create.mutate(
                {
                  title: title.trim(),
                  description: description.trim() || undefined,
                  priority,
                  assigneeId: assigneeId || undefined,
                },
                {
                  onSuccess: () => toast({ kind: 'success', title: 'Task created' }),
                  onError: (err) => toast({ kind: 'error', title: 'Create failed', description: err.message }),
                },
              )
              onClose()
            }}
          >
            Create
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function CrewModal({ onClose }: { onClose: () => void }) {
  const { data: crew } = useCrew()
  const mutations = useCrewMutations()
  const [name, setName] = useState('')
  const [role, setRole] = useState<CrewMember['role']>('DIRECTOR')
  return (
    <Modal open title="Crew roster" onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-3">
        {(crew ?? []).length === 0 && (
          <p className="text-xs text-mirai-faint">No crew yet — add the people involved in this production.</p>
        )}
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {(crew ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border border-mirai-line bg-mirai-panel px-3 py-1.5">
              <span className="text-xs text-mirai-text">{m.name}</span>
              <span className="flex items-center gap-2 text-[10px] text-mirai-faint">
                {m.role}
                <button
                  className="transition-colors hover:text-red-400"
                  onClick={() => mutations.remove.mutate(m.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-mirai-line pt-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Select value={role} onChange={(e) => setRole(e.target.value as CrewMember['role'])}>
            {(['DIRECTOR', 'PRODUCER', 'WRITER', 'CHARACTER_DESIGNER', 'BACKGROUND_ARTIST', 'ANIMATOR', 'EDITOR', 'SOUND_DESIGNER', 'VOICE_ACTOR', 'REVIEWER'] as CrewMember['role'][]).map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={name.trim().length === 0}
            onClick={() => {
              mutations.create.mutate(
                { name: name.trim(), role },
                { onSuccess: () => setName('') },
              )
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- approvals

/** Minimal pipeline position fetcher using existing list hooks + shared rules. */
function useApprovalPositions(): ApprovalPosition[] {
  const { data: episodes } = useEpisodes()
  const [episodeId, setEpisodeId] = useState<string | null>(null)
  useEffect(() => {
    if (episodeId === null && episodes && episodes.length > 0) setEpisodeId(episodes[0]!.id)
  }, [episodes, episodeId])
  const { data: scenes } = useScenes(episodeId ?? undefined)
  const [sceneId, setSceneId] = useState<string | null>(null)
  useEffect(() => {
    if (scenes && scenes.length > 0) setSceneId(scenes[0]!.id)
  }, [scenes])
  const { data: shots } = useShots(sceneId ?? undefined)

  return useMemo(() => {
    const positions: ApprovalPosition[] = []
    for (const scene of scenes ?? []) {
      positions.push({
        entityType: 'SCENE',
        entityId: scene.id,
        title: scene.title,
        status: scene.status,
        pipeline: APPROVAL_PIPELINES.SCENE.statuses as string[],
        nextStatus: null,
      })
    }
    for (const shot of shots ?? []) {
      positions.push({
        entityType: 'SHOT',
        entityId: shot.id,
        title: shot.title,
        status: shot.status,
        pipeline: APPROVAL_PIPELINES.SHOT.statuses as string[],
        nextStatus: null,
      })
    }
    // Compute forward options per shared rules.
    for (const p of positions) {
      p.nextStatus = p.pipeline.find((to) => isTransitionAllowed(p.entityType, p.status, to)) ?? null
    }
    return positions
  }, [scenes, shots])
}

function ApprovalsTab() {
  const positions = useApprovalPositions()
  const { data: log } = useApprovals()
  const transition = useApprovalTransition()
  const [actor, setActor] = useState('Director')

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* governed pipeline browser */}
      <div className="panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold tracking-wider text-mirai-dim uppercase">Pipeline</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-mirai-faint">Acting as</span>
            <Input className="h-6 w-32 text-xs" value={actor} onChange={(e) => setActor(e.target.value)} />
          </div>
        </div>
        {positions.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="Nothing to approve yet" description="Create scenes and shots — they appear here with their pipeline position." />
        ) : (
          <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
            {positions.map((p) => (
              <div key={`${p.entityType}-${p.entityId}`} className="rounded-md border border-mirai-line bg-mirai-panel px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-mirai-text">{p.title}</p>
                    <p className="text-[9px] tracking-wider text-mirai-faint uppercase">
                      {APPROVAL_ENTITY_LABEL[p.entityType]} · {p.status}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    <Select
                      className="h-6 w-28 px-1 text-[10px]"
                      value={p.nextStatus ?? ''}
                      disabled={!p.nextStatus}
                      onChange={(e) => {
                        if (!e.target.value) return
                        transition.mutate(
                          {
                            entityType: p.entityType,
                            entityId: p.entityId,
                            toStatus: e.target.value,
                            actorName: actor.trim() || 'Director',
                          },
                          {
                            onSuccess: () =>
                              toast({ kind: 'success', title: `${p.title} → ${e.target.value}` }),
                            onError: (err) =>
                              toast({ kind: 'error', title: 'Transition blocked', description: err.message }),
                          },
                        )
                      }}
                    >
                      {p.nextStatus ? (
                        <option value={p.nextStatus}>Advance → {p.nextStatus}</option>
                      ) : (
                        <option value="">FINAL</option>
                      )}
                      {p.pipeline
                        .filter((to) => to !== p.status)
                        .map((to) => (
                          <option key={to} value={to}>
                            Set {to}
                          </option>
                        ))}
                    </Select>
                  </div>
                </div>
                {/* pipeline dots */}
                <div className="mt-2 flex items-center gap-1">
                  {p.pipeline.map((s, i) => {
                    const active = p.pipeline.indexOf(p.status) >= i
                    return (
                      <div key={s} className="flex items-center gap-1">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wide',
                            s === p.status
                              ? 'bg-mirai-pink/25 text-mirai-pink'
                              : active
                                ? 'bg-mirai-hover text-mirai-dim'
                                : 'text-mirai-faint',
                          )}
                        >
                          {s}
                        </span>
                        {i < p.pipeline.length - 1 && <span className="h-px w-2 bg-mirai-line" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* audit log */}
      <div className="panel p-5">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-bold tracking-wider text-mirai-dim uppercase">
          <History className="h-3.5 w-3.5" /> Audit log
        </p>
        {(log ?? []).length === 0 ? (
          <p className="text-xs text-mirai-faint">No approvals yet — every governed transition lands here.</p>
        ) : (
          <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
            {(log ?? []).map((event) => (
              <div key={event.id} className="rounded-md border border-mirai-line bg-mirai-panel px-3 py-2">
                <p className="text-xs text-mirai-text">
                  <span className="font-semibold">{APPROVAL_ENTITY_LABEL[event.entityType]}</span>{' '}
                  <span className="text-mirai-faint">{event.fromStatus}</span>
                  <span className="mx-1 text-mirai-pink">→</span>
                  <span className="font-semibold text-mirai-pink">{event.toStatus}</span>
                </p>
                <p className="text-[10px] text-mirai-faint">
                  {new Date(event.createdAt).toLocaleString()} · by {event.actorName}
                </p>
                {event.note && <p className="mt-0.5 text-[10px] text-mirai-dim">“{event.note}”</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
