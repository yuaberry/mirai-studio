/**
 * Status enums shared across main, preload and renderer.
 */
import { z } from 'zod'

/** Lifecycle of a job in the persistent queue. */
export const JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** Jobs that still can make progress (used for counts/recovery). */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['QUEUED', 'RUNNING', 'RETRYING']

/** Registry-level status of a project. */
export const PROJECT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Approval pipeline for creative entities. */
export const ASSET_STATUSES = ['DRAFT', 'REVIEW', 'REVISION', 'APPROVED', 'LOCKED', 'FINAL'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

/** Production task pipeline. */
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'FINAL'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Log severities (ordered). */
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Log categories — mirrors the subsystem that emitted the entry. */
export const LOG_CATEGORIES = [
  'SYSTEM',
  'PROJECT',
  'DB',
  'JOBS',
  'AI',
  'RENDER',
  'MEDIA',
  'IPC',
  'PLUGINS',
] as const
export type LogCategory = (typeof LOG_CATEGORIES)[number]

export const zJobStatus = z.enum(JOB_STATUSES)
export const zProjectStatus = z.enum(PROJECT_STATUSES)
export const zAssetStatus = z.enum(ASSET_STATUSES)
export const zTaskStatus = z.enum(TASK_STATUSES)
export const zLogLevel = z.enum(LOG_LEVELS)
export const zLogCategory = z.enum(LOG_CATEGORIES)
