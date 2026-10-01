/**
 * UI-level global state (navigation, palette, modals, toasts).
 * Server data lives in TanStack Query — this store is pure view state.
 */
import { create } from 'zustand'

/** App-level views. */
export type AppView = 'hub' | 'settings' | 'diagnostics'
/** Project workspace views (require an open project). */
export type ProjectView =
  | 'overview'
  | 'bible'
  | 'style'
  | 'characters'
  | 'locations'
  | 'episodes'
  | 'storyboard'
  | 'timeline'
  | 'render'
  | 'production'
  | 'media'
  | 'prompts'
  | 'assist'
  | 'jobs'
  | 'backups'

export type MainView = AppView | ProjectView

export const PROJECT_VIEWS: readonly ProjectView[] = [
  'overview',
  'bible',
  'style',
  'characters',
  'locations',
  'episodes',
  'storyboard',
  'timeline',
  'render',
  'production',
  'media',
  'prompts',
  'assist',
  'jobs',
  'backups',
]

export function isProjectView(view: MainView): view is ProjectView {
  return (PROJECT_VIEWS as readonly string[]).includes(view)
}

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'warning' | 'error' | 'recovered'
  title: string
  description?: string
}

interface AppState {
  view: MainView
  paletteOpen: boolean
  newProjectOpen: boolean
  /** Prompt body seeded from the Prompt Library into the AI Assist input. */
  assistSeed: string | null
  toasts: Toast[]

  setView: (view: MainView) => void
  setPaletteOpen: (open: boolean) => void
  setNewProjectOpen: (open: boolean) => void
  setAssistSeed: (seed: string | null) => void
  pushToast: (toast: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'hub',
  paletteOpen: false,
  newProjectOpen: false,
  assistSeed: null,
  toasts: [],

  setView: (view) => set({ view }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setAssistSeed: (assistSeed) => set({ assistSeed }),

  pushToast: (toast) =>
    set((state) => {
      const id = Math.random().toString(36).slice(2)
      const entry: Toast = { id, ...toast }
      return { toasts: [...state.toasts, entry].slice(-4) }
    }),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

/** Fire-and-forget toast helper for non-component code (event bridge, etc). */
export const toast = (t: Omit<Toast, 'id'>) => useAppStore.getState().pushToast(t)
