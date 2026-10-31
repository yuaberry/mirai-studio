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
import { AppSettings, AppSettingsPatch, zCredentialKey } from '../entities/settings'
import { JobRecord } from '../entities/job'
import { LogEntry } from '../entities/log'
import type {
  AnimationPipeline,
  AnimationFrame,
} from '../entities/animation'
import {
  zAnimationStage,
  zInbetweenEasing,
} from '../entities/animation'
import { NotesImportResult, StoryNotesAnalysis, DossierResult } from '../entities/dossier'
import { ProjectBriefInput } from '../entities/brief'
import { RelationshipInput, CostumeInput, CharacterRelationship, CharacterCostume } from '../entities/creative'
import {
  MangaPageInput,
  MangaPageRecord,
  MangaPanelInput,
  MangaPanelRecord,
  BUBBLE_KINDS,
  BUBBLE_TAILS,
} from '../entities/manga'
import {
  zAssetUsageRecord,
  zAssetDependent,
  zAssetDependency,
  zAssetIntelligenceSummary,
  zAssetGraph,
} from '../entities/assetIntelligence'
import {
  zSourceEntityType,
  zVariationAssetKind,
  ExperimentRunRecord,
  ExperimentVariationRecord,
  ExperimentPromotionRecord,
  ExperimentRunSummary,
} from '../entities/experiments'
import {
  CreateDerivedWorkInput,
  DerivedWorkView,
  IMPACT_KINDS,
  ImpactResult,
} from '../entities/ip'
import { MoodboardItemInput, MoodboardItem, PosterState } from '../entities/moodboard'
import { type ConsistencyLock } from '../entities/visualConsistency'
import {
  zAudioMasterInput,
  zAudioMixTrackInput,
} from '../entities/audio'
import {
  SceneTranslation,
  TranslationUpsertInput,
  LanguageCoverage,
  GlossaryTerm,
  GlossaryTermInput,
  zLanguageTag,
} from '../entities/localization'

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
import { AutoproduceOptions } from '../entities/producer'
import { LicenseStatus as LicenseStatusType } from '../entities/license'
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
      /** v0.18: the imported story document — persisted to brief/ for the AI
       * to ADAPT the user's story (notes + analysis from ai:analyzeNotes). */
      brief: ProjectBriefInput.optional(),
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

  // ------------------------------------------------------------------- Manga (§8)
  'manga:pages:list': {
    request: z.object({ episodeId: zEntityId }),
    response: z.object({ pages: z.array(MangaPageRecord) }),
  },
  'manga:pages:create': {
    request: z.object({ episodeId: zEntityId, input: MangaPageInput }),
    response: z.object({ page: MangaPageRecord }),
  },
  'manga:pages:update': {
    request: z.object({ id: zEntityId, input: MangaPageInput }),
    response: z.object({ page: MangaPageRecord }),
  },
  'manga:pages:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'manga:pages:move': {
    request: z.object({ id: zEntityId, direction: z.enum(['up', 'down']) }),
    response: z.object({ ok: z.boolean() }),
  },
  'manga:panels:list': {
    request: z.object({ pageId: zEntityId }),
    response: z.object({ panels: z.array(MangaPanelRecord) }),
  },
  'manga:panels:create': {
    request: z.object({ pageId: zEntityId, input: MangaPanelInput }),
    response: z.object({ panel: MangaPanelRecord }),
  },
  'manga:panels:update': {
    request: z.object({ id: zEntityId, input: MangaPanelInput }),
    response: z.object({ panel: MangaPanelRecord }),
  },
  'manga:panels:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'manga:panels:move': {
    request: z.object({ id: zEntityId, direction: z.enum(['up', 'down']) }),
    response: z.object({ ok: z.boolean() }),
  },
  'manga:panels:attachImage': {
    request: z.object({ id: zEntityId }),
    response: z.object({ panel: MangaPanelRecord }),
  },
  'manga:exportScript': {
    request: z.object({ episodeId: zEntityId }),
    response: z.object({ path: z.string(), pages: z.number().int().min(0), bubbles: z.number().int().min(0) }),
  },
  'manga:revealScript': {
    request: z.object({ episodeId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  // ------------------------------------------------- Localization Lab (§18)
  'loc:translations:list': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ translations: z.array(SceneTranslation) }),
  },
  'loc:translations:upsert': {
    request: z.object({ sceneId: zEntityId, input: TranslationUpsertInput }),
    response: z.object({ translation: SceneTranslation }),
  },
  'loc:translations:delete': {
    request: z.object({ sceneId: zEntityId, language: zLanguageTag }),
    response: z.object({ ok: z.boolean() }),
  },
  'loc:coverage': {
    request: emptyRequest,
    response: z.object({ coverage: z.array(LanguageCoverage) }),
  },
  'loc:glossary:list': {
    request: z.object({ language: zLanguageTag.optional() }),
    response: z.object({ terms: z.array(GlossaryTerm) }),
  },
  'loc:glossary:upsert': {
    request: z.object({ input: GlossaryTermInput }),
    response: z.object({ term: GlossaryTerm }),
  },
  'loc:glossary:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** v0.31: character reference sheet — import a real image file. */
  'character:attachReference': {
    request: z.object({ characterId: zEntityId }),
    response: z.object({ asset: AssetRecord }),
  },
  /** v0.31: detach the character's reference sheet (honest prune). */
  'character:clearReference': {
    request: z.object({ characterId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** v0.31: AI generates the character's turnaround reference sheet. */
  'ai:generateCharacterSheet': {
    request: z.object({ characterId: zEntityId }),
    response: z.object({ assetId: zEntityId, prompt: z.string() }),
  },

  /** AI VOICE ACTING (v0.30): speak the shot's dialogue into a real voice asset. */
  'ai:speakShot': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({
      assetId: zEntityId,
      voice: z.string(),
      model: z.string(),
      text: z.string().min(1),
    }),
  },
  /** AI ANIME EPISODE (v0.30): voices + image-to-video + timeline + render. */
  'ai:assembleEpisode': {
    request: z.object({
      episodeId: zEntityId,
      /** v0.32: generate the missing keyframes BEFORE animating. */
      frames: z.boolean().default(true),
      voices: z.boolean().default(true),
      videos: z.boolean().default(true),
      render: z.boolean().default(true),
    }),
    response: z.object({ jobId: z.string() }),
  },

  /** AI translation draft for one scene (human reviews + saves). */
  'ai:translateScene': {
    request: z.object({ sceneId: zEntityId, language: zLanguageTag }),
    response: z.object({
      screenplay: z.string().min(1),
      model: z.string(),
      durationMs: z.number().int().min(0),
    }),
  },
  /** Translated EPUB: translation where it exists, honest fallback to source. */
  'loc:exportEpub': {
    request: z.object({ language: zLanguageTag }),
    response: z.object({
      epubPath: z.string(),
      chapters: z.number().int().min(1),
      translatedScenes: z.number().int().min(0),
      fallbackScenes: z.number().int().min(0),
      bytes: z.number().int().min(0),
    }),
  },
  'loc:revealEpub': {
    request: z.object({ language: zLanguageTag }),
    response: z.object({ ok: z.boolean() }),
  },

  // ------------------------------------------------- Visual Dev Lab poster studio (§7)
  'poster:build': {
    request: emptyRequest,
    response: z.object({
      svg: z.string(),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
      palette: z.array(z.string()),
      tagline: z.string().nullable(),
      state: PosterState,
    }),
  },
  'poster:save': {
    request: z.object({ state: PosterState }),
    response: z.object({ state: PosterState }),
  },
  'poster:export': {
    request: emptyRequest,
    response: z.object({ path: z.string(), bytes: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) }),
  },
  'poster:reveal': {
    request: emptyRequest,
    response: z.object({ ok: z.boolean() }),
  },
  /** Key-art copywriter: EXACTLY 3 tagline candidates from the bible. */
  'ai:draftTaglines': {
    request: emptyRequest,
    response: z.object({
      taglines: z.array(z.string().min(1)).length(3),
      model: z.string(),
      durationMs: z.number().int().min(0),
    }),
  },

  // ---------------------------------------------------- Visual Dev Lab moodboard (§7)
  'moodboard:list': {
    request: emptyRequest,
    response: z.object({ items: z.array(MoodboardItem) }),
  },
  'moodboard:attach': {
    request: emptyRequest,
    response: z.object({ item: MoodboardItem }),
  },
  'moodboard:update': {
    request: z.object({ id: zEntityId, input: MoodboardItemInput }),
    response: z.object({ item: MoodboardItem }),
  },
  'moodboard:remove': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'moodboard:move': {
    request: z.object({ id: zEntityId, direction: z.enum(['up', 'down']) }),
    response: z.object({ ok: z.boolean() }),
  },

  /** v0.25 §8 slice 2: SVG page proofs + lettering script zipped per chapter. */
  'manga:exportPackage': {
    request: z.object({ episodeId: zEntityId }),
    response: z.object({
      path: z.string(),
      pages: z.number().int().min(0),
      bubbles: z.number().int().min(0),
      bytes: z.number().int().min(0),
    }),
  },
  'manga:revealPackage': {
    request: z.object({ episodeId: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** v0.V1 Beta Experimental §8 slice 3: PNG + PDF page proofs per chapter. */
  'manga:exportProofs': {
    request: z.object({ episodeId: zEntityId, format: z.enum(['png', 'pdf', 'both']) }),
    response: z.object({
      path: z.string(),
      format: z.enum(['png', 'pdf', 'both']),
      pages: z.number().int().min(0),
      bytes: z.number().int().min(0),
    }),
  },
  /** v0.V1 Beta Experimental §8 slice 3: auto-board a chapter from its storyboard shots. */
  'manga:autoBoard': {
    request: z.object({ episodeId: zEntityId, panelsPerPage: z.number().int().min(1).max(12).optional() }),
    response: z.object({
      pages: z.number().int().min(0),
      panels: z.number().int().min(0),
    }),
  },
  /** V1 Beta Experimental §14: Asset Intelligence — usage history + dependency graph. */
  'assets:usageHistory': {
    request: z.object({ assetId: zEntityId }),
    response: z.object({ history: z.array(zAssetUsageRecord) }),
  },
  'assets:dependents': {
    request: z.object({ assetId: zEntityId }),
    response: z.object({ dependents: z.array(zAssetDependent) }),
  },
  'assets:dependencies': {
    request: z.object({ assetId: zEntityId }),
    response: z.object({ dependencies: z.array(zAssetDependency) }),
  },
  'assets:graph': {
    request: z.object({}),
    response: z.object({ graph: zAssetGraph }),
  },
  'assets:intelligence': {
    request: z.object({ assetId: zEntityId }),
    response: z.object({ summary: zAssetIntelligenceSummary }),
  },
  /** V1 Beta Experimental §19: Creative Experiments — generation lab with promote-to-project. */
  'experiments:create': {
    request: z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(2_000).optional(),
      sourceEntityType: zSourceEntityType,
      sourceEntityId: zEntityId,
    }),
    response: z.object({ experiment: ExperimentRunRecord }),
  },
  'experiments:list': {
    request: z.object({}),
    response: z.object({ experiments: z.array(ExperimentRunSummary) }),
  },
  'experiments:get': {
    request: z.object({ id: zEntityId }),
    response: z.object({ experiment: ExperimentRunRecord }),
  },
  'experiments:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'experiments:variations:create': {
    request: z.object({
      experimentId: zEntityId,
      variationIndex: z.number().int().min(0),
      name: z.string().min(1).max(80),
      prompt: z.string().max(4_000).optional(),
      model: z.string().max(120).optional(),
      assetKind: zVariationAssetKind,
      assetId: zEntityId.optional(),
      generatedBytes: z.number().int().min(0).default(0),
      score: z.number().int().min(1).max(5).optional(),
      notes: z.string().max(2_000).optional(),
    }),
    response: z.object({ variation: ExperimentVariationRecord }),
  },
  'experiments:variations:list': {
    request: z.object({ experimentId: zEntityId }),
    response: z.object({ variations: z.array(ExperimentVariationRecord) }),
  },
  'experiments:variations:update': {
    request: z.object({
      id: zEntityId,
      score: z.number().int().min(1).max(5).optional(),
      notes: z.string().max(2_000).optional(),
    }),
    response: z.object({ variation: ExperimentVariationRecord }),
  },
  'experiments:variations:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'experiments:promote': {
    request: z.object({
      experimentId: zEntityId,
      variationId: zEntityId,
      targetEntityType: zSourceEntityType,
      targetEntityId: zEntityId,
      targetColumn: z.enum(['frame_asset_id', 'audio_asset_id', 'video_asset_id', 'blend_asset_id', 'image_asset_id']),
    }),
    response: z.object({ promotion: ExperimentPromotionRecord }),
  },
  'experiments:promotions:list': {
    request: z.object({ experimentId: zEntityId }),
    response: z.object({ promotions: z.array(ExperimentPromotionRecord) }),
  },
  /** AI letterer: draft panel lettering from the linked shot's screenplay. */
  'ai:draftPanelLettering': {
    request: z.object({ panelId: zEntityId }),
    response: z.object({
      bubbles: z.array(
        z.object({
          kind: z.enum(BUBBLE_KINDS),
          characterId: z.string().optional(),
          text: z.string().min(1),
          tail: z.enum(BUBBLE_TAILS),
        }),
      ).max(12),
      model: z.string(),
      durationMs: z.number().int().min(0),
    }),
  },

  // ---------------------------------------------------------------- IP graph (§4)
  'ip:impact': {
    request: z.object({ kind: z.enum(IMPACT_KINDS), id: zEntityId }),
    response: z.object({ impact: ImpactResult }),
  },
  'ip:derived:list': {
    request: z.object({ projectId: zEntityId }),
    response: z.object({ works: z.array(DerivedWorkView) }),
  },
  'ip:derived:create': {
    request: z.object({ input: CreateDerivedWorkInput }),
    response: z.object({
      summary: ProjectSummary,
      workId: z.string(),
    }),
  },
  'ip:derived:remove': {
    request: z.object({ id: zEntityId }),
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

  // ---- Licensing & Mature Content Mode (v0.10) ------------------------------------
  'license:activate': {
    request: z.object({ key: z.string().min(10).max(1_500) }),
    response: z.object({ status: LicenseStatusType }),
  },
  'license:status': {
    request: emptyRequest,
    response: z.object({ status: LicenseStatusType }),
  },
  /** Mature Mode toggle — server-side gated by license + age confirmation. */
  'content:setMature': {
    request: z.object({
      enabled: z.boolean(),
      /** Must be true when enabling — the conscientization notice. */
      ageConfirmed: z.boolean(),
    }),
    response: z.object({ enabled: z.boolean() }),
  },

  // ---- Blender bridge (v0.10) ------------------------------------------------------
  'blender:status': {
    request: emptyRequest,
    response: z.object({ available: z.boolean(), version: z.string().nullable() }),
  },
  'blender:attachBlend': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ asset: AssetRecord }),
  },
  'blender:renderShot': {
    request: z.object({ shotId: zEntityId }),
    response: z.object({ jobId: zEntityId }),
  },

  // ---- Producer Agent (v0.10) -----------------------------------------------------
  'ai:autoproduce': {
    request: AutoproduceOptions,
    response: z.object({ jobId: zEntityId }),
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
  /** Imports a real .srt/.vtt/.ass file's cues into the scene (file picked via dialog). */
  'subtitles:importFile': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ imported: z.number().int() }),
  },
  /** Exports the scene's subtitles to a real .srt/.vtt/.ass file. */
  'subtitles:exportFile': {
    request: z.object({
      sceneId: zEntityId,
      format: z.enum(['srt', 'vtt', 'ass']).default('srt'),
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
  /** Batch: generates keyframes for every frameless shot in a scene (job). */
  'ai:generateAllFrames': {
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
    // SECTION PATCH (v0.14): only provided sections are written; the
    // content section (license/mature) is never part of this schema.
    request: z.object({ settings: AppSettingsPatch }),
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

  // ---- Story-notes import + Project Dossier (v0.15) ---------------------------
  /** Picks real documents (.txt/.md/.docx/.odt/.pdf/.zip) and extracts their text. */
  'notes:importFiles': {
    request: emptyRequest,
    response: z.object({ import: NotesImportResult }),
  },
  /** AI reads the imported notes and returns a professional planning analysis. */
  'ai:analyzeNotes': {
    request: z.object({
      notesText: z.string().min(40).max(400_000),
      /** The author's form answers — ground the analysis to their vision. */
      context: z
        .object({
          medium: z.string().max(30).optional(),
          demographic: z.string().max(30).optional(),
          seasonCount: z.number().int().min(1).max(50).optional(),
          targetAudience: z.string().max(600).optional(),
          inspirations: z.string().max(600).optional(),
          setting: z.string().max(600).optional(),
          endingVision: z.string().max(600).optional(),
        })
        .optional(),
    }),
    response: z.object({ analysis: StoryNotesAnalysis }),
  },
  /** Generates the Project Dossier (.txt + .pdf) as a job; result = DossierResult. */
  'dossier:generate': {
    request: emptyRequest,
    response: z.object({ jobId: zEntityId }),
  },
  /** Adapts the user's imported story document into the project (job): bible, cast, season plan, scenes, screenplays. */
  'ai:adaptNotes': {
    request: emptyRequest,
    response: z.object({ jobId: zEntityId }),
  },
  // ---- Relationships + costumes + project memory (v0.21) ---------------------
  'relationships:list': {
    request: emptyRequest,
    response: z.object({ relationships: z.array(CharacterRelationship) }),
  },
  'relationships:create': {
    request: RelationshipInput,
    response: z.object({ relationship: CharacterRelationship }),
  },
  'relationships:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  'costumes:list': {
    request: z.object({ characterId: zEntityId }),
    response: z.object({ costumes: z.array(CharacterCostume) }),
  },
  'costumes:create': {
    request: CostumeInput,
    response: z.object({ costume: CharacterCostume }),
  },
  'costumes:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** Full-text search over the project's scenes and characters. */
  'memory:search': {
    request: z.object({ query: z.string().min(1).max(200) }),
    response: z.object({
      results: z.array(z.object({
        entityType: z.string(),
        entityId: z.string(),
        title: z.string(),
        snippet: z.string(),
      })),
    }),
  },
  /** REAL provider usage on this machine (cost dashboard facts). */
  'ai:usage': {
    request: emptyRequest,
    response: z.object({
      summary: z.object({
        totalCalls: z.number(),
        totalErrors: z.number(),
        totalPromptTokens: z.number(),
        totalCompletionTokens: z.number(),
        totalDurationMs: z.number(),
        byModel: z.array(z.object({ model: z.string(), calls: z.number(), promptTokens: z.number(), completionTokens: z.number() })),
        recentErrors: z.array(z.object({ ts: z.string(), kind: z.string(), model: z.string().nullable(), error: z.string().nullable() })),
      }),
    }),
  },

  // ---- Visual Consistency Engine (v0.33, estúdio japonês) ---------------
  /** Constrói/retorna o ConsistencyLock do projeto: model sheets,
   *  palette lock, style bible enforcement. Injetado em toda geração. */
  'visual:consistencyLock': {
    request: z.object({}),
    response: z.object({
      lock: z.custom<ConsistencyLock>((val) => val !== null && typeof val === 'object'),
    }),
  },
  /** Valida um frame gerado contra o lock de consistência (score 0-100). */
  'visual:checkConsistency': {
    request: z.object({
      frameAssetId: zEntityId,
      generationPrompt: z.string().max(10_000),
    }),
    response: z.object({
      consistent: z.boolean(),
      score: z.number().min(0).max(100),
      issues: z.array(z.string()).optional(),
      suggestions: z.array(z.string()).optional(),
    }),
  },

  // ---- Sound & Voice Studio (v0.36) ---------------------------------------
  /** Cria um áudio master vazio (registro no projeto). */
  'audio:master:create': {
    request: zAudioMasterInput,
    response: z.object({ master: z.custom((val) => val !== null && typeof val === 'object') }),
  },
  /** Lista todos os áudio masters (opcionalmente filtrados por cena). */
  'audio:master:list': {
    request: z.object({ sceneId: zEntityId.optional() }).default({}),
    response: z.object({ masters: z.array(z.custom((val) => val !== null && typeof val === 'object')) }),
  },
  /** Obtém um áudio master por id. */
  'audio:master:get': {
    request: z.object({ id: zEntityId }),
    response: z.object({ master: z.custom((val) => val !== null && typeof val === 'object') }),
  },
  /** Remove um áudio master e seu arquivo de saída. */
  'audio:master:delete': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** Adiciona uma track de mídia ao master (qual áudio, com volume/pan/início). */
  'audio:mix:track:add': {
    request: zAudioMixTrackInput,
    response: z.object({ track: z.custom((val) => val !== null && typeof val === 'object') }),
  },
  /** Lista todas as tracks de mixagem de um master. */
  'audio:mix:track:list': {
    request: z.object({ masterId: zEntityId }),
    response: z.object({ tracks: z.array(z.custom((val) => val !== null && typeof val === 'object')) }),
  },
  /** Remove uma track de mixagem. */
  'audio:mix:track:remove': {
    request: z.object({ id: zEntityId }),
    response: z.object({ ok: z.boolean() }),
  },
  /** Mixa todas as tracks do master em um arquivo REAL via FFmpeg + mastering loudnorm. */
  'audio:mix:run': {
    request: z.object({ masterId: zEntityId }),
    response: z.object({ result: z.custom((val) => val !== null && typeof val === 'object') }),
  },

  // ---- Animation Pipeline (v0.34, estúdio japonês) -----------------------
  /** Constrói/retorna o AnimationPipeline de uma cena (configuração do
   *  pipeline: fps, in-between count, estágio atual, contagem por etapa). */
  'animation:pipeline': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ pipeline: z.custom<AnimationPipeline>((val) => val !== null && typeof val === 'object') }),
  },
  /** Atualiza a configuração do pipeline de uma cena. */
  'animation:pipeline:update': {
    request: z.object({
      sceneId: zEntityId,
      fps: z.number().int().min(1).max(60).optional(),
      inbetweenCount: z.number().int().min(0).max(20).optional(),
      inbetweenEasing: zInbetweenEasing.optional(),
      enforceConsistency: z.boolean().optional(),
      currentStage: zAnimationStage.optional(),
    }),
    response: z.object({ pipeline: z.custom<AnimationPipeline>((val) => val !== null && typeof val === 'object') }),
  },
  /** Avança o pipeline para o próximo estágio. */
  'animation:pipeline:advance': {
    request: z.object({ sceneId: zEntityId }),
    response: z.object({ pipeline: z.custom<AnimationPipeline>((val) => val !== null && typeof val === 'object') }),
  },
  /** Registra um keyframe (GENGA) — quadro-chave que define a pose. */
  'animation:registerKeyframe': {
    request: z.object({
      sceneId: zEntityId,
      atSec: z.number().min(0),
      assetId: zEntityId,
    }),
    response: z.object({ frame: z.custom<AnimationFrame>((val) => val !== null && typeof val === 'object') }),
  },
  /** Gera quadros intermediários (DOUGA) entre dois keyframes. */
  'animation:generateInbetweens': {
    request: z.object({
      sceneId: zEntityId,
      fromKeyframeId: zEntityId,
      toKeyframeId: zEntityId,
      count: z.number().int().min(1).max(20).default(2),
    }),
    response: z.object({ frames: z.array(z.custom<AnimationFrame>((val) => val !== null && typeof val === 'object')) }),
  },
  /** Lista todos os quadros de uma cena, opcionalmente filtrados por estágio. */
  'animation:listFrames': {
    request: z.object({
      sceneId: zEntityId,
      stage: zAnimationStage.optional(),
    }),
    response: z.object({ frames: z.array(z.custom<AnimationFrame>((val) => val !== null && typeof val === 'object')) }),
  },
  /** Limpeza de linha (SEITO) — produz line art limpo de um quadro. */
  'animation:cleanupPass': {
    request: z.object({
      sceneId: zEntityId,
      sourceFrameId: zEntityId,
    }),
    response: z.object({ frame: z.custom<AnimationFrame>((val) => val !== null && typeof val === 'object') }),
  },
  /** Coloração (TOSO) — aplica a paleta do ConsistencyLock ao quadro. */
  'animation:colorPass': {
    request: z.object({
      sceneId: zEntityId,
      sourceFrameId: zEntityId,
      palette: z.array(z.object({ element: z.string(), hex: z.string() })),
    }),
    response: z.object({ frame: z.custom<AnimationFrame>((val) => val !== null && typeof val === 'object') }),
  },
  /** Compositing/filmagem (SATSUEI) — compõe o quadro final com câmera e blend. */
  'animation:compositingPass': {
    request: z.object({
      sceneId: zEntityId,
      sourceFrameId: zEntityId,
    }),
    response: z.object({ frame: z.custom<AnimationFrame>((val) => val !== null && typeof val === 'object') }),
  },

  /** Exports the project's episodes as a REAL EPUB 3 book (Light Novel Pro). */
  'epub:export': {
    request: emptyRequest,
    response: z.object({ epubPath: z.string(), chapters: z.number().int().min(1), bytes: z.number().int().min(0) }),
  },
  /** v0.23: Light Novel DOCX export (Office Open XML, Word-compatible). */
  'ln:exportDocx': {
    request: emptyRequest,
    response: z.object({
      docxPath: z.string(),
      chapters: z.number().int().min(1),
      scenes: z.number().int().min(0),
      bytes: z.number().int().min(0),
    }),
  },
  /** Reveals an exported DOCX in the file manager (exports/ only). */
  'ln:revealDocx': {
    request: z.object({ path: z.string() }),
    response: z.object({ ok: z.boolean() }),
  },

  /** Whether the open project carries an imported brief and if it was adapted. */
  'brief:status': {
    request: emptyRequest,
    response: z.object({ exists: z.boolean(), adapted: z.boolean(), sourceFiles: z.array(z.object({ name: z.string(), format: z.string(), chars: z.number() })), title: z.string().nullable() }),
  },
  /** Fetches the most recent dossier result (job record) for the open project. */
  'dossier:last': {
    request: emptyRequest,
    response: z.object({ result: DossierResult.nullable() }),
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
