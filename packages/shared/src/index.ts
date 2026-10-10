/**
 * @mirai/shared — single source of truth for types, schemas and IPC contracts.
 */

// --- ids
export { type EntityId, ID_PATTERN, isValidEntityId, zEntityId, zIsoDate } from './ids'

// --- errors
export {
  MIRAI_ERROR_CODES,
  type MiraiErrorCode,
  zMiraiErrorCode,
  type ErrorPayload,
  zErrorPayload,
  MiraiError,
  toErrorPayload,
  fromErrorPayload,
} from './errors'

// --- status enums
export {
  JOB_STATUSES,
  ACTIVE_JOB_STATUSES,
  PROJECT_STATUSES,
  ASSET_STATUSES,
  TASK_STATUSES,
  LOG_LEVELS,
  LOG_CATEGORIES,
  zJobStatus,
  zProjectStatus,
  zAssetStatus,
  zTaskStatus,
  zLogLevel,
  zLogCategory,
} from './status'
export type {
  JobStatus,
  ProjectStatus,
  AssetStatus,
  TaskStatus,
  LogLevel,
  LogCategory,
} from './status'

// --- entities
export {
  PROJECT_FOLDERS,
  type ProjectFolder,
  ASPECT_RATIOS,
  FPS_OPTIONS,
  CONTENT_RATINGS,
  zResolution,
  ProjectConfig,
  ProjectManifest,
  ProjectSummary,
  OpenedProject,
  PROJECT_PRESETS,
  presetById,
} from './entities/project'
export type { ProjectPreset } from './entities/project'

export {
  SHOT_TYPES,
  CAMERA_MOVEMENTS,
  LENS_PRESETS,
  SHOT_TYPE_LABEL,
  CAMERA_MOVEMENT_LABEL,
  ShotInput,
  ShotRecord,
  StyleBible,
  ASSET_KINDS,
  IMAGE_EXTENSIONS,
  AssetRecord,
} from './entities/storyboard'
export type { ShotType, CameraMovement, LensPreset, AssetKind } from './entities/storyboard'

export {
  StoryBible,
  CHARACTER_ROLES,
  zCharacterRole,
  CharacterInput,
  LocationInput,
  EpisodeInput,
  EpisodeRecord,
  EpisodeWithStats,
  TIMES_OF_DAY,
  zTimeOfDay,
  SceneInput,
  CharacterRecord,
  LocationRecord,
  SceneRecord,
} from './entities/creative'
export type { CharacterRole, TimeOfDay } from './entities/creative'

export {
  PROMPT_CATEGORIES,
  PROMPT_CATEGORY_LABEL,
  PromptInput,
  PromptRecord,
  promptTags,
} from './entities/prompt'
export type { PromptCategory } from './entities/prompt'

export { AppSettings, DEFAULT_APP_SETTINGS, CREDENTIAL_KEYS, zCredentialKey } from './entities/settings'
export {
  VideoGenResult,
  ScreenplayAnalysis,
  DirectorNotes,
  ContinuityFinding,
  ProductionReview,
  MEDIA_KINDS,
  MEDIA_KIND_LABEL,
  MEDIA_ROLES,
  MEDIA_ROLE_LABEL,
  MediaTrack,
  SceneMedia,
  RenderResult,
  VIDEO_GEN_STYLES,
  zMediaKind,
  zMediaRole,
  zVideoGenStyle,
} from './entities/media'
export type { MediaKind, MediaRole, VideoGenStyle } from './entities/media'
export {
  SubtitleRecord,
  SubtitleInput,
  SubtitlePatch,
  parseSrt,
  parseVtt,
  writeSrt,
  writeVtt,
  parseTimecode,
  formatSrtTime,
  formatVttTime,
  cueAt,
} from './entities/subtitle'
export type { SubtitleCue } from './entities/subtitle'
export { ANIME_GENRES, HOT_GENRES } from './entities/genres'
export type { AnimeGenre } from './entities/genres'
export type { CredentialKey } from './entities/settings'

export {
  // kinds & enums
  TRACK_KINDS,
  TRACK_KIND_LABEL,
  AUDIO_TRACK_KINDS,
  CLIP_SOURCE_TYPES,
  BLEND_MODES,
  KEYFRAME_TARGETS,
  KEYFRAME_EASINGS,
  EASING_LABEL,
  DEFAULT_BEZIER,
  CAMERA_PARAMS,
  CAMERA_PARAM_RANGE,
  CAMERA_PARAM_LABEL,
  DEFAULT_CAMERA,
  zTrackKind,
  zClipSourceType,
  zBlendMode,
  zKeyframeTarget,
  zKeyframeEasing,
  zCameraParam,
  // entities
  TimelineTrack,
  TrackInput,
  TrackPatch,
  ClipEffects,
  DEFAULT_CLIP_EFFECTS,
  TimelineClip,
  ClipCreateInput,
  ClipPatch,
  ClipMoveInput,
  TimelineMarker,
  KeyframeRecord,
  KeyframeInput,
  ClipSource,
  TimelineBundle,
  // sampling helpers
  easeProgress,
  sampleCurve,
  sampleCamera,
  formatTimelineTime,
} from './entities/timeline'
export type {
  TrackKind,
  ClipSourceType,
  BlendMode,
  KeyframeTarget,
  KeyframeEasing,
  CameraParam,
  CameraState,
  TimelineTrack as TimelineTrackType,
  TimelineClip as TimelineClipType,
  TimelineMarker as TimelineMarkerType,
  KeyframeRecord as KeyframeRecordType,
  ClipEffects as ClipEffectsType,
  ClipSource as ClipSourceModel,
  TimelineBundle as TimelineBundleType,
} from './entities/timeline'

export {
  // plugins (Phase 9)
  PLUGIN_PERMISSIONS,
  PERMISSION_LABEL,
  PluginCommand,
  PluginPrompt,
  PluginExportPreset,
  PluginProvider,
  PluginManifest,
  PluginRecord,
  MarketplaceEntry,
  CURATED_MARKETPLACE,
  zPluginPermission,
} from './entities/plugins'
export type { PluginPermission } from './entities/plugins'

export {
  // tasks
  TASK_PRIORITIES,
  PRIORITY_LABEL,
  TASK_LINK_TYPES,
  TaskRecord,
  TaskCreateInput,
  TaskPatch,
  zTaskPriority,
  zTaskLinkType,
  // crew
  CREW_ROLES,
  CREW_ROLE_LABEL,
  CrewMember,
  CrewCreateInput,
  zCrewRole,
  // approvals
  APPROVAL_ENTITY_TYPES,
  APPROVAL_ENTITY_LABEL,
  APPROVAL_PIPELINES,
  APPROVAL_TRANSITIONS,
  isTransitionAllowed,
  ApprovalEvent,
  ApprovalTransitionInput,
  ApprovalPosition,
  zApprovalEntityType,
  // versioning
  VERSIONABLE_ENTITY_TYPES,
  EntityVersion,
  VersionDiffEntry,
  zVersionableEntityType,
  // qc + analytics
  QC_SEVERITIES,
  QcFinding,
  QcReport,
  ProductionAnalytics,
  zQcSeverity,
} from './entities/production'
export type {
  TaskPriority,
  TaskLinkType,
  CrewRole,
  ApprovalEntityType,
  VersionableEntityType,
  QcSeverity,
} from './entities/production'

export {
  LICENSE_FEATURES,
  LICENSE_TIERS,
  FEATURE_LABEL,
  LicensePayload,
  LicenseStatus,
  ContentSettings,
  MATURE_GENRES,
  MATURE_RATINGS,
  MATURE_PROMPT_PACK,
  filterGenres,
  isMatureGenre,
  isMatureRating,
} from './entities/license'
export type { LicenseFeature, LicenseTier } from './entities/license'

export {
  AutoproduceOptions,
  BibleDraftPlan,
  CharacterPlan,
  CharacterPlanList,
  ScenePlan,
  ScenePlanList,
  ShotPlan,
  ShotPlanList,
  AutoproduceSummary,
} from './entities/producer'

export {
  RENDER_QUALITIES,
  QUALITY_LABEL,
  EXPORT_PRESETS,
  DEFAULT_PRESET_ID,
  exportPresetById,
  RenderOutput,
  SceneRenderResult,
  zRenderQuality,
} from './entities/export'
export type { ExportPreset, RenderQuality } from './entities/export'

export {
  SHORTCUT_ACTIONS,
  DEFAULT_SHORTCUTS,
  effectiveShortcuts,
  normalizeCombo,
  isValidCombo,
  prettyCombo,
  actionsBoundTo,
} from './entities/shortcuts'
export type { ShortcutAction } from './entities/shortcuts'

export { BUILTIN_JOB_TYPES, JobRecord, jobIsActive } from './entities/job'
export type { BuiltinJobType } from './entities/job'

export { LogEntry } from './entities/log'
export type { LogQuery } from './entities/log'

export {
  CHAT_ROLES,
  zChatRole,
  ChatMessage,
  AiModelInfo,
  AiContextScope,
  DEFAULT_AI_CONTEXT_SCOPE,
} from './entities/ai'
export type { ChatRole } from './entities/ai'

// --- ipc
export { BackupInfo, HealthReport, ipcContracts, IPC_CHANNELS } from './ipc/contracts'
export type {
  IpcChannel,
  IpcRequest,
  IpcRequestInput,
  IpcResponse,
  IpcResult,
} from './ipc/contracts'

export { ipcEventPayloads, IPC_EVENT_CHANNELS } from './ipc/events'
export type { IpcEventChannel, IpcEventPayload } from './ipc/events'
