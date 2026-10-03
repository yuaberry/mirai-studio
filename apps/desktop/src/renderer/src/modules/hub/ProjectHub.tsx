/**
 * Project Hub (Module 01) — the studio front door, v0.2:
 * cinematic hero, production cards with format chips, real actions.
 */
import { useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Clock,
  FolderOpen,
  HardDrive,
  MoreVertical,
  Package,
  Plus,
  Trash2,
} from 'lucide-react'
import { MiraiError, type ProjectSummary } from '@mirai/shared'
import { Badge, Button, Card, Spinner } from '../../system/ui'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'
import { formatWhen } from '../../lib/utils'
import { invoke } from '../../lib/ipc'
import { useProjectAction, useProjects, useOpenProject } from '../../lib/queries'
import { useAppStore, toast } from '../../store/appStore'
import { NewProjectModal } from './NewProjectModal'

export function ProjectHub() {
  const { data: projects, isLoading, isError, error, refetch } = useProjects(true)
  const newProjectOpen = useAppStore((s) => s.newProjectOpen)
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen)

  const active = (projects ?? []).filter((p) => p.status === 'ACTIVE')
  const archived = (projects ?? []).filter((p) => p.status === 'ARCHIVED')

  return (
    <div className="min-h-full">
      <Hero onCreate={() => setNewProjectOpen(true)} onOpen={() => void openFolderFlow()} />
      <div className="mx-auto w-full max-w-5xl px-8 pb-10">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn't load projects"
            message={error instanceof MiraiError ? error.message : 'The project registry failed to load.'}
            onRetry={() => void refetch()}
          />
        ) : active.length === 0 && archived.length === 0 ? (
          <Card className="border-dashed">
            <EmptyState
              icon={<Plus className="h-5 w-5" />}
              title="No productions yet"
              description="Start your first anime, manga or visual novel — Mirai sets up the full folder structure, database, story bible and a professional manga prompt library."
              action={
                <Button variant="primary" onClick={() => setNewProjectOpen(true)}>
                  <Plus className="h-4 w-4" /> Create your first project
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {active.length > 0 && (
              <section>
                <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.18em] text-mirai-faint uppercase">
                  Active productions
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {active.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              </section>
            )}
            {archived.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.18em] text-mirai-faint uppercase">
                  Archived
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {archived.map((project) => (
                    <ProjectCard key={project.id} project={project} dimmed />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  )
}

function Hero({ onCreate, onOpen }: { onCreate: () => void; onOpen: () => void }) {
  return (
    <div className="hero-glow relative overflow-hidden border-b border-mirai-border">
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col justify-between gap-6 px-8 py-12 md:flex-row md:items-end">
        <div>
          <p className="mb-2 flex items-center gap-2 font-display text-[10px] font-bold tracking-[0.28em] text-mirai-faint uppercase">
            <span className="inline-block h-px w-8 bg-gradient-mirai" />
            Mirai Studio · Project Hub
          </p>
          <h1 className="font-display text-4xl leading-tight font-bold text-mirai-text">
            Your <span className="text-gradient-mirai">stories</span>,
            <br />
            ready to become anime.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-mirai-dim">
            From story bible to export — characters, scenes, screenplay and a curated
            manga prompt library. Everything stays on your machine.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="lg" onClick={onOpen}>
            <FolderOpen className="h-4 w-4" /> Open Folder…
          </Button>
          <Button variant="primary" size="lg" onClick={onCreate}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        </div>
      </div>

      {/* capabilities strip — what ships inside every project */}
      <div className="relative mx-auto mt-8 w-full max-w-5xl px-8 pb-2">
        <div className="flex flex-wrap items-center gap-1.5 border-t border-mirai-border pt-5">
          <span className="mr-1 font-display text-[9px] font-bold tracking-[0.2em] text-mirai-faint uppercase">
            Inside every project
          </span>
          {[
            'Story Bible',
            'Storyboard',
            'Timeline Editor',
            'Audio Mixer',
            'Camera Keyframes',
            'Subtitles',
            'Voice & Music',
            'FFmpeg Render',
            'Producer Agent',
            'AI Workflows',
            'Production Board',
            'Plugins',
          ].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-mirai-border bg-mirai-panel px-2.5 py-0.5 text-[10px] font-semibold text-mirai-dim"
            >
              {chip}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-3 text-[10px] text-mirai-faint">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> 100% local-first
            </span>
            <span>·</span>
            <span>Your keys, your machine</span>
          </span>
        </div>
      </div>
    </div>
  )
}

async function openFolderFlow(): Promise<void> {
  try {
    const { path } = await invoke('projects:pickDirectory')
    if (!path) return
    await invoke('projects:open', { path })
  } catch (err) {
    toast({ kind: 'error', title: 'Open project failed', description: (err as Error).message })
  }
}

function ProjectCard({ project, dimmed = false }: { project: ProjectSummary; dimmed?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const action = useProjectAction()
  const openProject = useOpenProject()
  const setView = useAppStore((s) => s.setView)

  const run = (label: string, act: Parameters<typeof action.mutate>[0]) => {
    setMenuOpen(false)
    action.mutate(act, {
      onSuccess: () => toast({ kind: 'success', title: label }),
      onError: (err) => toast({ kind: 'error', title: label, description: err.message }),
    })
  }

  const openIt = () => {
    openProject.mutate(project.path, {
      onSuccess: (p) => {
        toast({ kind: 'success', title: `Opened “${p.name}”` })
        setView('overview')
      },
      onError: (err) =>
        toast({ kind: 'error', title: `Couldn't open “${project.name}”`, description: err.message }),
    })
  }

  return (
    <Card
      className={`group relative flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-mirai-accent/40 ${
        dimmed ? 'opacity-60 hover:opacity-100' : ''
      }`}
      onClick={openIt}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold text-mirai-text">
            {project.name}
          </h3>
          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-mirai-faint">
            <Clock className="h-3 w-3" /> {formatWhen(project.lastOpenedAt ?? project.updatedAt)}
          </p>
        </div>
        <div
          className="relative"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            aria-label="Project actions"
            className="rounded-md p-1 text-mirai-faint opacity-0 transition-opacity hover:bg-mirai-hover hover:text-mirai-text focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 w-52 animate-scale-in rounded-lg border border-mirai-border-strong bg-mirai-panel py-1 shadow-xl shadow-black/50">
                <MenuItem icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={openIt}>
                  Open Project
                </MenuItem>
                <MenuItem
                  icon={<Package className="h-3.5 w-3.5" />}
                  onClick={() => run('Project duplicated', { kind: 'duplicate', id: project.id })}
                >
                  Duplicate
                </MenuItem>
                <MenuItem
                  icon={<HardDrive className="h-3.5 w-3.5" />}
                  onClick={() => run('Backup created', { kind: 'backup', id: project.id })}
                >
                  Back Up Now
                </MenuItem>
                <MenuItem
                  icon={<Package className="h-3.5 w-3.5" />}
                  onClick={() => run('Revealed in file manager', { kind: 'revealInFolder', id: project.id })}
                >
                  Reveal in Folder
                </MenuItem>
                {project.status === 'ACTIVE' ? (
                  <MenuItem
                    icon={<Archive className="h-3.5 w-3.5" />}
                    onClick={() => run('Project archived', { kind: 'archive', id: project.id })}
                  >
                    Archive
                  </MenuItem>
                ) : (
                  <MenuItem
                    icon={<ArchiveRestore className="h-3.5 w-3.5" />}
                    onClick={() => run('Project restored', { kind: 'restore', id: project.id })}
                  >
                    Restore from Archive
                  </MenuItem>
                )}
                <div className="my-1 border-t border-mirai-border" />
                <MenuItem
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  danger
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmRemove(true)
                  }}
                >
                  Remove from List…
                </MenuItem>
              </div>
            </>
          )}
        </div>
      </div>

      {project.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-mirai-dim">{project.description}</p>
      ) : (
        <p className="text-xs italic text-mirai-faint">No description</p>
      )}

      <p className="truncate text-[10px] text-mirai-faint" title={project.path}>
        {project.path}
      </p>

      <div className="flex items-center justify-between">
        <Badge tone={project.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {project.status === 'ACTIVE' ? '● Active' : 'Archived'}
        </Badge>
        {openProject.isPending && openProject.variables === project.path ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : null}
      </div>

      <ConfirmModal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove “${project.name}” from the list?`}
        description="The project folder and all its files stay untouched on disk — you can re-import it anytime with Open Folder. This only removes it from the Project Hub."
        confirmLabel="Remove from List"
        danger
        busy={action.isPending}
        onConfirm={() => {
          action.mutate(
            { kind: 'removeFromList', id: project.id },
            {
              onSuccess: () => {
                setConfirmRemove(false)
                toast({ kind: 'success', title: 'Removed from list (files kept)' })
              },
              onError: (err) =>
                toast({ kind: 'error', title: 'Remove failed', description: err.message }),
            },
          )
        }}
      />
    </Card>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors ${
        danger
          ? 'text-mirai-danger hover:bg-mirai-danger/10'
          : 'text-mirai-dim hover:bg-mirai-hover hover:text-mirai-text'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
