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
import { zTaskStatus } from '../status'
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
import { MediaTrack, SceneMedia, zMediaKind, zMediaRole } from '../entities/media'
import {
  ScreenplayAnalysis,
  DirectorNotes,
  ContinuityFinding,
} from '../entities/media'
import { SubtitleRecord, SubtitleInput, SubtitlePatch } from '../entities/subtitle'
import { PluginRecord } from '../entities/plugins'
import { RenderOutput, zRenderQuality, DEFAULT_PRESET_ID } from '../entities/export'
import {
  ApprovalEvent,
  ApprovalTransitionInput,
  CrewCreateInput,
  CrewMember,
  EntityVersion,
  ProductionAnalytics,
  QcReport,
  TaskCreateInput,
  TaskPatch,
  TaskRecord,
  VersionDiffEntry,
  zApprovalEntityType,
  zVersionableEntityType,
} from '../entities/production'
import {
  ClipCreateInput,
  ClipMoveInput,
  ClipPatch,
  KeyframeInput,
  KeyframeRecord,
  KEYFRAME_TARGETS,
  TimelineBundle,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
  TrackInput,
  TrackPatch,
} from '../entities/timeline'

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
      kind: z.enum(['screenplay', 'image', 'video', 'production-review', 'other']),
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
  // ---- Media Library (Phase 4) --------------------------------------------
  'media:list': {
    request: z.object({ kind: z.string().optional() }).default({}),
    response: z.object({ tracks: z.array(MediaTrack) }),
  },
  'media:import': {
    request: z.object({ kind: zMediaKind }),
    response: z.object({ track: MediaTrack }),
  },
  'media:update': {
    request: z.object({ id: zEntityId, title: z.string().min(1).max(200), tags: z.string().max(200).optional() }),
    response: z.object({ track: MediaTrack }),
  },
  'media:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'media:assignToScene': {
    request: z.object({ sceneId: zEntityId, mediaId: zEntityId, role: zMediaRole, volume: z.number().min(0).max(2).default(1) }),
    response: z.object({ ok: z.boolean() }),
  },
  'media:removeFromScene': {
    request: z.object({ sceneId: zEntityId, mediaId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'media:listSceneMedia': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ assignments: z.array(SceneMedia) }),
  },
  'media:reveal': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },

  // ---- Render Engine (Phase 4) --------------------------------------------
  'render:shot': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ jobId: zEntityId }),
  },
  'render:status': {
    request: emptyRequest,
    response: z.object({
      available: z.boolean(),
      version: z.string().nullable(),
    }),
  },

  // ---- Plugins (Phase 9) ---------------------------------------------------------
  'plugins:list': {
    request: emptyRequest,
    response: z.object({ plugins: z.array(PluginRecord) }),
  },
  'plugins:setEnabled': {
    request: z.object({ id: z.string().min(1).max(80), enabled: z.boolean() }),
    response: z.object({ plugin: PluginRecord }),
  },
  /** Install from a folder picked via dialog (manifest.json + index.js). */
  'plugins:installFromFolder': {
    request: emptyRequest,
    response: z.object({ plugin: PluginRecord }),
  },
  'plugins:delete': {
    request: z.object({ id: z.string().min(1).max(80) }),
    response: z.object({ ok: z.boolean() }),
  },
  'plugins:runCommand': {
    request: z.object({
      pluginId: z.string().min(1).max(80),
      commandId: z.string().min(1).max(120),
    }),
    response: z.object({ result: z.unknown() }),
  },

  // ---- Subtitle Studio (Phase 4 wrap-up) ---------------------------------------
  'subtitles:list': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ subtitles: z.array(SubtitleRecord) }),
  },
  'subtitles:create': {
    request: SubtitleInput,
    response: z.object({ subtitle: SubtitleRecord }),
  },
  'subtitles:update': {
    request: z.object({ id: zEntityId, patch: SubtitlePatch }),
    response: z.object({ subtitle: SubtitleRecord }),
  },
  'subtitles:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** Imports a real .srt/.vtt file's cues into the scene (file picked via dialog). */
  'subtitles:importFile': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ imported: z.number().int() }),
  },
  /** Exports the scene's subtitles to a real .srt/.vtt file. */
  'subtitles:exportFile': {
    request: z.object({
      sceneId: zEntityId,
      format: z.enum(['srt', 'vtt']).default('srt'),
    }),
    response: z.object({ path: z.string(), count: z.number().int() }),
  },

  // ---- Advanced AI (Phase 8) ----------------------------------------------------
  'ai:analyzeScreenplay': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ analysis: ScreenplayAnalysis }),
  },
  'ai:directorNotes': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ notes: DirectorNotes }),
  },
  'ai:continuityCheck': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ findings: z.array(ContinuityFinding) }),
  },
  /** Orchestrated multi-step review (job-based): screenplay + continuity + director. */
  'ai:productionReview': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ jobId: zEntityId }),
  },
  /** Generates a real video for a shot via the configured video-gen endpoint (job-based). */
  'ai:generateVideo': {
    request: z.object({
      shotId: zEntityId,
      extraPrompt: z.string().max(4_000).optional(),
      seconds: z.number().min(1).max(20).default(4),
    }),
    response: z.object({ jobId: zEntityId }),
  },

  // ---- Production suite (Phase 7) -------------------------------------------
  'tasks:list': {
    request: z.object({ status: zTaskStatus.optional() }).default({}),
    response: z.object({ tasks: z.array(TaskRecord) }),
  },
  'tasks:create': {
    request: TaskCreateInput,
    response: z.object({ task: TaskRecord }),
  },
  'tasks:update': {
    request: z.object({ id: zEntityId, patch: TaskPatch }),
    response: z.object({ task: TaskRecord }),
  },
  'tasks:setStatus': {
    request: z.object({ id: zEntityId, status: zTaskStatus }),
    response: z.object({ task: TaskRecord }),
  },
  'tasks:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'crew:list': {
    request: emptyRequest,
    response: z.object({ members: z.array(CrewMember) }),
  },
  'crew:create': {
    request: CrewCreateInput,
    response: z.object({ member: CrewMember }),
  },
  'crew:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'approvals:transition': {
    request: ApprovalTransitionInput,
    response: z.object({ event: ApprovalEvent }),
  },
  'approvals:log': {
    request: z
      .object({ entityType: zApprovalEntityType.optional(), entityId: zEntityId.optional() })
      .default({}),
    response: z.object({ events: z.array(ApprovalEvent) }),
  },
  'versions:list': {
    request: z.object({ entityType: zVersionableEntityType, entityId: zEntityId }),
    response: z.object({ versions: z.array(EntityVersion) }),
  },
  'versions:snapshot': {
    request: z.object({
      entityType: zVersionableEntityType,
      entityId: zEntityId,
      label: z.string().min(1).max(200).optional(),
    }),
    response: z.object({ version: EntityVersion }),
  },
  'versions:restore': {
    request: z.object({ versionId: zEntityId }),
    response: z.object({ version: EntityVersion }),
  },
  'versions:diff': {
    request: z.object({ fromVersionId: zEntityId, toVersionId: zEntityId }),
    response: z.object({ entries: z.array(VersionDiffEntry) }),
  },
  'qc:run': {
    request: emptyRequest,
    response: z.object({ report: QcReport }),
  },
  'analytics:overview': {
    request: emptyRequest,
    response: z.object({ analytics: ProductionAnalytics }),
  },

  // ---- Timeline & Editing (Phase 5) ----------------------------------------
  'timeline:get': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ timeline: TimelineBundle }),
  },
  /** Auto-assemble a scene's timeline from its shots, voice and media. */
  'timeline:build': {
    request: z.object({ sceneId: zEntityId, reset: z.boolean().default(true) }),
    response: z.object({ timeline: TimelineBundle }),
  },
  'timeline:reset': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'timeline:trackCreate': {
    request: TrackInput,
    response: z.object({ track: TimelineTrack }),
  },
  'timeline:trackUpdate': {
    request: z.object({ id: zEntityId, patch: TrackPatch }),
    response: z.object({ track: TimelineTrack }),
  },
  'timeline:trackDelete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'timeline:trackMove': {
    request: z.object({ id: zEntityId, toIndex: z.number().int().min(0) }),
    response: z.object({ ok: z.boolean() }),
  },
  'timeline:clipCreate': {
    request: ClipCreateInput,
    response: z.object({ clip: TimelineClip }),
  },
  'timeline:clipUpdate': {
    request: z.object({ id: zEntityId, patch: ClipPatch }),
    response: z.object({ clip: TimelineClip }),
  },
  'timeline:clipMove': {
    request: ClipMoveInput,
    response: z.object({ clip: TimelineClip }),
  },
  'timeline:clipSplit': {
    request: z.object({ id: zEntityId, atSec: z.number().min(0) }),
    response: z.object({ left: TimelineClip, right: TimelineClip }),
  },
  'timeline:clipDelete': {
    request: z.object({ id: zEntityId, ripple: z.boolean().default(false) }),
    response: z.object({ ok: z.boolean() }),
  },
  'timeline:markerCreate': {
    request: z.object({
      sceneId: zEntityId,
      atSec: z.number().min(0),
      label: z.string().min(1).max(200).default('Marker'),
    }),
    response: z.object({ marker: TimelineMarker }),
  },
  'timeline:markerDelete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** All keyframes relevant to a scene (camera of its shots, clip automation, mixer automation). */
  'timeline:keyframesForScene': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ keyframes: z.array(KeyframeRecord) }),
  },
  'timeline:keyframeList': {
    request: z.object({
      targetType: z.enum(KEYFRAME_TARGETS),
      targetId: zEntityId,
      param: z.string().min(1).max(40).optional(),
    }),
    response: z.object({ keyframes: z.array(KeyframeRecord) }),
  },
  'timeline:keyframeUpsert': {
    request: z.object({ keyframe: KeyframeInput }),
    response: z.object({ keyframe: KeyframeRecord }),
  },
  'timeline:keyframeDelete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },

  // ---- Render & Export Center (Phase 6) -------------------------------------
  'render:scene': {
    request: z.object({
      sceneId: zEntityId,
      presetId: z.string().min(1).default(DEFAULT_PRESET_ID),
      quality: zRenderQuality.default('MASTER'),
    }),
    response: z.object({ jobId: zEntityId }),
  },
  'render:episode': {
    request: z.object({
      episodeId: zEntityId,
      presetId: z.string().min(1).default(DEFAULT_PRESET_ID),
      quality: zRenderQuality.default('MASTER'),
    }),
    response: z.object({ jobId: zEntityId }),
  },
  'render:outputs': {
    request: emptyRequest,
    response: z.object({ outputs: z.array(RenderOutput) }),
  },
  'render:revealOutput': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ ok: z.boolean() }),
  },
  'render:deleteOutput': {
    request: z.object({ path: z.string().min(1) }),
    response: z.object({ ok: z.boolean() }),
  },
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
