/**
 * AppShell — sidebar navigation + main viewport + status bar.
 * Global shortcuts are registered here (spec §12).
 */
import { useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BookOpen,
  Building2,
  Clapperboard,
  Disc3,
  HardDriveDownload,
  Home,
  LayoutGrid,
  ListVideo,
  Palette,
  Play,
  Settings,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react'
import { isProjectView, useAppStore, type MainView } from '../store/appStore'
import { cn } from '../lib/utils'
import { Wordmark } from '../system/Logo'
import { Kbd } from '../system/ui'
import { ProjectHub } from '../modules/hub/ProjectHub'
import { OverviewPage } from '../modules/workspace/OverviewPage'
import { StoryBiblePage } from '../modules/bible/StoryBiblePage'
import { CharactersPage } from '../modules/characters/CharactersPage'
import { LocationsPage } from '../modules/locations/LocationsPage'
import { EpisodesPage } from '../modules/episodes/EpisodesPage'
import { PromptLibraryPage } from '../modules/prompts/PromptLibraryPage'
import { StoryboardPage } from '../modules/storyboard/StoryboardPage'
import { StyleBiblePage } from '../modules/style/StyleBiblePage'
import { AIAssistPage } from '../modules/assist/AIAssistPage'
import { MediaLibraryPage } from '../modules/media/MediaLibraryPage'
import { JobsPage } from '../modules/workspace/JobsPage'
import { BackupsPage } from '../modules/workspace/BackupsPage'
import { SettingsPage } from '../modules/settings/SettingsPage'
import { DiagnosticsPage } from '../modules/diagnostics/DiagnosticsPage'
import { StatusBar } from './StatusBar'
import { CommandPalette } from './CommandPalette'
import { ProjectHeader } from './ProjectHeader'
import { useCurrentProject } from '../lib/queries'

const APP_NAV: ReadonlyArray<{ view: MainView; label: string; icon: LucideIcon }> = [
  { view: 'hub', label: 'Project Hub', icon: Home },
  { view: 'settings', label: 'Settings', icon: Settings },
  { view: 'diagnostics', label: 'Diagnostics', icon: Activity },
]

const PROJECT_NAV: ReadonlyArray<{ view: MainView; label: string; icon: LucideIcon }> = [
  { view: 'overview', label: 'Overview', icon: Clapperboard },
  { view: 'bible', label: 'Story Bible', icon: BookOpen },
  { view: 'style', label: 'Style Bible', icon: Palette },
  { view: 'characters', label: 'Characters', icon: Users },
  { view: 'locations', label: 'Locations', icon: Building2 },
  { view: 'episodes', label: 'Episodes & Scenes', icon: ListVideo },
  { view: 'storyboard', label: 'Storyboard', icon: LayoutGrid },
  { view: 'media', label: 'Media Library', icon: Disc3 },
  { view: 'prompts', label: 'Prompt Library', icon: Wand2 },
  { view: 'assist', label: 'AI Assist', icon: Sparkles },
]

const PRODUCTION_NAV: ReadonlyArray<{ view: MainView; label: string; icon: LucideIcon }> = [
  { view: 'jobs', label: 'Jobs', icon: Play },
  { view: 'backups', label: 'Backups', icon: HardDriveDownload },
]

function NavGroup({
  title,
  items,
}: {
  title: string
  items: ReadonlyArray<{ view: MainView; label: string; icon: LucideIcon }>
}) {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  return (
    <div className="mt-4">
      <p className="mb-1 px-3 text-[10px] font-bold tracking-[0.16em] text-mirai-faint uppercase">
        {title}
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
                'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                  ? 'bg-mirai-hover text-mirai-text'
                  : 'text-mirai-dim hover:bg-mirai-hover/60 hover:text-mirai-text',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', active && 'text-mirai-accent')} />
              {item.label}
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setView('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen, setView])

  // Opening a project navigates to its overview; closing returns to the hub.
  useEffect(() => {
    if (current && !isProjectView(view)) setView('overview')
    if (!current && isProjectView(view)) setView('hub')
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
              <NavGroup title={`Project — ${current.name.slice(0, 14)}`} items={PROJECT_NAV} />
            )}
            {current && <NavGroup title="Production" items={PRODUCTION_NAV} />}
          </nav>
          <div className="mt-auto px-4 pb-4">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center justify-between rounded-md border border-mirai-border bg-mirai-panel px-3 py-2 text-xs text-mirai-faint transition-colors hover:border-mirai-border-strong hover:text-mirai-dim"
            >
              Command palette
              <span className="flex items-center gap-0.5">
                <Kbd>Ctrl</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {current && isProjectView(view) && <ProjectHeader />}
          {view === 'hub' && <ProjectHub />}
          {view === 'overview' && <OverviewPage />}
          {view === 'bible' && <StoryBiblePage />}
          {view === 'characters' && <CharactersPage />}
          {view === 'locations' && <LocationsPage />}
          {view === 'episodes' && <EpisodesPage />}
          {view === 'storyboard' && <StoryboardPage />}
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
