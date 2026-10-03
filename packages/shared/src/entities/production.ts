/**
 * Production entities (Phase 7) — task board, approval pipeline with audit,
 * entity versioning, crew roster, quality control and analytics.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'
import { ASSET_STATUSES, TASK_STATUSES, zTaskStatus } from '../status'

// ---------------------------------------------------------------- tasks

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export const zTaskPriority = z.enum(TASK_PRIORITIES)

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  CRITICAL: 'Critical',
}

/** Entities a task can be linked to (0..1 link). */
export const TASK_LINK_TYPES = ['SCENE', 'SHOT', 'EPISODE', 'CHARACTER', 'LOCATION', 'MEDIA'] as const
export type TaskLinkType = (typeof TASK_LINK_TYPES)[number]
export const zTaskLinkType = z.enum(TASK_LINK_TYPES)

export const TaskRecord = z.object({
  id: zEntityId,
  title: z.string().min(1).max(200),
  description: z.string().max(4_000).nullable(),
  status: zTaskStatus,
  priority: zTaskPriority,
  orderIndex: z.number().int().min(0),
  linkType: zTaskLinkType.nullable(),
  linkId: zEntityId.nullable(),
  /** Crew member id (or null = unassigned). */
  assigneeId: zEntityId.nullable(),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type TaskRecord = z.infer<typeof TaskRecord>

export const TaskCreateInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4_000).optional(),
  priority: zTaskPriority.default('NORMAL'),
  linkType: zTaskLinkType.optional(),
  linkId: zEntityId.optional(),
  assigneeId: zEntityId.optional(),
})
export type TaskCreateInput = z.infer<typeof TaskCreateInput>

export const TaskPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4_000).nullable().optional(),
    priority: zTaskPriority.optional(),
    linkType: zTaskLinkType.nullable().optional(),
    linkId: zEntityId.nullable().optional(),
    assigneeId: zEntityId.nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Patch is empty.' })
export type TaskPatch = z.infer<typeof TaskPatch>

// ---------------------------------------------------------------- crew

export const CREW_ROLES = [
  'DIRECTOR',
  'PRODUCER',
  'WRITER',
  'CHARACTER_DESIGNER',
  'BACKGROUND_ARTIST',
  'ANIMATOR',
  'EDITOR',
  'SOUND_DESIGNER',
  'VOICE_ACTOR',
  'REVIEWER',
] as const
export type CrewRole = (typeof CREW_ROLES)[number]
export const zCrewRole = z.enum(CREW_ROLES)

export const CREW_ROLE_LABEL: Record<CrewRole, string> = {
  DIRECTOR: 'Director',
  PRODUCER: 'Producer',
  WRITER: 'Writer',
  CHARACTER_DESIGNER: 'Character Designer',
  BACKGROUND_ARTIST: 'Background Artist',
  ANIMATOR: 'Animator',
  EDITOR: 'Editor',
  SOUND_DESIGNER: 'Sound Designer',
  VOICE_ACTOR: 'Voice Actor',
  REVIEWER: 'Reviewer',
}

export const CrewMember = z.object({
  id: zEntityId,
  name: z.string().min(1).max(120),
  role: zCrewRole,
  createdAt: zIsoDate,
})
export type CrewMember = z.infer<typeof CrewMember>

export const CrewCreateInput = z.object({
  name: z.string().min(1).max(120),
  role: zCrewRole,
})
export type CrewCreateInput = z.infer<typeof CrewCreateInput>

// ---------------------------------------------------------------- approvals

/** Entity kinds governed by the approval pipeline. */
export const APPROVAL_ENTITY_TYPES = ['CHARACTER', 'LOCATION', 'EPISODE', 'SCENE', 'SHOT'] as const
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number]
export const zApprovalEntityType = z.enum(APPROVAL_ENTITY_TYPES)

export const APPROVAL_ENTITY_LABEL: Record<ApprovalEntityType, string> = {
  CHARACTER: 'Character',
  LOCATION: 'Location',
  EPISODE: 'Episode',
  SCENE: 'Scene',
  SHOT: 'Shot',
}

/**
 * The governed pipeline. `statuses` is the canonical display order;
 * `forward` maps each status to its allowed NEXT states (professional flow:
 * REVIEW approves forward or sends back to REVISION — REVISION is a side
 * state, not a mandatory step). Backwards movement is always allowed.
 */
export interface ApprovalPipeline {
  readonly statuses: readonly string[]
  readonly forward: Readonly<Record<string, readonly string[]>>
}

export const APPROVAL_PIPELINES: Readonly<Record<ApprovalEntityType, ApprovalPipeline>> = {
  CHARACTER: {
    statuses: ASSET_STATUSES,
    forward: {
      DRAFT: ['REVIEW'],
      REVIEW: ['REVISION', 'APPROVED'],
      REVISION: ['REVIEW'],
      APPROVED: ['LOCKED'],
      LOCKED: ['FINAL'],
      FINAL: [],
    },
  },
  LOCATION: {
    statuses: ASSET_STATUSES,
    forward: {
      DRAFT: ['REVIEW'],
      REVIEW: ['REVISION', 'APPROVED'],
      REVISION: ['REVIEW'],
      APPROVED: ['LOCKED'],
      LOCKED: ['FINAL'],
      FINAL: [],
    },
  },
  EPISODE: {
    statuses: TASK_STATUSES,
    forward: {
      TODO: ['IN_PROGRESS', 'REVIEW'],
      IN_PROGRESS: ['REVIEW'],
      REVIEW: ['APPROVED'],
      APPROVED: ['FINAL'],
      FINAL: [],
    },
  },
  SCENE: {
    statuses: TASK_STATUSES,
    forward: {
      TODO: ['IN_PROGRESS', 'REVIEW'],
      IN_PROGRESS: ['REVIEW'],
      REVIEW: ['APPROVED'],
      APPROVED: ['FINAL'],
      FINAL: [],
    },
  },
  SHOT: {
    statuses: TASK_STATUSES,
    forward: {
      TODO: ['IN_PROGRESS', 'REVIEW'],
      IN_PROGRESS: ['REVIEW'],
      REVIEW: ['APPROVED'],
      APPROVED: ['FINAL'],
      FINAL: [],
    },
  },
}

/** Display-order pipeline for a given entity kind. */
export const APPROVAL_TRANSITIONS: Readonly<Record<ApprovalEntityType, readonly string[]>> =
  Object.fromEntries(
    (Object.keys(APPROVAL_PIPELINES) as ApprovalEntityType[]).map((k) => [
      k,
      APPROVAL_PIPELINES[k]!.statuses,
    ]),
  ) as never

export function isTransitionAllowed(
  entityType: ApprovalEntityType,
  from: string,
  to: string,
): boolean {
  const pipeline = APPROVAL_PIPELINES[entityType]
  if (!pipeline.statuses.includes(to) || !pipeline.statuses.includes(from)) return false
  if (from === to) return false
  if (pipeline.forward[from]?.includes(to)) return true
  // Backwards movement (revision loops) is always allowed.
  const fromIdx = pipeline.statuses.indexOf(from)
  const toIdx = pipeline.statuses.indexOf(to)
  return toIdx < fromIdx
}

export const ApprovalEvent = z.object({
  id: zEntityId,
  entityType: zApprovalEntityType,
  entityId: zEntityId,
  fromStatus: z.string().min(1),
  toStatus: z.string().min(1),
  note: z.string().max(2_000).nullable(),
  actorName: z.string().min(1).max(120),
  createdAt: zIsoDate,
})
export type ApprovalEvent = z.infer<typeof ApprovalEvent>

export const ApprovalTransitionInput = z.object({
  entityType: zApprovalEntityType,
  entityId: zEntityId,
  toStatus: z.string().min(1).max(40),
  note: z.string().max(2_000).optional(),
  /** Crew member name doing the change (audit trail). */
  actorName: z.string().min(1).max(120).default('Director'),
})
export type ApprovalTransitionInput = z.infer<typeof ApprovalTransitionInput>

/** Where an entity currently sits in its pipeline (for UI selects). */
export const ApprovalPosition = z.object({
  entityType: zApprovalEntityType,
  entityId: zEntityId,
  title: z.string(),
  status: z.string(),
  pipeline: z.array(z.string()),
  /** Next allowed forward status (null at FINAL). */
  nextStatus: z.string().nullable(),
})
export type ApprovalPosition = z.infer<typeof ApprovalPosition>

// ---------------------------------------------------------------- versioning

export const VERSIONABLE_ENTITY_TYPES = ['CHARACTER', 'LOCATION', 'SCENE', 'SHOT', 'STYLE_BIBLE'] as const
export type VersionableEntityType = (typeof VERSIONABLE_ENTITY_TYPES)[number]
export const zVersionableEntityType = z.enum(VERSIONABLE_ENTITY_TYPES)

export const EntityVersion = z.object({
  id: zEntityId,
  entityType: zVersionableEntityType,
  entityId: zEntityId,
  version: z.number().int().min(1),
  label: z.string().max(200).nullable(),
  /** JSON snapshot of the full record. */
  snapshot: z.string(),
  createdAt: zIsoDate,
})
export type EntityVersion = z.infer<typeof EntityVersion>

export const VersionDiffEntry = z.object({
  field: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
})
export type VersionDiffEntry = z.infer<typeof VersionDiffEntry>

// ---------------------------------------------------------------- QC + analytics

export const QC_SEVERITIES = ['ERROR', 'WARNING', 'INFO'] as const
export type QcSeverity = (typeof QC_SEVERITIES)[number]
export const zQcSeverity = z.enum(QC_SEVERITIES)

export const QcFinding = z.object({
  checkId: z.string(),
  severity: zQcSeverity,
  entityType: z.string(),
  entityId: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  fixHint: z.string(),
})
export type QcFinding = z.infer<typeof QcFinding>

export const QcReport = z.object({
  ranAt: zIsoDate,
  findings: z.array(QcFinding),
  errorCount: z.number().int(),
  warningCount: z.number().int(),
  infoCount: z.number().int(),
})
export type QcReport = z.infer<typeof QcReport>

const statusCount = z.record(z.string(), z.number().int())

export const ProductionAnalytics = z.object({
  episodes: z.object({ total: z.number().int(), byStatus: statusCount }),
  scenes: z.object({
    total: z.number().int(),
    byStatus: statusCount,
    withTimeline: z.number().int(),
    withScreenplay: z.number().int(),
  }),
  shots: z.object({
    total: z.number().int(),
    withFrame: z.number().int(),
    withVoice: z.number().int(),
    byStatus: statusCount,
  }),
  assets: z.object({ total: z.number().int(), images: z.number().int(), audio: z.number().int() }),
  media: z.object({ byKind: statusCount }),
  tasks: z.object({ total: z.number().int(), byStatus: statusCount }),
  approvals: z.object({ events: z.number().int() }),
  crew: z.object({ total: z.number().int() }),
  versions: z.object({ total: z.number().int() }),
})
export type ProductionAnalytics = z.infer<typeof ProductionAnalytics>
