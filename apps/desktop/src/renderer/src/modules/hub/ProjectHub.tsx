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
import { Button, Card, Spinner } from '../../system/ui'
import { SkeletonList } from '../../system/Skeleton'
import { EmptyState, ErrorState } from '../../system/EmptyState'
import { ConfirmModal } from '../../system/Modal'
import { formatWhen } from '../../lib/utils'
import { invoke } from '../../lib/ipc'
import { useProjectAction, useProjects, useOpenProject, useSettings } from '../../lib/queries'
import { t } from '../../lib/i18n'
import { useAppStore, toast } from '../../store/appStore'
import { NewProjectModal } from './NewProjectModal'
import { PetalCanvas } from './PetalCanvas'

export function ProjectHub() {
  const { data: projects, isLoading, isError, error, refetch } = useProjects(true)
  const { data: settings } = useSettings()
  const locale = settings?.general.locale ?? 'en'
  const tr = (key: string) => t(locale, key)
  const newProjectOpen = useAppStore((s) => s.newProjectOpen)
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen)

  const active = (projects ?? []).filter((p) => p.status === 'ACTIVE')
  const archived = (projects ?? []).filter((p) => p.status === 'ARCHIVED')

  return (
    <div className="min-h-full">
      <Hero tr={tr} stats={{ active: active.length, archived: archived.length }} onCreate={() => setNewProjectOpen(true)} onOpen={() => void openFolderFlow()} />
      <div className="mx-auto w-full max-w-5xl px-8 pb-10">
        {isLoading ? (
          <SkeletonList rows={6} kind="card" />
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
              title={tr('No productions yet')}
              description="Start your first anime, manga or visual novel — Mirai sets up the full folder structure, database, story bible and a professional manga prompt library."
              action={
                <Button variant="primary" onClick={() => setNewProjectOpen(true)}>
                  <Plus className="h-4 w-4" /> {tr('Create your first project')}
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {active.length > 0 && (
              <section>
                <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.18em] text-mirai-faint uppercase">
                  {tr('Active productions')}
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {active.map((project) => (
                    <ProjectCard key={project.id} project={project} tr={tr} />
                  ))}
                </div>
              </section>
            )}
            {archived.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-3 font-display text-[11px] font-bold tracking-[0.18em] text-mirai-faint uppercase">
                  {tr('Archived')}
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {archived.map((project) => (
                    <ProjectCard key={project.id} project={project} tr={tr} dimmed />
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

function Hero({ tr, stats, onCreate, onOpen }: { tr: (k: string) => string; stats: { active: number; archived: number }; onCreate: () => void; onOpen: () => void }) {
  return (
    <div className="hero-glow relative overflow-hidden border-b border-mirai-border">
      <PetalCanvas className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-25" />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col justify-between gap-6 px-8 pt-16 pb-12 md:flex-row md:items-end">
        <div>
          <p className="mb-3 flex items-center gap-2 font-display text-[10px] font-bold tracking-[0.28em] text-mirai-faint uppercase">
            <span className="inline-block h-px w-8 bg-gradient-mirai" />
            {tr('Mirai Studio · Project Hub')}
          </p>
          <h1 className="font-display text-5xl leading-[1.05] font-bold tracking-tight text-mirai-text">
            {tr('Your stories,')}{' '}
            <span className="text-gradient-mirai">{tr('ready to become anime.')}</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-mirai-dim">
            {tr('From story bible to export — characters, scenes, screenplay and a curated manga prompt library. Everything stays on your machine.')}
          </p>
          {/* real stats from the registry */}
          <div className="mt-5 flex items-center gap-4 text-[11px] font-semibold text-mirai-faint">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {stats.active} {stats.active === 1 ? tr('active production') : tr('active productions')}
            </span>
            {stats.archived > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-mirai-faint" />
                {stats.archived} {tr('archived')}
              </span>
            ) : null}
            <span className="h-3 w-px bg-mirai-border-strong" />
            <span className="flex items-center gap-1.5 text-mirai-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-gradient-mirai" />
              100% local-first
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="lg" onClick={onOpen}>
            <FolderOpen className="h-4 w-4" /> {tr('Open Folder…')}
          </Button>
          <Button variant="primary" size="lg" onClick={onCreate}>
            <Plus className="h-4 w-4" /> {tr('New Project')}
          </Button>
        </div>
      </div>

      {/* capabilities strip — what ships inside every project */}
      <div className="relative mx-auto mt-8 w-full max-w-5xl px-8 pb-2">
        <div className="flex flex-wrap items-center gap-1.5 border-t border-mirai-border pt-5">
          <span className="mr-1 font-display text-[9px] font-bold tracking-[0.2em] text-mirai-faint uppercase">
            {tr('Inside every project')}
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

function ProjectCard({ project, tr, dimmed = false }: { project: ProjectSummary; tr: (k: string) => string; dimmed?: boolean }) {
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

  // a stable hue per project (id hash) — every card gets its own cover tone
  const hue = [...project.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7)

  return (
    <Card
      className={`card-lift group relative flex cursor-pointer flex-col overflow-hidden hover:border-mirai-accent/40 ${
        dimmed ? 'opacity-70 hover:opacity-100' : ''
      }`}
      onClick={openIt}
    >
      {/* cover band — per-project gradient with soft grain */}
      <div
        className="relative h-20 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 70% 24%), hsl(${(hue + 48) % 360} 72% 30%))`,
        }}
      >
        <div className="grid-overlay absolute inset-0 opacity-20" />
        <span
          className="absolute -bottom-8 -left-4 h-24 w-24 rounded-full blur-xl"
          style={{ background: `hsl(${(hue + 96) % 360} 80% 45% / 0.35)` }}
        />
        <span
          className={`absolute top-2.5 left-3 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase ${
            project.status === 'ACTIVE' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-white/70'
          }`}
        >
          {tr(project.status === 'ACTIVE' ? '● Active' : 'Archived')}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold text-mirai-text">
              {project.name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-mirai-faint">
              <Clock className="h-3 w-3" /> {formatWhen(project.lastOpenedAt ?? project.updatedAt)}
            </p>
          </div>
        <div
          className="relative -mt-1"
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
                  {tr('Open Project')}
                </MenuItem>
                <MenuItem
                  icon={<Package className="h-3.5 w-3.5" />}
                  onClick={() => run('Project duplicated', { kind: 'duplicate', id: project.id })}
                >
                  {tr('Duplicate')}
                </MenuItem>
                <MenuItem
                  icon={<HardDrive className="h-3.5 w-3.5" />}
                  onClick={() => run('Backup created', { kind: 'backup', id: project.id })}
                >
                  {tr('Back Up Now')}
                </MenuItem>
                <MenuItem
                  icon={<Package className="h-3.5 w-3.5" />}
                  onClick={() => run('Revealed in file manager', { kind: 'revealInFolder', id: project.id })}
                >
                  {tr('Reveal in Folder')}
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
                  {tr('Remove from List…')}
                </MenuItem>
              </div>
            </>
          )}
        </div>
        </div>

        {project.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-mirai-dim">{project.description}</p>
        ) : (
          <p className="text-xs italic text-mirai-faint">{tr('No description')}</p>
        )}

        <p className="mt-auto truncate text-[10px] text-mirai-faint" title={project.path}>
          {project.path}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-wider text-mirai-faint uppercase transition-colors group-hover:text-mirai-accent">
            {tr('Open')} →
          </span>
          {openProject.isPending && openProject.variables === project.path ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : null}
        </div>
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
