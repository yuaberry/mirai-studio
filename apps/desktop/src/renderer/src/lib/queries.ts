/**
 * TanStack Query hooks over the typed IPC client. Loading / error / empty
 * states come for free — every module uses these instead of manual state.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AppSettings,
  type AssetRecord,
  type MediaTrack,
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
    mutationFn: (input: { key: 'openrouter' | 'nvidia' | 'image'; value: string }) =>
      invoke('credentials:set', input).then((r) => r.secure),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.credentials }),
  })
}

export function useClearCredential() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: 'openrouter' | 'nvidia' | 'image') => invoke('credentials:clear', { key }),
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

export function useDecisions(limit = 50) {
  return useQuery({
    queryKey: ['ai', 'decisions', limit],
    queryFn: () => invoke('ai:decisions:list', { limit }).then((r) => r.decisions),
  })
}

export function useRecordDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: import('@mirai/shared').IpcRequestInput<'ai:recordDecision'>) =>
      invoke('ai:recordDecision', input).then(() => undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai', 'decisions'] }),
  })
}

export function useDraftScreenplay() {
  return useMutation({
    mutationFn: (input: { sceneId: string; guidance?: string }) =>
      invoke('ai:draftScreenplay', input),
  })
}

export function useGenerateFrame() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { shotId: string; extraPrompt?: string }) =>
      invoke('ai:generateFrame', input).then((r) => r.jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shots'] }),
  })
}

export function useVoiceActions() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shots'] })
  return {
    importVoice: useMutation({
      mutationFn: (shotId: string) =>
        invoke('media:importVoice', { shotId }).then((r) => r.asset as AssetRecord),
      onSuccess: invalidate,
    }),
    clearVoice: useMutation({
      mutationFn: (vars: { shotId: string }) =>
        invoke('shots:clearVoice', { shotId: vars.shotId }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
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

// ---------------------------------------------------------------- Media Library

export const mediaKeys = {
  all: (kind: string) => ['media', kind] as const,
  renderStatus: ['render', 'status'] as const,
}

export function useMediaLibrary(kind: string = 'all') {
  return useQuery({
    queryKey: mediaKeys.all(kind),
    queryFn: () => invoke('media:list', { kind }).then((r) => r.tracks as MediaTrack[]),
  })
}

export function useMediaMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['media'] })
  return {
    import: useMutation({
      mutationFn: (kind: 'MUSIC' | 'SFX' | 'AMBIENCE') =>
        invoke('media:import', { kind }).then((r) => r.track),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; title: string; tags?: string }) =>
        invoke('media:update', input).then((r) => r.track),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('media:delete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
    assignToScene: useMutation({
      mutationFn: (input: { sceneId: string; mediaId: string; role: import('@mirai/shared').MediaRole; volume: number }) =>
        invoke('media:assignToScene', input).then(() => undefined),
      onSuccess: invalidate,
    }),
    removeFromScene: useMutation({
      mutationFn: (input: { sceneId: string; mediaId: string }) =>
        invoke('media:removeFromScene', input).then(() => undefined),
      onSuccess: invalidate,
    }),
    reveal: useMutation({
      mutationFn: (id: string) => invoke('media:reveal', { id }).then(() => undefined),
    }),
  }
}

export function useRenderOutputs() {
  return useQuery({
    queryKey: ['render', 'outputs'],
    queryFn: () =>
      invoke('render:outputs').then((r) => r.outputs as import('@mirai/shared').RenderOutput[]),
  })
}

export function useRenderMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['render', 'outputs'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
  }
  return {
    renderScene: useMutation({
      mutationFn: (input: { sceneId: string; presetId?: string; quality?: 'PREVIEW' | 'MASTER' }) =>
        invoke('render:scene', input).then((r) => r.jobId),
      onSuccess: invalidate,
    }),
    renderEpisode: useMutation({
      mutationFn: (input: { episodeId: string; presetId?: string; quality?: 'PREVIEW' | 'MASTER' }) =>
        invoke('render:episode', input).then((r) => r.jobId),
      onSuccess: invalidate,
    }),
    revealOutput: useMutation({
      mutationFn: (path: string) => invoke('render:revealOutput', { path }).then(() => undefined),
    }),
    deleteOutput: useMutation({
      mutationFn: (path: string) => invoke('render:deleteOutput', { path }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

export function useRenderStatus() {
  return useQuery({
    queryKey: mediaKeys.renderStatus,
    queryFn: () => invoke('render:status'),
    staleTime: 60_000,
  })
}

export function useRenderShot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (shotId: string) => invoke('render:shot', { shotId }).then((r) => r.jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs }),
  })
}

// ---------------------------------------------------------------- timeline (Phase 5)

export const timelineKeys = {
  timeline: (sceneId: string) => ['timeline', sceneId] as const,
  keyframes: (targetType: string, targetId: string, param?: string) =>
    ['keyframes', targetType, targetId, param ?? 'all'] as const,
}

export function useTimeline(sceneId: string | undefined) {
  return useQuery({
    queryKey: timelineKeys.timeline(sceneId ?? 'none'),
    queryFn: () =>
      invoke('timeline:get', { sceneId: sceneId! }).then(
        (r) => r.timeline as import('@mirai/shared').TimelineBundle,
      ),
    enabled: sceneId !== undefined,
  })
}

export function useTimelineMutations(sceneId: string | undefined) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['timeline'] })
    void queryClient.invalidateQueries({ queryKey: ['keyframes'] })
  }
  return {
    build: useMutation({
      mutationFn: (reset: boolean) =>
        invoke('timeline:build', { sceneId: sceneId!, reset }).then((r) => r.timeline),
      onSuccess: invalidate,
    }),
    reset: useMutation({
      mutationFn: () => invoke('timeline:reset', { sceneId: sceneId! }).then(() => undefined),
      onSuccess: invalidate,
    }),
    trackCreate: useMutation({
      mutationFn: (input: { kind: import('@mirai/shared').TrackKind; name?: string }) =>
        invoke('timeline:trackCreate', { sceneId: sceneId!, ...input }).then((r) => r.track),
      onSuccess: invalidate,
    }),
    trackUpdate: useMutation({
      mutationFn: (input: { id: string; patch: import('@mirai/shared').TrackPatch }) =>
        invoke('timeline:trackUpdate', input).then((r) => r.track),
      onSuccess: invalidate,
    }),
    trackDelete: useMutation({
      mutationFn: (id: string) => invoke('timeline:trackDelete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
    trackMove: useMutation({
      mutationFn: (input: { id: string; toIndex: number }) =>
        invoke('timeline:trackMove', input).then(() => undefined),
      onSuccess: invalidate,
    }),
    clipCreate: useMutation({
      mutationFn: (input: import('@mirai/shared').ClipCreateInput) =>
        invoke('timeline:clipCreate', input).then((r) => r.clip),
      onSuccess: invalidate,
    }),
    clipUpdate: useMutation({
      mutationFn: (input: { id: string; patch: import('@mirai/shared').ClipPatch }) =>
        invoke('timeline:clipUpdate', input).then((r) => r.clip),
      onSuccess: invalidate,
    }),
    clipMove: useMutation({
      mutationFn: (input: { id: string; toTrackId?: string; startSec: number }) =>
        invoke('timeline:clipMove', input).then((r) => r.clip),
      onSuccess: invalidate,
    }),
    clipSplit: useMutation({
      mutationFn: (input: { id: string; atSec: number }) =>
        invoke('timeline:clipSplit', input).then((r) => ({ left: r.left, right: r.right })),
      onSuccess: invalidate,
    }),
    clipDelete: useMutation({
      mutationFn: (input: { id: string; ripple: boolean }) =>
        invoke('timeline:clipDelete', input).then(() => undefined),
      onSuccess: invalidate,
    }),
    markerCreate: useMutation({
      mutationFn: (input: { atSec: number; label: string }) =>
        invoke('timeline:markerCreate', { sceneId: sceneId!, ...input }).then((r) => r.marker),
      onSuccess: invalidate,
    }),
    markerDelete: useMutation({
      mutationFn: (id: string) => invoke('timeline:markerDelete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

export function useKeyframes(
  targetType: import('@mirai/shared').KeyframeTarget,
  targetId: string | undefined,
  param?: string,
) {
  return useQuery({
    queryKey: timelineKeys.keyframes(targetType, targetId ?? 'none', param),
    queryFn: () =>
      invoke('timeline:keyframeList', {
        targetType,
        targetId: targetId!,
        param,
      }).then((r) => r.keyframes as import('@mirai/shared').KeyframeRecord[]),
    enabled: targetId !== undefined,
  })
}

export function useSceneKeyframes(sceneId: string | undefined) {
  return useQuery({
    queryKey: ['keyframes', 'scene', sceneId ?? 'none'],
    queryFn: () =>
      invoke('timeline:keyframesForScene', { sceneId: sceneId! }).then(
        (r) => r.keyframes as import('@mirai/shared').KeyframeRecord[],
      ),
    enabled: sceneId !== undefined,
  })
}

export function useKeyframeMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['keyframes'] })
    void queryClient.invalidateQueries({ queryKey: ['timeline'] })
  }
  return {
    upsert: useMutation({
      mutationFn: (keyframe: import('@mirai/shared').KeyframeInput) =>
        invoke('timeline:keyframeUpsert', { keyframe }).then((r) => r.keyframe),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('timeline:keyframeDelete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

// ---------------------------------------------------------------- production (Phase 7)

export const productionKeys = {
  tasks: (status?: string) => ['tasks', status ?? 'all'] as const,
  crew: ['crew'] as const,
  approvals: (entityType?: string, entityId?: string) =>
    ['approvals', entityType ?? 'all', entityId ?? 'all'] as const,
  versions: (entityType: string, entityId: string) => ['versions', entityType, entityId] as const,
  qc: ['qc'] as const,
  analytics: ['analytics'] as const,
}

export function useTasks(status?: import('@mirai/shared').TaskStatus) {
  return useQuery({
    queryKey: productionKeys.tasks(status),
    queryFn: () =>
      invoke('tasks:list', status ? { status } : {}).then(
        (r) => r.tasks as import('@mirai/shared').TaskRecord[],
      ),
  })
}

export function useTaskMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: productionKeys.analytics })
  }
  return {
    create: useMutation({
      mutationFn: (input: import('@mirai/shared').TaskCreateInput) =>
        invoke('tasks:create', input).then((r) => r.task),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; patch: import('@mirai/shared').TaskPatch }) =>
        invoke('tasks:update', input).then((r) => r.task),
      onSuccess: invalidate,
    }),
    setStatus: useMutation({
      mutationFn: (input: { id: string; status: import('@mirai/shared').TaskStatus }) =>
        invoke('tasks:setStatus', input).then((r) => r.task),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('tasks:delete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

export function useCrew() {
  return useQuery({
    queryKey: productionKeys.crew,
    queryFn: () =>
      invoke('crew:list').then((r) => r.members as import('@mirai/shared').CrewMember[]),
  })
}

export function useCrewMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: productionKeys.crew })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: { name: string; role: import('@mirai/shared').CrewRole }) =>
        invoke('crew:create', input).then((r) => r.member),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('crew:delete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
  }
}

export function useApprovals(entityType?: import('@mirai/shared').ApprovalEntityType, entityId?: string) {
  return useQuery({
    queryKey: productionKeys.approvals(entityType, entityId),
    queryFn: () =>
      invoke('approvals:log', entityType ? { entityType, entityId } : {}).then(
        (r) => r.events as import('@mirai/shared').ApprovalEvent[],
      ),
  })
}

export function useApprovalTransition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      entityType: import('@mirai/shared').ApprovalEntityType
      entityId: string
      toStatus: string
      note?: string
      actorName?: string
    }) => invoke('approvals:transition', input).then((r) => r.event),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['characters'] })
      void queryClient.invalidateQueries({ queryKey: ['locations'] })
      void queryClient.invalidateQueries({ queryKey: ['scenes'] })
      void queryClient.invalidateQueries({ queryKey: ['shots'] })
      void queryClient.invalidateQueries({ queryKey: ['episodes'] })
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
      void queryClient.invalidateQueries({ queryKey: productionKeys.analytics })
    },
  })
}

export function useVersions(entityType: import('@mirai/shared').VersionableEntityType, entityId: string | undefined) {
  return useQuery({
    queryKey: productionKeys.versions(entityType, entityId ?? 'none'),
    queryFn: () =>
      invoke('versions:list', { entityType, entityId: entityId! }).then(
        (r) => r.versions as import('@mirai/shared').EntityVersion[],
      ),
    enabled: entityId !== undefined,
  })
}

export function useVersionMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['versions'] })
    void queryClient.invalidateQueries({ queryKey: ['characters'] })
    void queryClient.invalidateQueries({ queryKey: ['locations'] })
    void queryClient.invalidateQueries({ queryKey: ['scenes'] })
    void queryClient.invalidateQueries({ queryKey: ['shots'] })
    void queryClient.invalidateQueries({ queryKey: ['style-bible'] })
    void queryClient.invalidateQueries({ queryKey: productionKeys.analytics })
  }
  return {
    snapshot: useMutation({
      mutationFn: (input: {
        entityType: import('@mirai/shared').VersionableEntityType
        entityId: string
        label?: string
      }) => invoke('versions:snapshot', input).then((r) => r.version),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (versionId: string) => invoke('versions:restore', { versionId }).then((r) => r.version),
      onSuccess: invalidate,
    }),
    diff: useMutation({
      mutationFn: (input: { fromVersionId: string; toVersionId: string }) =>
        invoke('versions:diff', input).then(
          (r) => r.entries as import('@mirai/shared').VersionDiffEntry[],
        ),
    }),
  }
}

export function useQc() {
  return useQuery({
    queryKey: productionKeys.qc,
    queryFn: () => invoke('qc:run').then((r) => r.report as import('@mirai/shared').QcReport),
    staleTime: 0,
  })
}

export function useAnalytics() {
  return useQuery({
    queryKey: productionKeys.analytics,
    queryFn: () =>
      invoke('analytics:overview').then((r) => r.analytics as import('@mirai/shared').ProductionAnalytics),
  })
}

// ---------------------------------------------------------------- subtitles & Phase 8 AI (v0.8)

export const subtitleKeys = {
  list: (sceneId: string) => ['subtitles', sceneId] as const,
}

export function useSubtitles(sceneId: string | undefined) {
  return useQuery({
    queryKey: subtitleKeys.list(sceneId ?? 'none'),
    queryFn: () =>
      invoke('subtitles:list', { sceneId: sceneId! }).then(
        (r) => r.subtitles as import('@mirai/shared').SubtitleRecord[],
      ),
    enabled: sceneId !== undefined,
  })
}

export function useSubtitleMutations(sceneId: string | undefined) {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['subtitles'] })
  return {
    create: useMutation({
      mutationFn: (input: { startSec: number; endSec: number; text: string }) =>
        invoke('subtitles:create', { sceneId: sceneId!, ...input }).then((r) => r.subtitle),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: {
        id: string
        patch: { startSec?: number; endSec?: number; text?: string }
      }) => invoke('subtitles:update', input).then((r) => r.subtitle),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => invoke('subtitles:delete', { id }).then(() => undefined),
      onSuccess: invalidate,
    }),
    importFile: useMutation({
      mutationFn: () =>
        invoke('subtitles:importFile', { sceneId: sceneId! }).then((r) => r.imported),
      onSuccess: invalidate,
    }),
    exportFile: useMutation({
      mutationFn: (format: 'srt' | 'vtt') =>
        invoke('subtitles:exportFile', { sceneId: sceneId!, format }).then((r) => r.path),
      onSuccess: invalidate,
    }),
  }
}

export function useAnalyzeScreenplay() {
  return useMutation({
    mutationFn: (sceneId: string) =>
      invoke('ai:analyzeScreenplay', { sceneId }).then((r) => r.analysis),
  })
}

export function useDirectorNotes() {
  return useMutation({
    mutationFn: (sceneId: string) => invoke('ai:directorNotes', { sceneId }).then((r) => r.notes),
  })
}

export function useContinuityCheck() {
  return useMutation({
    mutationFn: (sceneId: string) =>
      invoke('ai:continuityCheck', { sceneId }).then((r) => r.findings),
  })
}

export function useProductionReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sceneId: string) =>
      invoke('ai:productionReview', { sceneId }).then((r) => r.jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
      void queryClient.invalidateQueries({ queryKey: ['ai', 'decisions'] })
    },
  })
}

export function useGenerateVideo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { shotId: string; extraPrompt?: string; seconds?: number }) =>
      invoke('ai:generateVideo', input).then((r) => r.jobId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
      void queryClient.invalidateQueries({ queryKey: ['shots'] })
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
    },
  })
}
