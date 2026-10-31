/**
 * Asset Intelligence (§14) — rastreia o uso real de cada asset no projeto
 * e constrói o grafo de dependências entre assets.
 *
 * Tudo aqui são FATOS observados no banco — nada é inventado.
 * Usado pelo visualizador de dependências e pelo painel de "onde este
 * asset é usado".
 */
import type { Database } from '../db/connection'
import type { EntityId } from '@mirai/shared'
import { newEntityId } from '../types'

// ------------------------------------------------------------------ types

export interface AssetUsageEntry {
  assetId: EntityId
  contextKind: 'SHOT' | 'SCENE' | 'PAGE' | 'PANEL' | 'MOODBOARD' | 'CHARACTER' | 'ANIMATION' | 'MEDIA'
  contextId: EntityId
  contextRole?: string // 'frame' | 'audio' | 'video' | 'blend' | 'image_asset' | 'reference' | 'cover' | ...
}

export interface AssetUsageRecord {
  id: EntityId
  assetId: EntityId
  contextKind: string
  contextId: EntityId
  contextRole: string | null
  usedAt: string
  createdAt: string
}

export interface AssetDependent {
  contextKind: string
  contextId: EntityId
  contextRole: string | null
  usedAt: string | null
}

export interface AssetDependency {
  targetAssetId: EntityId
  relation: string
}

export interface AssetIntelligenceSummary {
  assetId: EntityId
  usageCount: number
  dependents: AssetDependent[]
  dependencies: AssetDependency[]
  firstUsedAt: string | null
  lastUsedAt: string | null
}

// ------------------------------------------------------------------ service

export class AssetIntelligenceService {
  constructor(private readonly db: Database) {}

  /** Registra que um asset foi usado em um contexto (chamado pelos serviços de shot/media/manga/etc). */
  recordUsage(entry: AssetUsageEntry, nowIso?: string): void {
    const ts = nowIso ?? new Date().toISOString()
    const id = newEntityId()
    try {
      this.db
        .prepare(
          `INSERT INTO asset_usage_history (id, asset_id, context_kind, context_id, context_role, used_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, entry.assetId, entry.contextKind, entry.contextId, entry.contextRole ?? null, ts, ts)
    } catch (err) {
      console.error('AssetIntelligence.recordUsage failed:', err)
    }
  }

  /** Histórico de uso de um asset, mais recente primeiro. */
  usageHistory(assetId: EntityId): AssetUsageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM asset_usage_history WHERE asset_id = ? ORDER BY used_at DESC, created_at DESC`,
      )
      .all(assetId) as AssetUsageRecord[]
    return rows
  }

  /** Quem usa este asset (contextos que o referenciam). */
  dependents(assetId: EntityId): AssetDependent[] {
    const rows = this.db
      .prepare(
        `SELECT context_kind, context_id, context_role, MAX(used_at) AS used_at
         FROM asset_usage_history WHERE asset_id = ?
         GROUP BY context_kind, context_id, context_role
         ORDER BY used_at DESC`,
      )
      .all(assetId) as AssetDependent[]
    return rows
  }

  /** De quais assets este asset depende (grafo de dependências). */
  dependencies(assetId: EntityId): AssetDependency[] {
    const rows = this.db
      .prepare(
        `SELECT target_asset_id, relation FROM asset_dependency_graph WHERE source_asset_id = ? ORDER BY relation, target_asset_id`,
      )
      .all(assetId) as AssetDependency[]
    return rows
  }

  /** Quais assets dependem deste asset (inverso do grafo). */
  dependedBy(assetId: EntityId): AssetDependency[] {
    const rows = this.db
      .prepare(
        `SELECT source_asset_id AS targetAssetId, relation FROM asset_dependency_graph WHERE target_asset_id = ? ORDER BY relation, source_asset_id`,
      )
      .all(assetId) as { targetAssetId: EntityId; relation: string }[]
    return rows.map((r) => ({ targetAssetId: r.targetAssetId, relation: r.relation }))
  }

  /** Resumo completo de inteligência de um asset. */
  summary(assetId: EntityId): AssetIntelligenceSummary {
    const usage = this.usageHistory(assetId)
    const firstUsed = usage.length > 0 ? usage[usage.length - 1]!.usedAt : null
    const lastUsed = usage.length > 0 ? usage[0]!.usedAt : null
    return {
      assetId,
      usageCount: usage.length,
      dependents: this.dependents(assetId),
      dependencies: this.dependencies(assetId),
      firstUsedAt: firstUsed,
      lastUsedAt: lastUsed,
    }
  }

  /** Grafo completo: todos os assets como nós e todas as dependências como arestas. */
  graph(): { nodes: Array<{ id: EntityId; kind: string }>; edges: Array<{ source: EntityId; target: EntityId; relation: string }> } {
    const nodes = this.db
      .prepare('SELECT id, kind FROM assets ORDER BY id')
      .all() as Array<{ id: EntityId; kind: string }>
    const edges = this.db
      .prepare('SELECT source_asset_id AS source, target_asset_id AS target, relation FROM asset_dependency_graph ORDER BY source, target')
      .all() as Array<{ source: EntityId; target: EntityId; relation: string }>
    return { nodes, edges }
  }

  /** Adiciona uma aresta de dependência ao grafo (idempotente por source+target+relation). */
  addDependency(sourceAssetId: EntityId, targetAssetId: EntityId, relation: string): void {
    const id = newEntityId()
    const now = new Date().toISOString()
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO asset_dependency_graph (id, source_asset_id, target_asset_id, relation, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, sourceAssetId, targetAssetId, relation, now)
    } catch {
      /* graph edits must never break the caller */
    }
  }

  /** Remove uma aresta de dependência. */
  removeDependency(sourceAssetId: EntityId, targetAssetId: EntityId, relation: string): void {
    this.db
      .prepare(
        `DELETE FROM asset_dependency_graph WHERE source_asset_id = ? AND target_asset_id = ? AND relation = ?`,
      )
      .run(sourceAssetId, targetAssetId, relation)
  }

  /** Limpa todo o histórico de uso e grafo (útil para testes / reset). */
  clear(): void {
    this.db.prepare('DELETE FROM asset_dependency_graph').run()
    this.db.prepare('DELETE FROM asset_usage_history').run()
  }
}
