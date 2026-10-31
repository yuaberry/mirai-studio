/**
 * Light Novel Pro service (§9 slice 3) — volume/chapter structure + POV control.
 *
 * Light novels are organized as volumes → chapters → scenes. Each chapter
 * carries a POV (point of view) setting — who tells this part of the story
 * and from which narrative perspective — so the author can plan voice
 * consistency across the whole work.
 */
import type { Database } from '../db/connection'
import { newEntityId } from '../types'
import type {
  ChapterInput,
  ChapterRecord,
  PovSetting,
  ScenePovPatch,
  VolumeInput,
  VolumeRecord,
} from '@mirai/shared'
import { MiraiError } from '@mirai/shared'

// --------------------------------------------------------------- row types

interface VolumeRow {
  id: string
  number: number
  title: string
  status: string
  created_at: string
  updated_at: string
}

interface ChapterRow {
  id: string
  volume_id: string
  number: number
  title: string
  synopsis: string | null
  status: string
  pov_type: string | null
  pov_character_id: string | null
  created_at: string
  updated_at: string
}

interface ScenePovRow {
  pov_type: string | null
  pov_character_id: string | null
}

// --------------------------------------------------------------- service

export class LightNovelService {
  constructor(private readonly db: Database) {}

  // ------------------------------------------------------- volumes

  /** Create a new volume. */
  createVolume(input: VolumeInput): VolumeRecord {
    const id = newEntityId()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO volumes (id, number, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.number, input.title, input.status ?? 'TODO', now, now)
    return this.requireVolume(id)
  }

  /** List all volumes ordered by number. */
  listVolumes(): VolumeRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM volumes ORDER BY number ASC`)
      .all() as VolumeRow[]
    return rows.map(rowToVolume)
  }

  /** Get a single volume. */
  getVolume(id: string): VolumeRecord {
    return this.requireVolume(id)
  }

  /** Update a volume (omitted fields are preserved). */
  updateVolume(id: string, input: Partial<VolumeInput>): VolumeRecord {
    this.requireVolume(id)
    const fields: string[] = []
    const values: unknown[] = []
    if (input.number !== undefined) {
      fields.push('number = ?')
      values.push(input.number)
    }
    if (input.title !== undefined) {
      fields.push('title = ?')
      values.push(input.title)
    }
    if (input.status !== undefined) {
      fields.push('status = ?')
      values.push(input.status)
    }
    if (fields.length === 0) {
      return this.requireVolume(id)
    }
    values.push(new Date().toISOString(), id)
    this.db
      .prepare(`UPDATE volumes SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values)
    return this.requireVolume(id)
  }

  /** Delete a volume (chapters cascade-delete via FK). */
  deleteVolume(id: string): void {
    this.requireVolume(id)
    this.db.prepare('DELETE FROM volumes WHERE id = ?').run(id)
  }

  // ------------------------------------------------------- chapters

  /** Create a new chapter inside a volume. */
  createChapter(input: ChapterInput): ChapterRecord {
    this.requireVolume(input.volumeId)
    const id = newEntityId()
    const now = new Date().toISOString()
    const pov = input.pov ?? { povType: 'THIRD_PERSON_LIMITED' }
    this.db
      .prepare(
        `INSERT INTO chapters (id, volume_id, number, title, synopsis, status, pov_type, pov_character_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.volumeId,
        input.number,
        input.title,
        input.synopsis ?? null,
        input.status ?? 'TODO',
        pov.povType,
        pov.povCharacterId ?? null,
        now,
        now,
      )
    return this.requireChapter(id)
  }

  /** List all chapters of a volume, ordered by number. */
  listChapters(volumeId: string): ChapterRecord[] {
    this.requireVolume(volumeId)
    const rows = this.db
      .prepare(`SELECT * FROM chapters WHERE volume_id = ? ORDER BY number ASC`)
      .all(volumeId) as ChapterRow[]
    return rows.map(rowToChapter)
  }

  /** Get a single chapter. */
  getChapter(id: string): ChapterRecord {
    return this.requireChapter(id)
  }

  /** Update a chapter (omitted fields are preserved). */
  updateChapter(id: string, input: Partial<ChapterInput>): ChapterRecord {
    this.requireChapter(id)
    const fields: string[] = []
    const values: unknown[] = []
    if (input.volumeId !== undefined) {
      fields.push('volume_id = ?')
      values.push(input.volumeId)
    }
    if (input.number !== undefined) {
      fields.push('number = ?')
      values.push(input.number)
    }
    if (input.title !== undefined) {
      fields.push('title = ?')
      values.push(input.title)
    }
    if (input.synopsis !== undefined) {
      fields.push('synopsis = ?')
      values.push(input.synopsis ?? null)
    }
    if (input.status !== undefined) {
      fields.push('status = ?')
      values.push(input.status)
    }
    if (input.pov !== undefined) {
      fields.push('pov_type = ?')
      values.push(input.pov.povType)
      fields.push('pov_character_id = ?')
      values.push(input.pov.povCharacterId ?? null)
    }
    if (fields.length === 0) {
      return this.requireChapter(id)
    }
    values.push(new Date().toISOString(), id)
    this.db
      .prepare(`UPDATE chapters SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values)
    return this.requireChapter(id)
  }

  /** Delete a chapter. */
  deleteChapter(id: string): void {
    this.requireChapter(id)
    this.db.prepare('DELETE FROM chapters WHERE id = ?').run(id)
  }

  // ------------------------------------------------------- scene POV

  /** Set the POV of a scene (first/third person + narrator character). */
  setScenePov(id: string, patch: ScenePovPatch): void {
    const row = this.db
      .prepare('SELECT id FROM scenes WHERE id = ?')
      .get(id) as { id: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Scene ${id} not found.`)
    const fields: string[] = []
    const values: unknown[] = []
    if (patch.povType !== undefined) {
      fields.push('pov_type = ?')
      values.push(patch.povType)
    }
    if (patch.povCharacterId !== undefined) {
      fields.push('pov_character_id = ?')
      values.push(patch.povCharacterId)
    }
    if (fields.length === 0) return
    values.push(new Date().toISOString(), id)
    this.db
      .prepare(`UPDATE scenes SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...values)
  }

  /** Get the POV of a scene. */
  getScenePov(id: string): PovSetting | undefined {
    const row = this.db
      .prepare('SELECT pov_type, pov_character_id FROM scenes WHERE id = ?')
      .get(id) as ScenePovRow | undefined
    if (!row) return undefined
    return {
      povType: (row.pov_type ?? 'THIRD_PERSON_LIMITED') as PovSetting['povType'],
      povCharacterId: row.pov_character_id ?? undefined,
    }
  }

  // ------------------------------------------------------- helpers

  private requireVolume(id: string): VolumeRecord {
    const row = this.db
      .prepare('SELECT * FROM volumes WHERE id = ?')
      .get(id) as VolumeRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Volume ${id} not found.`)
    return rowToVolume(row)
  }

  private requireChapter(id: string): ChapterRecord {
    const row = this.db
      .prepare('SELECT * FROM chapters WHERE id = ?')
      .get(id) as ChapterRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Chapter ${id} not found.`)
    return rowToChapter(row)
  }
}

// --------------------------------------------------------------- row mappers

function rowToVolume(row: VolumeRow): VolumeRecord {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status as 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'APPROVED' | 'FINAL',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToChapter(row: ChapterRow): ChapterRecord {
  return {
    id: row.id,
    volumeId: row.volume_id,
    number: row.number,
    title: row.title,
    synopsis: row.synopsis ?? undefined,
    status: row.status as 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'APPROVED' | 'FINAL',
    pov: {
      povType: (row.pov_type ?? 'THIRD_PERSON_LIMITED') as PovSetting['povType'],
      povCharacterId: row.pov_character_id ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
