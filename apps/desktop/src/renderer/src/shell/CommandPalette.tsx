/**
 * Command Palette (Ctrl+K) — spec §11. Every action is real: it either calls
 * IPC or navigates. Commands contextual to the open project show only when
 * a project is open — no dead entries, ever.
 */
import { Command } from 'cmdk'
import { useQueryClient } from '@tanstack/react-query'
import {
  FolderOpen,
  HardDriveDownload,
  Home,
  LifeBuoy,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wand2,
  Wrench,
  X,
} from 'lucide-react'
import { invoke } from '../lib/ipc'
import { queryKeys, useCurrentProject, useJobActions, useProjectAction } from '../lib/queries'
import { useAppStore, toast } from '../store/appStore'
import { ItemStyles } from './paletteStyles'

export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen)
  const setOpen = useAppStore((s) => s.setPaletteOpen)
  const setView = useAppStore((s) => s.setView)
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen)
  const { data: current } = useCurrentProject()
  const projectAction = useProjectAction()
  const jobActions = useJobActions()
  const queryClient = useQueryClient()

  const run = (label: string, fn: () => unknown) => () => {
    setOpen(false)
    Promise.resolve(fn()).catch((err: Error) =>
      toast({ kind: 'error', title: label, description: err.message }),
    )
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      loop
      overlayClassName="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] p-6 flex items-start justify-center pt-[15vh]"
      contentClassName="w-full max-w-xl animate-scale-in overflow-hidden rounded-xl border border-mirai-border-strong bg-mirai-raise shadow-2xl shadow-black/50"
    >
      <div className="flex items-center gap-2.5 border-b border-mirai-border px-4">
        <Search className="h-4 w-4 text-mirai-faint" />
        <Command.Input
          autoFocus
          placeholder="Type a command…"
          className="h-11 flex-1 bg-transparent text-sm text-mirai-text placeholder:text-mirai-faint focus:outline-none"
        />
        <span className="text-[10px] font-semibold tracking-widest text-mirai-faint uppercase">
          Mirai
        </span>
      </div>
      <Command.List className="max-h-80 overflow-y-auto overflow-x-hidden p-2">
        <Command.Empty className="px-3 py-8 text-center text-xs text-mirai-faint">
          No matching command.
        </Command.Empty>

        <Command.Group heading="Project" className={ItemStyles.group}>
          <Command.Item className={ItemStyles.item} onSelect={run('New Project', () => setNewProjectOpen(true))}>
            <Plus className="h-4 w-4" /> New Project…
          </Command.Item>
          <Command.Item
            className={ItemStyles.item}
            onSelect={run('Open Project', async () => {
              const { path } = await invoke('projects:pickDirectory')
              if (!path) return
              const { project } = await invoke('projects:open', { path })
              toast({ kind: 'success', title: `Opened “${project.name}”` })
            })}
          >
            <FolderOpen className="h-4 w-4" /> Open Project Folder…
          </Command.Item>
          {current && (
            <>
              <Command.Item className={ItemStyles.item} onSelect={run('Close Project', () => invoke('projects:close'))}>
                <X className="h-4 w-4" /> Close “{current.name}”
              </Command.Item>
              <Command.Item
                className={ItemStyles.item}
                onSelect={run('Validation', async () => {
                  await invoke('projects:validate')
                  toast({ kind: 'info', title: 'Validation queued', description: 'Watch the Jobs panel for results.' })
                })}
              >
                <ShieldCheck className="h-4 w-4" /> Run Continuity/Project Validation
              </Command.Item>
              <Command.Item
                className={ItemStyles.item}
                onSelect={run('Backup', async () => {
                  const { backup } = await invoke('projects:backup', { id: current.id })
                  toast({ kind: 'success', title: `Backup created (${backup.id})` })
                  void queryClient.invalidateQueries({ queryKey: queryKeys.backups(current.id) })
                })}
              >
                <HardDriveDownload className="h-4 w-4" /> Back Up “{current.name}”
              </Command.Item>
              <Command.Item
                className={ItemStyles.item}
                onSelect={run('Reveal folder', () => projectAction.mutate({ kind: 'revealInFolder', id: current.id }))}
              >
                <Package className="h-4 w-4" /> Reveal Project Folder
              </Command.Item>
              <Command.Item
                className={ItemStyles.item}
                onSelect={run('Resume interrupted jobs', () => jobActions.mutate({ kind: 'resumeInterrupted' }))}
              >
                <RotateCcw className="h-4 w-4" /> Resume Interrupted Jobs
              </Command.Item>
            </>
          )}
        </Command.Group>

        <Command.Group heading="Navigate" className={ItemStyles.group}>
          <Command.Item className={ItemStyles.item} onSelect={run('Hub', () => setView('hub'))}>
            <Home className="h-4 w-4" /> Go to Project Hub
          </Command.Item>
          {current && (
            <>
              <Command.Item className={ItemStyles.item} onSelect={run('Workspace', () => setView('overview'))}>
                <Wrench className="h-4 w-4" /> Go to Project Overview
              </Command.Item>
              <Command.Item className={ItemStyles.item} onSelect={run('Prompt Library', () => setView('prompts'))}>
                <Wand2 className="h-4 w-4" /> Go to Prompt Library
              </Command.Item>
              <Command.Item className={ItemStyles.item} onSelect={run('AI Assist', () => setView('assist'))}>
                <Sparkles className="h-4 w-4" /> Go to AI Assist
              </Command.Item>
            </>
          )}
          <Command.Item className={ItemStyles.item} onSelect={run('Settings', () => setView('settings'))}>
            <Settings className="h-4 w-4" /> Go to Settings
          </Command.Item>
          <Command.Item className={ItemStyles.item} onSelect={run('Diagnostics', () => setView('diagnostics'))}>
            <LifeBuoy className="h-4 w-4" /> Go to Diagnostics
          </Command.Item>
        </Command.Group>

        <Command.Group heading="System" className={ItemStyles.group}>
          <Command.Item
            className={ItemStyles.item}
            onSelect={run('Logs folder', () => invoke('logs:revealLogsFolder'))}
          >
            <Terminal className="h-4 w-4" /> Reveal Logs Folder
          </Command.Item>
          <Command.Item className={ItemStyles.item} onSelect={run('Reload', () => invoke('app:reload'))}>
            <RefreshCw className="h-4 w-4" /> Reload Window
          </Command.Item>
          <Command.Item className={ItemStyles.item} onSelect={run('DevTools', () => invoke('app:toggleDevtools'))}>
            <Wrench className="h-4 w-4" /> Toggle Developer Tools
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
