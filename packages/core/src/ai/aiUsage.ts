/**
 * AiUsageService (v0.21) — persists REAL provider usage (Phase 2: cost
 * dashboard). Only what providers report: prompt/completion tokens,
 * duration, status. Totals are facts from this machine — never invented.
 */
import type { Database } from '../db/connection'

export interface AiUsageEntry {
  kind: string
  provider?: string | null
  model?: string | null
  promptTokens?: number
  completionTokens?: number
  durationMs?: number
  status?: 'OK' | 'ERROR'
  error?: string | null
}

export interface AiUsageSummary {
  totalCalls: number
  totalErrors: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalDurationMs: number
  byModel: Array<{ model: string; calls: number; promptTokens: number; completionTokens: number }>
  recentErrors: Array<{ ts: string; kind: string; model: string | null; error: string | null }>
}

export class AiUsageService {
  constructor(private readonly db: Database) {}

  record(entry: AiUsageEntry, nowIso?: string): void {
    const ts = nowIso ?? new Date().toISOString()
    try {
      this.db
        .prepare(
          `INSERT INTO ai_usage (ts, kind, provider, model, prompt_tokens, completion_tokens, duration_ms, status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ts,
          entry.kind,
          entry.provider ?? null,
          entry.model ?? null,
          entry.promptTokens ?? 0,
          entry.completionTokens ?? 0,
          entry.durationMs ?? 0,
          entry.status ?? 'OK',
          entry.error ? String(entry.error).slice(0, 300) : null,
        )
    } catch {
      /* usage must never break the AI call it measures */
    }
  }

  summary(): AiUsageSummary {
    const total = this.db
      .prepare(
        `SELECT COUNT(*) AS calls, SUM(CASE WHEN status <> 'OK' THEN 1 ELSE 0 END) AS errors, SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct, SUM(duration_ms) AS dur FROM ai_usage`,
      )
      .get() as { calls: number; errors: number | null; pt: number | null; ct: number | null; dur: number | null }
    const byModel = this.db
      .prepare(
        `SELECT COALESCE(model, '?') AS model, COUNT(*) AS calls, SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct
         FROM ai_usage GROUP BY model ORDER BY calls DESC LIMIT 10`,
      )
      .all() as Array<{ model: string; calls: number; pt: number | null; ct: number | null }>
    const recentErrors = this.db
      .prepare(`SELECT ts, kind, model, error FROM ai_usage WHERE status <> 'OK' ORDER BY ts DESC LIMIT 5`)
      .all() as Array<{ ts: string; kind: string; model: string | null; error: string | null }>
    return {
      totalCalls: total.calls ?? 0,
      totalErrors: total.errors ?? 0,
      totalPromptTokens: total.pt ?? 0,
      totalCompletionTokens: total.ct ?? 0,
      totalDurationMs: total.dur ?? 0,
      byModel: byModel.map((m) => ({ model: m.model, calls: m.calls, promptTokens: m.pt ?? 0, completionTokens: m.ct ?? 0 })),
      recentErrors,
    }
  }
}
