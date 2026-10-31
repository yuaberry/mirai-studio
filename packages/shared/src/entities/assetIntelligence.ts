/**
 * Asset Intelligence entities (§14) — usage history + dependency graph
 * for every asset in the project. All facts, never invented.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

// ------------------------------------------------------------------ usage

export const zAssetUsageRecord = z.object({
  id: zEntityId,
  assetId: zEntityId,
  contextKind: z.string(),
  contextId: zEntityId,
  contextRole: z.string().nullable(),
  usedAt: zIsoDate,
  createdAt: zIsoDate,
})
export type AssetUsageRecord = z.infer<typeof zAssetUsageRecord>

export const zAssetDependent = z.object({
  contextKind: z.string(),
  contextId: zEntityId,
  contextRole: z.string().nullable(),
  usedAt: zIsoDate.nullable(),
})
export type AssetDependent = z.infer<typeof zAssetDependent>

export const zAssetDependency = z.object({
  targetAssetId: zEntityId,
  relation: z.string(),
})
export type AssetDependency = z.infer<typeof zAssetDependency>

export const zAssetIntelligenceSummary = z.object({
  assetId: zEntityId,
  usageCount: z.number().int().min(0),
  dependents: z.array(zAssetDependent),
  dependencies: z.array(zAssetDependency),
  firstUsedAt: zIsoDate.nullable(),
  lastUsedAt: zIsoDate.nullable(),
})
export type AssetIntelligenceSummary = z.infer<typeof zAssetIntelligenceSummary>

// ------------------------------------------------------------------ graph

export const zAssetGraphNode = z.object({
  id: zEntityId,
  kind: z.string(),
})
export type AssetGraphNode = z.infer<typeof zAssetGraphNode>

export const zAssetGraphEdge = z.object({
  source: zEntityId,
  target: zEntityId,
  relation: z.string(),
})
export type AssetGraphEdge = z.infer<typeof zAssetGraphEdge>

export const zAssetGraph = z.object({
  nodes: z.array(zAssetGraphNode),
  edges: z.array(zAssetGraphEdge),
})
export type AssetGraph = z.infer<typeof zAssetGraph>
