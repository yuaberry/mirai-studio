/**
 * Typed IPC contracts (spec §10, §15).
 *
 * One table of truth: every channel declares its request and response schema.
 * The main process validates requests AND responses with zod; the renderer
 * gets full static types from this same table. No untyped `ipcRenderer.invoke`
 * is ever allowed in the renderer — only the generated client.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { type ErrorPayload } from '../errors'
import { AppSettings, zCredentialKey } from '../entities/settings'
import { JobRecord } from '../entities/job'
import { LogEntry } from '../entities/log'

import {
  OpenedProject,
  ProjectConfig,
  ProjectManifest,
  ProjectSummary,
} from '../entities/project'
import {
  CharacterInput,
  CharacterRecord,
  EpisodeInput,
  EpisodeRecord,
  EpisodeWithStats,
  LocationInput,
  LocationRecord,
  SceneInput,
  SceneRecord,
  StoryBible,
} from '../entities/creative'
import { AiContextScope, AiModelInfo, ChatMessage } from '../entities/ai'
import { PromptInput, PromptRecord } from '../entities/prompt'
import { AssetRecord, ShotInput, ShotRecord, StyleBible } from '../entities/storyboard'

const emptyRequest = z.object({}).default({})

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------
export const BackupInfo = z.object({
  id: z.string().min(1),
  projectId: zEntityId,
  path: z.string(),
  sizeBytes: z.number().int().min(0),
  createdAt: zIsoDate,
})
export type BackupInfo = z.infer<typeof BackupInfo>

// ---------------------------------------------------------------------------
// Health report
// ---------------------------------------------------------------------------
export const HealthReport = z.object({
  appVersion: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  userDataPath: z.string(),
  projectsDefaultDir: z.string(),
  nativeSqlite: z.enum(['ok', 'error']),
  appDb: z.enum(['ok', 'error']),
  secureStorage: z.boolean(),
  ffmpeg: z
    .object({ found: z.boolean(), path: z.string().nullable(), version: z.string().nullable() })
    .nullable(),
})
export type HealthReport = z.infer<typeof HealthReport>

// ---------------------------------------------------------------------------
// Contracts table
// ---------------------------------------------------------------------------
export const ipcContracts = {
  // ---- Projects -----------------------------------------------------------
  'projects:list': {
    request: z.object({ includeArchived: z.boolean().default(true) }).default({ includeArchived: true }),
    response: z.object({ projects: z.array(ProjectSummary) }),
  },
  'projects:create': {
    request: z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(2_000).optional(),
      dir: z.string().min(1),
      config: ProjectConfig,
    }),
    response: z.object({ project: ProjectSummary }),
  },
  'projects:open': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ project: OpenedProject }),
  },
  'projects:close': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  'projects:current': {
    request: emptyRequest,
    response: z.object({ project: OpenedProject.nullable() }),
  },
  'projects:duplicate': {
    request: z.object({ id: zEntityId }),
    response: z.object({ project: ProjectSummary }),
  },
  'projects:archive': {
    request: z.object({ id: zEntityId }),
    response: z.object({ project: ProjectSummary }),
  },
  'projects:restore': {
    request: z.object({ id: zEntityId }),
    response: z.object({ project: ProjectSummary }),
  },
  'projects:removeFromList': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'projects:revealInFolder': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'projects:pickDirectory': {
    request: emptyRequest,
    response: z.object({ path: z.string().nullable() }),
  },
  'projects:updateConfig': {
    request: z.object({ config: ProjectConfig }),
    response: z.object({ manifest: ProjectManifest }),
  },
  'projects:validate': {
    request: emptyRequest,
    response: z.object({ jobId: zEntityId }),
  },
  'projects:backup': {
    request: z.object({ id: zEntityId }),
    response: z.object({ backup: BackupInfo }),
  },
  'projects:listBackups': {
    request: z.object({ id: zEntityId }),
    response: z.object({ backups: z.array(BackupInfo) }),
  },
  'projects:restoreBackup': {
    request: z.object({ id: zEntityId, backupId: z.string() }),
    response: z.object({ ok: z.boolean() }),
  },
  'projects:deleteBackup': {
    request: z.object({ id: zEntityId, backupId: z.string() }),
    response: z.object({ ok: z.boolean() }),
  },

  // ----------------------------------------------------------- Creative Core
  'story-bible:get': {
    request: emptyRequest,
    response: z.object({ bible: StoryBible }),
  },
  'story-bible:update': {
    request: z.object({ bible: StoryBible }),
    response: z.object({ bible: StoryBible }),
  },
  'characters:list': {
    request: emptyRequest,
    response: z.object({ characters: z.array(CharacterRecord) }),
  },
  'characters:create': {
    request: z.object({ input: CharacterInput }),
    response: z.object({ character: CharacterRecord }),
  },
  'characters:update': {
    request: z.object({ id: zEntityId, input: CharacterInput }),
    response: z.object({ character: CharacterRecord }),
  },
  'characters:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'locations:list': {
    request: emptyRequest,
    response: z.object({ locations: z.array(LocationRecord) }),
  },
  'locations:create': {
    request: z.object({ input: LocationInput }),
    response: z.object({ location: LocationRecord }),
  },
  'locations:update': {
    request: z.object({ id: zEntityId, input: LocationInput }),
    response: z.object({ location: LocationRecord }),
  },
  'locations:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'episodes:list': {
    request: emptyRequest,
    response: z.object({ episodes: z.array(EpisodeWithStats) }),
  },
  'episodes:create': {
    request: z.object({ input: EpisodeInput }),
    response: z.object({ episode: EpisodeRecord }),
  },
  'episodes:update': {
    request: z.object({ id: zEntityId, input: EpisodeInput }),
    response: z.object({ episode: EpisodeRecord }),
  },
  'episodes:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'scenes:list': {
    request: z.object({ episodeId: zEntityId }),
    response: z.object({ scenes: z.array(SceneRecord) }),
  },
  'scenes:create': {
    request: z.object({ episodeId: zEntityId, input: SceneInput }),
    response: z.object({ scene: SceneRecord }),
  },
  'scenes:update': {
    request: z.object({ id: zEntityId, input: SceneInput }),
    response: z.object({ scene: SceneRecord }),
  },
  'scenes:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'scenes:move': {
    request: z.object({ id: zEntityId, direction: z.enum(['up', 'down']) }),
    response: z.object({ ok: z.boolean() }),
  },

  // --------------------------------------------------------------- Storyboard
  'shots:list': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ shots: z.array(ShotRecord) }),
  },
  'shots:create': {
    request: z.object({ sceneId: zEntityId, input: ShotInput }),
    response: z.object({ shot: ShotRecord }),
  },
  'shots:update': {
    request: z.object({ id: zEntityId, input: ShotInput }),
    response: z.object({ shot: ShotRecord }),
  },
  'shots:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'shots:move': {
    request: z.object({ id: zEntityId, direction: z.enum(['up', 'down']) }),
    response: z.object({ ok: z.boolean() }),
  },
  /**
   * Opens a native file dialog, copies the chosen image into the project's
   * images/ folder and attaches it as the shot's frame. Returns the asset.
   */
  'shots:importFrame': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ asset: AssetRecord }),
  },
  'shots:clearFrame': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'assets:reveal': {
    request: z.object({ assetId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },

  // ---- Style Bible (Module 23)
  'style-bible:get': {
    request: emptyRequest,
    response: z.object({ style: StyleBible }),
  },
  'style-bible:update': {
    request: z.object({ style: StyleBible }),
    response: z.object({ style: StyleBible }),
  },

  // ------------------------------------------------------------- Prompt Library
  'prompts:list': {
    request: emptyRequest,
    response: z.object({ prompts: z.array(PromptRecord) }),
  },
  'prompts:create': {
    request: z.object({ input: PromptInput }),
    response: z.object({ prompt: PromptRecord }),
  },
  'prompts:update': {
    request: z.object({ id: zEntityId, input: PromptInput }),
    response: z.object({ prompt: PromptRecord }),
  },
  'prompts:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },

  // ------------------------------------------------------------------ AI Core
  'ai:status': {
    request: emptyRequest,
    response: z.object({
      configured: z.boolean(),
      secure: z.boolean(),
      defaultModel: z.string().nullable(),
      /** Which chat provider is active. */
      provider: z.enum(['openrouter', 'nvidia']),
      /** Whether an image-generation provider is configured. */
      imageConfigured: z.boolean(),
    }),
  },
  'ai:models': {
    request: z.object({ force: z.boolean().default(false) }).default({ force: false }),
    response: z.object({
      models: z.array(AiModelInfo),
      cached: z.boolean(),
    }),
  },
  /**
   * Starts a streaming chat. Returns immediately with a requestId; tokens
   * arrive as 'ai:chunk' push events and finish with 'ai:done' or 'ai:error'.
   * Only the explicitly consented AiContextScope leaves the machine.
   */
  'ai:chat': {
    request: z.object({
      messages: z.array(ChatMessage).min(1).max(80),
      context: AiContextScope,
      model: z.string().min(1).optional(),
    }),
    response: z.object({ requestId: z.string().min(1) }),
  },
  'ai:abort': {
    request: z.object({ requestId: z.string().min(1) }),
    response: z.object({ ok: z.boolean() }),
  },
  /**
   * Scene Writer agent (Phase 2 completion): drafts a screenplay for a scene
   * from its consented context. Returns the DRAFT only — applying it is an
   * explicit user action (human-in-the-loop via ai:applyDraft).
   */
  'ai:draftScreenplay': {
    request: z.object({
      sceneId: zEntityId,
      guidance: z.string().max(2_000).optional(),
    }),
    response: z.object({
      draft: z.string(),
      model: z.string(),
      durationMs: z.number().int().min(0),
    }),
  },
  /** Records a creative decision (memory of accepted AI proposals). */
  'ai:recordDecision': {
    request: z.object({
      kind: z.enum(['screenplay', 'image', 'other']),
      summary: z.string().min(1).max(2_000),
      sceneId: zEntityId.optional(),
      shotId: zEntityId.optional(),
    }),
    response: z.object({ ok: z.boolean() }),
  },
  'ai:decisions:list': {
    request: z.object({ limit: z.number().int().min(1).max(200).default(50) }).default({ limit: 50 }),
    response: z.object({
      decisions: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          summary: z.string(),
          sceneId: z.string().nullable(),
          shotId: z.string().nullable(),
          createdAt: zIsoDate,
        }),
      ),
    }),
  },
  /**
   * Frame generation job (Phase 4): queues an AI image generation for a shot
   * using the project Style Bible + scene/cast context for consistency.
   * The completed job attaches a real asset to the shot.
   */
  'ai:generateFrame': {
    request: z.object({
      shotId: zEntityId,
      extraPrompt: z.string().max(4_000).optional(),
    }),
    response: z.object({ jobId: zEntityId }),
  },
  /** Voice line (Phase 4): native file dialog → real audio attached to a shot. */
  'media:importVoice': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ asset: AssetRecord }),
  },
  'shots:clearVoice': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },

  // ---- Settings -----------------------------------------------------------
  'settings:get': {
    request: emptyRequest,
    response: z.object({ settings: AppSettings }),
  },
  'settings:update': {
    request: z.object({ settings: AppSettings }),
    response: z.object({ settings: AppSettings }),
  },

  // ---- Credentials (never returns secrets — only status) ------------------
  'credentials:set': {
    request: z.object({ key: zCredentialKey, value: z.string().min(1).max(4_096) }),
    response: z.object({ ok: z.boolean(), secure: z.boolean() }),
  },
  'credentials:status': {
    request: emptyRequest,
    response: z.object({
      credentials: z.array(
        z.object({ key: zCredentialKey, configured: z.boolean(), secure: z.boolean() }),
      ),
    }),
  },
  'credentials:clear': {
    request: z.object({ key: zCredentialKey }),
    response: z.object({ ok: z.boolean() }),
  },

  // ---- Jobs ----------------------------------------------------------------
  'jobs:list': {
    request: emptyRequest,
    response: z.object({ jobs: z.array(JobRecord) }),
  },
  'jobs:retry': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'jobs:cancel': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'jobs:resumeInterrupted': {
    request: emptyRequest,
    response: z.object({ resumed: z.number().int() }),
  },
  'jobs:discardInterrupted': {
    request: emptyRequest,
    response: z.object({ discarded: z.number().int() }),
  },

  // ---- Logs / Diagnostics ---------------------------------------------------
  'logs:recent': {
    request: z
      .object({
        limit: z.number().int().min(1).max(2_000).default(200),
        level: z.string().optional(),
        category: z.string().optional(),
        search: z.string().optional(),
      })
      .default({ limit: 200 }),
    response: z.object({ entries: z.array(LogEntry) }),
  },
  'logs:clear': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  'logs:revealLogsFolder': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },

  // ---- System ----------------------------------------------------------------
  'system:health': {
    request: emptyRequest,
    response: z.object({ health: HealthReport }),
  },
  'system:copyText': {
    request: z.object({ text: z.string().max(100_000) }),
    response: z.object({ ok: z.boolean() }),
  },
  'window:minimize': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  'window:toggleMaximize': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  'window:close': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  'app:reload': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  'app:toggleDevtools': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
} as const satisfies Record<string, { request: z.ZodTypeAny; response: z.ZodTypeAny }>

export type IpcChannel = keyof typeof ipcContracts
export const IPC_CHANNELS = Object.keys(ipcContracts) as IpcChannel[]

/** What a handler RECEIVES (already parsed — defaults applied). */
export type IpcRequest<C extends IpcChannel> = z.output<(typeof ipcContracts)[C]['request']>
/** What the renderer may SEND (defaults may be omitted). */
export type IpcRequestInput<C extends IpcChannel> = z.input<(typeof ipcContracts)[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.output<(typeof ipcContracts)[C]['response']>

/** Envelope crossing the bridge. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload }
