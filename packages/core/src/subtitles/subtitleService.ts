/**
 * SubtitleService (Phase 4 wrap-up) — per-scene subtitle cues with REAL
 * SRT/VTT import & export (codecs live in @mirai/shared, pure & tested).
 */
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  MiraiError,
  parseSrt,
  parseVtt,
  writeSrt,
  writeVtt,
  SubtitleInput,
  SubtitlePatch,
  SubtitleRecord,
  type EntityId,
} from '@mirai/shared'
import type { z } from 'zod'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'

interface Row {
  id: string
  scene_id: string
  start_sec: number
  end_sec: number
  text: string
  created_at: string
  updated_at: string
}

const MAX_SUBTITLES_PER_IMPORT = 5_000

export class SubtitleService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  list(sceneId: EntityId): SubtitleRecord[] {
    this.requireScene(sceneId)
    return (this.db
      .prepare('SELECT * FROM subtitles WHERE scene_id = ? ORDER BY start_sec ASC')
      .all(sceneId) as Row[]).map(rowToSubtitle)
  }

  create(input: z.input<typeof SubtitleInput>): SubtitleRecord {
    const parsed = parseOrThrow(SubtitleInput, input, 'Invalid subtitle.')
    this.requireScene(parsed.sceneId)
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        'INSERT INTO subtitles (id, scene_id, start_sec, end_sec, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, parsed.sceneId, parsed.startSec, parsed.endSec, parsed.text, now, now)
    return this.get(id)
  }

  get(id: EntityId): SubtitleRecord {
    const row = this.db.prepare('SELECT * FROM subtitles WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Subtitle ${id} not found.`)
    return rowToSubtitle(row)
  }

  update(id: EntityId, patch: z.input<typeof SubtitlePatch>): SubtitleRecord {
    const parsed = parseOrThrow(SubtitlePatch, patch, 'Invalid subtitle patch.')
    const current = this.get(id)
    const startSec = parsed.startSec ?? current.startSec
    const endSec = parsed.endSec ?? current.endSec
    if (endSec <= startSec + 0.01) {
      throw new MiraiError('VALIDATION_ERROR', 'Subtitle end must be after start.')
    }
    this.db
      .prepare('UPDATE subtitles SET start_sec = ?, end_sec = ?, text = ?, updated_at = ? WHERE id = ?')
      .run(startSec, endSec, parsed.text ?? current.text, this.clock.isoNow(), id)
    return this.get(id)
  }

  delete(id: EntityId): void {
    const res = this.db.prepare('DELETE FROM subtitles WHERE id = ?').run(id)
    if (res.changes === 0) throw new MiraiError('NOT_FOUND', `Subtitle ${id} not found.`)
  }

  /**
   * Import a real subtitle file (.srt/.vtt) into the scene: parse → replace
   * the scene's cues wholesale (idempotent import semantics).
   */
  importFile(sceneId: EntityId, sourcePath: string): number {
    this.requireScene(sceneId)
    let content: string
    try {
      content = readFileSyncSafe(sourcePath)
    } catch {
      throw new MiraiError('PATH_INVALID', `Subtitle file not readable: ${sourcePath}`)
    }
    const isVtt = /\.vtt$/i.test(sourcePath)
    const cues = isVtt ? parseVtt(content) : parseSrt(content)
    if (cues.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'No cues found in the subtitle file.')
    }
    if (cues.length > MAX_SUBTITLES_PER_IMPORT) {
      throw new MiraiError('VALIDATION_ERROR', `Too many cues (${cues.length}) — limit is ${MAX_SUBTITLES_PER_IMPORT}.`)
    }
    const now = this.clock.isoNow()
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM subtitles WHERE scene_id = ?').run(sceneId)
      const insert = this.db.prepare(
        'INSERT INTO subtitles (id, scene_id, start_sec, end_sec, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const cue of cues) {
        insert.run(newEntityId(), sceneId, cue.startSec, cue.endSec, cue.text, now, now)
      }
    })
    tx()
    return cues.length
  }

  /** Export the scene's cues to a real file in the project's exports/ folder. */
  exportFile(sceneId: EntityId, format: 'srt' | 'vtt'): { path: string; count: number } {
    this.requireScene(sceneId)
    const cues = this.list(sceneId)
    if (cues.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'This scene has no subtitles to export.')
    }
    const exportsDir = join(this.projectRoot, 'exports')
    mkdirSync(exportsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const sceneTitle = this.sceneTitle(sceneId)
    const safe = sceneTitle.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'scene'
    const path = join(exportsDir, `subtitles-${safe}-${stamp}.${format}`)
    const payload =
      format === 'srt'
        ? writeSrt(cues.map((c) => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })))
        : writeVtt(cues.map((c) => ({ startSec: c.startSec, endSec: c.endSec, text: c.text })))
    writeFileSync(path, payload, 'utf8')
    return { path, count: cues.length }
  }

  /** Cues for the render burner (no scene check — internal use). */
  cuesForScene(sceneId: EntityId): Array<{ startSec: number; endSec: number; text: string }> {
    return (this.db
      .prepare('SELECT * FROM subtitles WHERE scene_id = ? ORDER BY start_sec ASC')
      .all(sceneId) as Row[]).map((r) => ({ startSec: r.start_sec, endSec: r.end_sec, text: r.text }))
  }

  private sceneTitle(sceneId: EntityId): string {
    const row = this.db
      .prepare('SELECT title FROM scenes WHERE id = ?')
      .get(sceneId) as { title: string } | undefined
    return row?.title ?? 'scene'
  }

  private requireScene(sceneId: EntityId): void {
    const row = this.db.prepare('SELECT id FROM scenes WHERE id = ?').get(sceneId)
    if (!row) throw new MiraiError('NOT_FOUND', `Scene ${sceneId} not found.`)
  }
}

function rowToSubtitle(row: Row): SubtitleRecord {
  return {
    id: row.id,
    sceneId: row.scene_id,
    startSec: row.start_sec,
    endSec: row.end_sec,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', message, {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}

function readFileSyncSafe(path: string): string {
  return readFileSync(path, 'utf8')
}
