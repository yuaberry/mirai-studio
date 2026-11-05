/**
 * KeyframeService (Phase 5) — persistent keyframes for the camera system,
 * per-clip volume automation and per-track mixer automation.
 *
 * Upserts are unique per (target, param, atSec): re-adding a keyframe at the
 * same instant replaces it. Sampling/interpolation lives in @mirai/shared
 * (sampleCurve/sampleCamera) so renderer and core share one implementation.
 */
import {
  KeyframeInput,
  KeyframeRecord,
  MiraiError,
  type EntityId,
  type KeyframeTarget,
} from '@mirai/shared'
import type { z } from 'zod'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'

interface KeyframeRow {
  id: string
  target_type: string
  target_id: string
  param: string
  at_sec: number
  value: number
  easing: string
  bezier: string | null
  created_at: string
  updated_at: string
}

export class KeyframeService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /** All keyframes of one target, optionally narrowed to a single param. */
  list(targetType: KeyframeTarget, targetId: EntityId, param?: string): KeyframeRecord[] {
    const rows = param
      ? (this.db
          .prepare(
            'SELECT * FROM keyframes WHERE target_type = ? AND target_id = ? AND param = ? ORDER BY at_sec ASC',
          )
          .all(targetType, targetId, param) as KeyframeRow[])
      : (this.db
          .prepare(
            'SELECT * FROM keyframes WHERE target_type = ? AND target_id = ? ORDER BY at_sec ASC',
          )
          .all(targetType, targetId) as KeyframeRow[])
    return rows.map(rowToKeyframe)
  }

  /** Insert-or-replace at (target, param, atSec) — the natural editor semantic. */
  upsert(input: z.input<typeof KeyframeInput>): KeyframeRecord {
    const parsed = KeyframeInput.safeParse(input)
    if (!parsed.success) {
      throw new MiraiError('VALIDATION_ERROR', 'Invalid keyframe.', {
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const kf = parsed.data
    const now = this.clock.isoNow()
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM keyframes
           WHERE target_type = ? AND target_id = ? AND param = ? AND at_sec = ?`,
        )
        .run(kf.targetType, kf.targetId, kf.param, kf.atSec)
      const id = newEntityId()
      this.db
        .prepare(
          `INSERT INTO keyframes
           (id, target_type, target_id, param, at_sec, value, easing, bezier, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          kf.targetType,
          kf.targetId,
          kf.param,
          kf.atSec,
          kf.value,
          kf.easing,
          kf.bezier !== undefined && kf.bezier !== null ? JSON.stringify(kf.bezier) : null,
          now,
          now,
        )
    })
    tx()
    const row = this.db
      .prepare(
        'SELECT * FROM keyframes WHERE target_type = ? AND target_id = ? AND param = ? AND at_sec = ?',
      )
      .get(kf.targetType, kf.targetId, kf.param, kf.atSec) as KeyframeRow
    return rowToKeyframe(row)
  }

  delete(id: EntityId): void {
    const res = this.db.prepare('DELETE FROM keyframes WHERE id = ?').run(id)
    if (res.changes === 0) throw new MiraiError('NOT_FOUND', `Keyframe ${id} not found.`)
  }

  /** Remove a whole curve/target — used by track/clip/shot deletion orchestration. */
  deleteAll(targetType: KeyframeTarget, targetId: EntityId, param?: string): void {
    if (param) {
      this.db
        .prepare('DELETE FROM keyframes WHERE target_type = ? AND target_id = ? AND param = ?')
        .run(targetType, targetId, param)
    } else {
      this.db
        .prepare('DELETE FROM keyframes WHERE target_type = ? AND target_id = ?')
        .run(targetType, targetId)
    }
  }
}

function rowToKeyframe(row: KeyframeRow): KeyframeRecord {
  let bezier: [number, number, number, number] | null = null
  if (row.bezier) {
    try {
      const parsed = JSON.parse(row.bezier) as number[]
      if (parsed.length === 4) bezier = [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!]
    } catch {
      bezier = null
    }
  }
  return {
    id: row.id,
    targetType: row.target_type as KeyframeTarget,
    targetId: row.target_id,
    param: row.param,
    atSec: row.at_sec,
    value: row.value,
    easing: row.easing as KeyframeRecord['easing'],
    bezier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
