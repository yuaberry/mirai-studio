/**
 * Sync — o contrato do tempo real entre celular e computador (v2.1).
 *
 * Uma fonte só: o servidor (apps/server) fala estes tipos, o agente do
 * computador (packages/core) recebe estes eventos, e o celular os consome.
 * Duplicar essas definições em três lugares é como nascem os discórdias.
 */

export const SYNC_OP_KINDS = [
  'produceEpisode',
  'renderCamera',
  'speakShot',
  'generateFrames',
  'render',
  'refreshSnapshot',
] as const
export type SyncOpKind = (typeof SYNC_OP_KINDS)[number]

export const SYNC_EVENT_TYPES = [
  'project.published',
  'project.updated',
  'project.removed',
  'op.queued',
  'op.progress',
  'op.completed',
  'op.failed',
] as const
export type SyncEventType = (typeof SYNC_EVENT_TYPES)[number]

export const SyncOpStatus = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const
export type SyncOpStatus = (typeof SyncOpStatus)[number]

export interface SyncEvent {
  seq: number
  type: SyncEventType
  /** Unix ms. */
  at: number
  owner?: string
  projectId?: string
  opId?: string
  summary: string
  data?: unknown
}

export interface SyncOp {
  id: string
  kind: SyncOpKind
  projectId: string
  payload: Record<string, unknown>
  status: SyncOpStatus
  progress: number
  message: string
  result?: unknown
  error?: string
  createdAt: number
  updatedAt: number
}

/** O que o celular envia para enfileirar uma operação. */
export interface SyncOpRequest {
  kind: SyncOpKind
  projectId: string
  payload?: Record<string, unknown>
}