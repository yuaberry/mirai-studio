/**
 * TanStack Query hooks over the typed IPC client. Loading / error / empty
 * states come for free — every module uses these instead of manual state.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AppSettings,
  type AssetRecord,
  type BackupInfo,
  type CharacterInput,
  type CharacterRecord,
  type EpisodeInput,
  type EpisodeRecord,
  type EpisodeWithStats,
  type HealthReport,
  type JobRecord,
  type LocationInput,
  type LocationRecord,
  type LogEntry,
  type OpenedProject,
  type ProjectConfig,
  type ProjectSummary,
  type PromptInput,
  type PromptRecord,
  type SceneInput,
  type SceneRecord,
  type ShotInput,
  type ShotRecord,
  type StoryBible as StoryBibleType,
  type StyleBible as StyleBibleType,
} from '@mirai/shared'
import { invoke } from './ipc'

export const queryKeys = {
  projects: (includeArchived: boolean) => ['projects', includeArchived] as const,
  currentProject: ['project', 'current'] as const,
  settings: ['settings'] as const,
  health: ['health'] as const,
  jobs: ['jobs'] as const,
  logs: (q: { level?: string; category?: string; search?: string }) => ['logs', q] as const,
  credentials: ['credentials', 'status'] as const,
  backups: (projectId: string) => ['backups', projectId] as const,
}

export const creativeKeys = {
  bible: ['story-bible'] as const,
  characters: ['characters'] as const,
  locations: ['locations'] as const,
  episodes: ['episodes'] as const,
  scenes: (episodeId: string) => ['scenes', episodeId] as const,
  prompts: ['prompts'] as const,
  shots: (sceneId: string) => ['shots', sceneId] as const,
  styleBible: ['style-bible'] as const,
  aiModels: (force: boolean) => ['ai', 'models', force] as const,
}

// ---------------------------------------------------------------- projects

export function useProjects(includeArchived: boolean) {
  return useQuery({
    queryKey: queryKeys.projects(includeArchived),
    queryFn: () => invoke('projects:list', { includeArchived }).then((r) => r.projects),
  })
}

export function useCurrentProject() {
  return useQuery({
    queryKey: queryKeys.currentProject,
    queryFn: () => invoke('projects:current').then((r) => r.project),
  })
}

export function useOpenProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => invoke('projects:open', { path }).then((r) => r.project),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentProject })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
    },
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      description?: string
      dir: string
      config: ProjectConfig
    }) => invoke('projects:create', input).then((r) => r.project),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useCloseProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => invoke('projects:close'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentProject })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
    },
  })
}

export function useProjectAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: {
      kind:
        | 'duplicate'
        | 'archive'
        | 'restore'
        | 'removeFromList'
        | 'revealInFolder'
        | 'backup'
      id: string
    }) => {
      const channel = `projects:${action.kind}` as const
      return invoke(channel, { id: action.id })
    },
    onSuccess: (_data, action) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (action.kind === 'backup') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.backups(action.id) })
      }
    },
  })
}

export function useUpdateProjectConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (config: ProjectConfig) =>
      invoke('projects:updateConfig', { config }).then((r) => r.manifest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentProject })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useValidateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => invoke('projects:validate').then((r) => r.jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs }),
  })
}

// ---------------------------------------------------------------- backups

export function useBackups(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.backups(projectId ?? 'none'),
    queryFn: () => invoke('projects:listBackups', { id: projectId! }).then((r) => r.backups),
    enabled: projectId !== undefined,
  })
}

export function useBackupActions(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: { kind: 'restoreBackup' | 'deleteBackup'; backupId: string }) =>
      invoke(`projects:${action.kind}` as 'projects:restoreBackup', {
        id: projectId,
        backupId: action.backupId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.backups(projectId) }),
  })
}

// ---------------------------------------------------------------- settings

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => invoke('settings:get').then((r) => r.settings),
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: AppSettings) =>
      invoke('settings:update', { settings }).then((r) => r.settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  })
}

// ---------------------------------------------------------------- credentials

export function useCredentialsStatus() {
  return useQuery({
    queryKey: queryKeys.credentials,
    queryFn: () => invoke('credentials:status').then((r) => r.credentials),
  })
}

export function useSetCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { key: 'openrouter'; value: string }) =>
      invoke('credentials:set', input).then((r) => r.secure),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.credentials }),
  })
}

export function useClearCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: 'openrouter') => invoke('credentials:clear', { key }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.credentials }),
  })
}

// ---------------------------------------------------------------- jobs

export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => invoke('jobs:list').then((r) => r.jobs as JobRecord[]),
  })
}

export function useJobActions() {
  const queryClient = useQueryClient()
  return useMutation<
    number | { ok: boolean },
    Error,
    { kind: 'retry' | 'cancel' | 'resumeInterrupted' | 'discardInterrupted'; id?: string }
  >({
    mutationFn: async (action) => {
      if (action.kind === 'resumeInterrupted') {
        return invoke('jobs:resumeInterrupted').then((r) => r.resumed)
      }
      if (action.kind === 'discardInterrupted') {
        return invoke('jobs:discardInterrupted').then((r) => r.discarded)
      }
      return invoke(`jobs:${action.kind}` as 'jobs:retry', { id: action.id! })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs }),
  })
}

// ---------------------------------------------------------------- logs

export function useLogs(query: { level?: string; category?: string; search?: string }) {
  return useQuery({
    queryKey: queryKeys.logs(query),
    queryFn: () =>
      invoke('logs:recent', { limit: 300, ...query }).then((r) => r.entries as LogEntry[]),
  })
}

// ---------------------------------------------------------------- system

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => invoke('system:health').then((r) => r.health as HealthReport),
  })
}

// ---------------------------------------------------------------- Story Bible

export function useStoryBible() {
  return useQuery({
    queryKey: creativeKeys.bible,
    queryFn: () => invoke('story-bible:get').then((r) => r.bible),
  })
}

export function useUpdateStoryBible() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (bible: StoryBibleType) =>
      invoke('story-bible:update', { bible }).then((r) => r.bible),
    onSuccess: (bible) => queryClient.setQueryData(creativeKeys.bible, bible),
  })
}

// ---------------------------------------------------------------- Characters

export function useCharacters() {
  return useQuery({
    queryKey: creativeKeys.characters,
    queryFn: () => invoke('characters:list').then((r) => r.characters as CharacterRecord[]),
  })
}

export function useCharacterMutations() {
  const queryClient = useQueryClient()
  const invalidateCreative = () => {
    void queryClient.invalidateQueries({ queryKey: creativeKeys.characters })
    void queryClient.invalidateQueries({ queryKey: ['scenes'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: CharacterInput) =>
        invoke('characters:create', { input }).then((r) => r.character),
      onSuccess: invalidateCreative,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: CharacterInput }) =>
        invoke('characters:update', { id, input }).then((r) => r.character),
      onSuccess: invalidateCreative,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('characters:delete', { id }).then(() => undefined),
      onSuccess: invalidateCreative,
    }),
  }
}

// ---------------------------------------------------------------- Locations

export function useLocations() {
  return useQuery({
    queryKey: creativeKeys.locations,
    queryFn: () => invoke('locations:list').then((r) => r.locations as LocationRecord[]),
  })
}

export function useLocationMutations() {
  const queryClient = useQueryClient()
  const invalidateCreative = () => {
    void queryClient.invalidateQueries({ queryKey: creativeKeys.locations })
    void queryClient.invalidateQueries({ queryKey: ['scenes'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: LocationInput) =>
        invoke('locations:create', { input }).then((r) => r.location),
      onSuccess: invalidateCreative,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: LocationInput }) =>
        invoke('locations:update', { id, input }).then((r) => r.location),
      onSuccess: invalidateCreative,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('locations:delete', { id }).then(() => undefined),
      onSuccess: invalidateCreative,
    }),
  }
}

// ---------------------------------------------------------------- Episodes

export function useEpisodes() {
  return useQuery({
    queryKey: creativeKeys.episodes,
    queryFn: () => invoke('episodes:list').then((r) => r.episodes as EpisodeWithStats[]),
  })
}

export function useEpisodeMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: creativeKeys.episodes })
    void queryClient.invalidateQueries({ queryKey: ['scenes'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: EpisodeInput) =>
        invoke('episodes:create', { input }).then((r) => r.episode as EpisodeRecord),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: EpisodeInput }) =>
        invoke('episodes:update', { id, input }).then((r) => r.episode),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('episodes:delete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

// ---------------------------------------------------------------- Scenes

export function useScenes(episodeId: string | undefined) {
  return useQuery({
    queryKey: creativeKeys.scenes(episodeId ?? 'none'),
    queryFn: () =>
      invoke('scenes:list', { episodeId: episodeId! }).then((r) => r.scenes as SceneRecord[]),
    enabled: episodeId !== undefined,
  })
}

export function useSceneMutations() {
  const queryClient = useQueryClient()
  const invalidate = (episodeId?: string) => {
    if (episodeId) {
      void queryClient.invalidateQueries({ queryKey: creativeKeys.scenes(episodeId) })
    } else {
      void queryClient.invalidateQueries({ queryKey: ['scenes'] })
    }
    void queryClient.invalidateQueries({ queryKey: creativeKeys.episodes })
  }
  return {
    create: useMutation({
      mutationFn: ({ episodeId, input }: { episodeId: string; input: SceneInput }) =>
        invoke('scenes:create', { episodeId, input }).then((r) => r.scene),
      onSuccess: (_s, vars) => invalidate(vars.episodeId),
    }),
    update: useMutation({
      mutationFn: (vars: { id: string; input: SceneInput; episodeId: string }) =>
        invoke('scenes:update', { id: vars.id, input: vars.input }).then((r) => r.scene),
      onSuccess: (_s, vars) => invalidate(vars.episodeId),
    }),
    remove: useMutation({
      mutationFn: (scene: { id: string; episodeId: string }) =>
        invoke('scenes:delete', { id: scene.id }).then(() => undefined),
      onSuccess: (_s, vars) => invalidate(vars.episodeId),
    }),
    move: useMutation({
      mutationFn: (scene: { id: string; episodeId: string; direction: 'up' | 'down' }) =>
        invoke('scenes:move', { id: scene.id, direction: scene.direction }).then(() => undefined),
      onSuccess: (_s, vars) => invalidate(vars.episodeId),
    }),
  }
}

// ---------------------------------------------------------------- Prompts

export function usePrompts() {
  return useQuery({
    queryKey: creativeKeys.prompts,
    queryFn: () => invoke('prompts:list').then((r) => r.prompts as PromptRecord[]),
  })
}

export function usePromptMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: creativeKeys.prompts })
  return {
    create: useMutation({
      mutationFn: (input: PromptInput) =>
        invoke('prompts:create', { input }).then((r) => r.prompt),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: PromptInput }) =>
        invoke('prompts:update', { id, input }).then((r) => r.prompt),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('prompts:delete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

// ---------------------------------------------------------------- AI

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => invoke('ai:status'),
  })
}

export function useAiModels(force = false) {
  return useQuery({
    queryKey: creativeKeys.aiModels(force),
    queryFn: () => invoke('ai:models', { force }),
    staleTime: force ? 0 : 5 * 60 * 1000,
    retry: 0,
  })
}

export function copyText(text: string): Promise<void> {
  return invoke('system:copyText', { text }).then(() => undefined)
}

export type { OpenedProject, ProjectSummary, BackupInfo }

// ---------------------------------------------------------------- Storyboard

export function useShots(sceneId: string | undefined) {
  return useQuery({
    queryKey: creativeKeys.shots(sceneId ?? 'none'),
    queryFn: () => invoke('shots:list', { sceneId: sceneId! }).then((r) => r.shots as ShotRecord[]),
    enabled: sceneId !== undefined,
  })
}

export function useShotMutations() {
  const queryClient = useQueryClient()
  const invalidate = (sceneId?: string) => {
    if (sceneId) {
      void queryClient.invalidateQueries({ queryKey: creativeKeys.shots(sceneId) })
    } else {
      void queryClient.invalidateQueries({ queryKey: ['shots'] })
    }
  }
  return {
    create: useMutation({
      mutationFn: ({ sceneId, input }: { sceneId: string; input: ShotInput }) =>
        invoke('shots:create', { sceneId, input }).then((r) => r.shot),
      onSuccess: (_s, vars) => invalidate(vars.sceneId),
    }),
    update: useMutation({
      mutationFn: (vars: { id: string; input: ShotInput; sceneId: string }) =>
        invoke('shots:update', { id: vars.id, input: vars.input }).then((r) => r.shot),
      onSuccess: (_s, vars) => invalidate(vars.sceneId),
    }),
    remove: useMutation({
      mutationFn: (shot: { id: string; sceneId: string }) =>
        invoke('shots:delete', { id: shot.id }).then(() => undefined),
      onSuccess: (_s, vars) => invalidate(vars.sceneId),
    }),
    move: useMutation({
      mutationFn: (shot: { id: string; sceneId: string; direction: 'up' | 'down' }) =>
        invoke('shots:move', { id: shot.id, direction: shot.direction }).then(() => undefined),
      onSuccess: (_s, vars) => invalidate(vars.sceneId),
    }),
    importFrame: useMutation({
      mutationFn: (shotId: string) =>
        invoke('shots:importFrame', { shotId }).then((r) => r.asset as AssetRecord),
      onSuccess: () => invalidate(),
    }),
    clearFrame: useMutation({
      mutationFn: (vars: { shotId: string; sceneId: string }) =>
        invoke('shots:clearFrame', { shotId: vars.shotId }).then(() => undefined),
      onSuccess: (_s, vars) => invalidate(vars.sceneId),
    }),
  }
}

/** Frame URL served by the main process's restricted mirai-asset:// protocol. */
export function assetUrl(assetId: string): string {
  return `mirai-asset://${assetId}/`
}

// ---------------------------------------------------------------- Style Bible

export function useStyleBible() {
  return useQuery({
    queryKey: creativeKeys.styleBible,
    queryFn: () => invoke('style-bible:get').then((r) => r.style),
  })
}

export function useUpdateStyleBible() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (style: StyleBibleType) =>
      invoke('style-bible:update', { style }).then((r) => r.style),
    onSuccess: (style) => queryClient.setQueryData(creativeKeys.styleBible, style),
  })
}
