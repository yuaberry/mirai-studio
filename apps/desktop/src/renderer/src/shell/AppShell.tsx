/**
 * AppShell — sidebar navigation + main viewport + status bar.
 * Global shortcuts are registered here (spec §12).
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AudioWaveform,
  BarChart3,
  Captions,
  FileVideo,
  Workflow,
  BookOpen,
  Building2,
  Clapperboard,
  Disc3,
  HardDriveDownload,
  Home,
  LayoutGrid,
  ListVideo,
  PanelTop,
  Palette,
  Play,
  Puzzle,
  Settings,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react'
import { isProjectView, PROJECT_VIEWS, useAppStore, type MainView, type ProjectView } from '../store/appStore'
import type { AppSettingsPatch } from '@mirai/shared'
import { invoke } from '../lib/ipc'
import { cn } from '../lib/utils'
import { Wordmark } from '../system/Logo'
import { Kbd } from '../system/ui'
import { ProjectHub } from '../modules/hub/ProjectHub'
import { OverviewPage } from '../modules/workspace/OverviewPage'
import { StoryBiblePage } from '../modules/bible/StoryBiblePage'
import { CharactersPage } from '../modules/characters/CharactersPage'
import { LocationsPage } from '../modules/locations/LocationsPage'
import { EpisodesPage } from '../modules/episodes/EpisodesPage'
import { MangaStudioPage } from '../modules/manga/MangaStudioPage'
import { PromptLibraryPage } from '../modules/prompts/PromptLibraryPage'
import { StoryboardPage } from '../modules/storyboard/StoryboardPage'
import { StyleBiblePage } from '../modules/style/StyleBiblePage'
import { AIAssistPage } from '../modules/assist/AIAssistPage'
import { MediaLibraryPage } from '../modules/media/MediaLibraryPage'
import { JobsPage } from '../modules/workspace/JobsPage'
import { BackupsPage } from '../modules/workspace/BackupsPage'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { DiagnosticsPage } from '../modules/diagnostics/DiagnosticsPage'
import { useSettings } from '../lib/queries'
import { t } from '../lib/i18n'
import { registerShortcutHandler, useShortcutDispatcher } from '../lib/shortcuts'
import { TimelinePage } from '../modules/timeline/TimelinePage'
import { RenderPage } from '../modules/render/RenderPage'
import { ProductionPage } from '../modules/production/ProductionPage'
import { SubtitlesPage } from '../modules/subtitles/SubtitlesPage'
import { WorkflowsPage } from '../modules/workflows/WorkflowsPage'
import { PluginsPage } from '../modules/plugins/PluginsPage'
import { ProducerPage } from '../modules/producer/ProducerPage'
import { StatusBar } from './StatusBar'
import { CommandPalette } from './CommandPalette'
import { ProjectHeader } from './ProjectHeader'
import { useCurrentProject } from '../lib/queries'

interface NavEntry {
  view: MainView
  label: string
  icon: LucideIcon
}

const APP_NAV: ReadonlyArray<NavEntry> = [
  { view: 'hub', label: 'Project Hub', icon: Home },
  { view: 'settings', label: 'Settings', icon: Settings },
  { view: 'diagnostics', label: 'Diagnostics', icon: Activity },
]

/* v0.26 — the project section is grouped by WORKFLOW PHASE, not a flat
 * 18-item list: story → manga/animatic → production → AI/library. */
const PROJECT_NAV: ReadonlyArray<NavEntry> = [
  { view: 'overview', label: 'Overview', icon: Clapperboard },
  { view: 'bible', label: 'Story Bible', icon: BookOpen },
  { view: 'style', label: 'Style Bible', icon: Palette },
  { view: 'characters', label: 'Characters', icon: Users },
  { view: 'locations', label: 'Locations', icon: Building2 },
  { view: 'episodes', label: 'Episodes & Scenes', icon: ListVideo },
]

const MANGA_NAV: ReadonlyArray<NavEntry> = [
  { view: 'manga', label: 'Manga Studio', icon: PanelTop },
  { view: 'storyboard', label: 'Storyboard', icon: LayoutGrid },
  { view: 'timeline', label: 'Timeline', icon: AudioWaveform },
  { view: 'subtitles', label: 'Subtitles', icon: Captions },
]

const PRODUCTION_NAV: ReadonlyArray<NavEntry> = [
  { view: 'render', label: 'Render & Export', icon: FileVideo },
  { view: 'production', label: 'Production', icon: BarChart3 },
  { view: 'jobs', label: 'Jobs', icon: Play },
  { view: 'backups', label: 'Backups', icon: HardDriveDownload },
]

const AI_NAV: ReadonlyArray<NavEntry> = [
  { view: 'producer', label: 'Producer Agent', icon: Wand2 },
  { view: 'workflows', label: 'AI Workflows', icon: Workflow },
  { view: 'assist', label: 'AI Assist', icon: Sparkles },
  { view: 'prompts', label: 'Prompt Library', icon: Wand2 },
  { view: 'media', label: 'Media Library', icon: Disc3 },
  { view: 'plugins', label: 'Plugins', icon: Puzzle },
]

function NavGroup({
  title,
  items,
}: {
  title: string
  items: ReadonlyArray<NavEntry>
}) {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const { data: settings } = useSettings()
  const locale = settings?.general.locale ?? 'en'
  return (
    <div className="mt-4">
      <p className="mb-1 px-3 text-[10px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
        {t(locale, title)}
      </p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon
          const active = view === item.view
          return (
            <button
              key={item.view}
              onClick={() => setView(item.view)}
              className={cn(
                'relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                  ? 'bg-mirai-hover text-mirai-text'
                  : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text',
              )}
            >
              <span
                className={cn(
                  'absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity',
                  active ? 'bg-gradient-mirai opacity-100' : 'opacity-0',
                )}
              />
              <Icon className={cn('h-3.5 w-3.5', active && 'text-mirai-accent')} />
              {t(locale, item.label)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AppShell() {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen)
  const { data: current } = useCurrentProject()
  const { data: settings } = useSettings()
  const queryClient = useQueryClient()

  // THEME (v0.17): data-theme swaps every CSS var (see tokens.css); the
  // custom theme also injects the user's accent color inline.
  useEffect(() => {
    const theme = settings?.appearance.theme ?? 'dark'
    document.documentElement.dataset.theme = theme
    const accent = settings?.appearance.customAccent
    if (theme === 'custom' && accent) {
      document.documentElement.style.setProperty('--accent', accent)
      // Derived companions keep the gradient cohesive with any hue.
      document.documentElement.style.setProperty('--accent-2', `color-mix(in srgb, ${accent} 55%, #a78bfa)`)
      document.documentElement.style.setProperty('--accent-3', `color-mix(in srgb, ${accent} 35%, #22d3ee)`)
    } else {
      document.documentElement.style.removeProperty('--accent')
      document.documentElement.style.removeProperty('--accent-2')
      document.documentElement.style.removeProperty('--accent-3')
    }
  }, [settings?.appearance.theme, settings?.appearance.customAccent])

  // RESPONSIVENESS: the whole suite is rem-based — scaling the root font-size
  // resizes every panel, text and spacing to fit any screen.
  // Layers: density (comfortable/compact) × autoFit (window-height adaptive
  // base) × uiScale (the user's multiplier). Auto-fit makes the app shrink
  // ITSELF on small screens — the user never has to hunt for a setting.
  useEffect(() => {
    const apply = () => {
      const density = settings?.appearance.density ?? 'comfortable'
      const scale = settings?.appearance.uiScale ?? 1
      const autoFit = settings?.appearance.autoFit ?? true
      let base = density === 'compact' ? 14 : 16
      if (autoFit) {
        const vh = window.innerHeight
        if (vh < 640) base = Math.min(base, 12.5)
        else if (vh < 740) base = Math.min(base, 13.5)
        else if (vh < 860) base = Math.min(base, 14.5)
      }
      document.documentElement.style.fontSize = `${base * scale}px`
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [settings?.appearance.density, settings?.appearance.uiScale, settings?.appearance.autoFit])

  // The FULL configurable shortcut system (Phase 5): defaults ⊕ user overrides.
  useShortcutDispatcher(settings)

  useEffect(() => {
    const cleanups = [
      registerShortcutHandler('app.palette', () => setPaletteOpen(true)),
    ]
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === ',') {
        e.preventDefault()
        setView('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      cleanups.forEach((fn) => fn())
    }
  }, [setPaletteOpen, setView])

  // Opening a project navigates to its LAST ACTIVE VIEW when we have one
  // recorded (session persistence — the user never loses their place);
  // a fresh project lands on overview. Closing returns to the hub.
  useEffect(() => {
    if (current && !isProjectView(view)) {
      const remembered = settings?.session.lastViewByProject[current.id]
      const valid = remembered && (PROJECT_VIEWS as readonly string[]).includes(remembered)
      setView(valid ? (remembered as ProjectView) : 'overview')
    }
    if (!current && isProjectView(view)) setView('hub')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  // SESSION PERSISTENCE (v0.14): record the active view per project and the
  // last opened project path so the next launch resumes where the user was.
  // Debounced — rapid navigation only writes the final destination.
  useEffect(() => {
    if (!settings) return
    const timer = setTimeout(() => {
      const patch: AppSettingsPatch = { session: { ...settings.session, lastProjectPath: current?.path ?? settings.session.lastProjectPath } }
      if (current && isProjectView(view)) {
        patch.session = {
          ...patch.session!,
          lastViewByProject: { ...settings.session.lastViewByProject, [current.id]: view },
        }
      }
      void invoke('settings:update', { settings: patch }).catch(() => {
        /* session state is best-effort — never block navigation on it */
      })
    }, 600)
    return () => clearTimeout(timer)
    // `current` is read via current?.id/current?.path — the full object is
    // intentionally not a dependency (no re-fire on unrelated refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, current?.id, current?.path, settings])

  // RESUME ON LAUNCH: quietly reopen the last project so the user picks up
  // exactly where they left off instead of starting from the Hub.
  // NEVER while the user is already acting on the Hub (New Project modal
  // open) — auto-navigating away mid-typing destroyed their form once.
  useEffect(() => {
    const lastPath = settings?.session.lastProjectPath
    if (!lastPath || current) return
    if (useAppStore.getState().newProjectOpen) return
    let cancelled = false
    void invoke('projects:open', { path: lastPath })
      .then(() => {
        if (!cancelled && !useAppStore.getState().newProjectOpen) {
          void queryClient.invalidateQueries({ queryKey: ['project'] })
          void queryClient.invalidateQueries({ queryKey: ['projects'] })
        }
      })
      .catch(() => {
        /* the project may have moved/deleted — stay on the Hub quietly */
      })
    return () => {
      cancelled = true
    }
    // Run once per launch, after settings load. `current` is intentionally
    // NOT a dependency: re-running on project load would reopen in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.session.lastProjectPath])

  return (
    <div className="flex h-screen flex-col bg-mirai-base">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-mirai-border bg-mirai-raise/60">
          <div className="px-4 py-4">
            <Wordmark />
          </div>
          <nav className="px-2 pb-4">
            <NavGroup title="App" items={APP_NAV} />
            {current && (
              <>
                <NavGroup title={current.name.slice(0, 16)} items={PROJECT_NAV} />
                <NavGroup title="Manga & Animatic" items={MANGA_NAV} />
                <NavGroup title="Production & Delivery" items={PRODUCTION_NAV} />
                <NavGroup title="AI & Library" items={AI_NAV} />
              </>
            )}
          </nav>
          <div className="mt-auto px-4 pb-4">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center justify-between rounded-md border border-mirai-border bg-mirai-panel px-3 py-2 text-xs text-mirai-faint transition-colors hover:border-mirai-border-strong hover:text-mirai-dim"
            >
              {t(settings?.general.locale ?? 'en', 'Command palette')}
              <span className="flex items-center gap-0.5">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <div className="mt-3 flex items-center justify-between border-t border-mirai-border pt-3">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-mirai-faint uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-gradient-mirai" />
                v0.26.0
              </span>
              <a
                href="https://github.com/yuaberry/mirai-studio"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-mirai-faint transition-colors hover:text-mirai-accent"
                title="Star Mirai Studio on GitHub"
              >
                ★ on GitHub
              </a>
            </div>
          </div>
        </aside>
        <main key={view} className="animate-view-in flex min-w-0 flex-1 flex-col overflow-y-auto">
          {current && isProjectView(view) && <ProjectHeader />}
          {view === 'hub' && <ProjectHub />}
          {view === 'overview' && <OverviewPage />}
          {view === 'bible' && <StoryBiblePage />}
          {view === 'characters' && <CharactersPage />}
          {view === 'locations' && <LocationsPage />}
          {view === 'episodes' && <EpisodesPage />}
          {view === 'manga' && <MangaStudioPage />}
          {view === 'storyboard' && <StoryboardPage />}
          {view === 'timeline' && <TimelinePage />}
          {view === 'render' && <RenderPage />}
          {view === 'production' && <ProductionPage />}
          {view === 'subtitles' && <SubtitlesPage />}
          {view === 'workflows' && <WorkflowsPage />}
          {view === 'producer' && <ProducerPage />}
          {view === 'plugins' && <PluginsPage />}
          {view === 'style' && <StyleBiblePage />}
          {view === 'media' && <MediaLibraryPage />}
          {view === 'prompts' && <PromptLibraryPage />}
          {view === 'assist' && <AIAssistPage />}
          {view === 'jobs' && <JobsPage />}
          {view === 'backups' && <BackupsPage />}
          {view === 'settings' && <SettingsPage />}
          {view === 'diagnostics' && <DiagnosticsPage />}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  )
}
