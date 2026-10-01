/**
 * CreativeService — creative core: Story Bible, Characters, Locations,
 * Episodes and Scenes (with screenplay text).
 *
 * Lives on the open project's DB. Every record is validated with zod on read
 * (corruption surfaces as a precise error, never as a mystery crash).
 */
import { z } from 'zod'
import {
  MiraiError,
  CharacterInput,
  CharacterRecord,
  EpisodeInput,
  EpisodeRecord,
  EpisodeWithStats,
  LocationInput,
  LocationRecord,
  SceneInput,
  SceneRecord,
  StoryBible,
  type EntityId,
  type StoryBible as StoryBibleType,
} from '@mirai/shared'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId, parseJson } from '../types'

const BIBLE_KEY = 'story-bible'

interface CharacterRow {
  id: string
  name: string
  role: string
  age: string | null
  personality: string | null
  appearance: string | null
  voice: string | null
  bio: string | null
  goals: string | null
  fears: string | null
  notes: string | null
  status: string
  created_at: string
  updated_at: string
}

interface LocationRow {
  id: string
  name: string
  description: string | null
  climate: string | null
  architecture: string | null
  notes: string | null
  status: string
  created_at: string
  updated_at: string
}

interface EpisodeRow {
  id: string
  season: number
  number: number
  title: string
  synopsis: string | null
  status: string
  created_at: string
  updated_at: string
}

interface SceneRow {
  id: string
  episode_id: string
  order_index: number
  title: string
  location_id: string | null
  time_of_day: string
  synopsis: string | null
  screenplay: string | null
  status: string
  created_at: string
  updated_at: string
}

/** Parse with zod, converting failures into a MiraiError (spec §26). */
function parseWith<T extends z.ZodTypeAny>(schema: T, data: unknown, label: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', `Invalid ${label}.`, {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}

export class CreativeService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  // --------------------------------------------------------------- Story Bible

  getBible(): StoryBibleType {
    const row = this.db
      .prepare('SELECT value FROM kv_store WHERE key = ?')
      .get(BIBLE_KEY) as { value: string } | undefined
    if (!row) return {}
    try {
      return StoryBible.parse(parseJson(row.value))
    } catch {
      return {}
    }
  }

  updateBible(bible: StoryBibleType): StoryBibleType {
    const parsed = parseWith(StoryBible, bible, 'story bible')
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(BIBLE_KEY, JSON.stringify(parsed), now)
    return parsed
  }

  // ---------------------------------------------------------------- Characters

  listCharacters(): CharacterRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM characters ORDER BY created_at ASC')
      .all() as CharacterRow[]
    return rows.map(rowToCharacter)
  }

  createCharacter(input: z.input<typeof CharacterInput>): CharacterRecord {
    const parsed = parseWith(CharacterInput, input, 'character')
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO characters
         (id, name, role, age, personality, appearance, voice, bio, goals, fears, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.name,
        parsed.role,
        parsed.age ?? null,
        parsed.personality ?? null,
        parsed.appearance ?? null,
        parsed.voice ?? null,
        parsed.bio ?? null,
        parsed.goals ?? null,
        parsed.fears ?? null,
        parsed.notes ?? null,
        'DRAFT',
        now,
        now,
      )
    return this.requireCharacter(id)
  }

  updateCharacter(id: EntityId, input: z.input<typeof CharacterInput>): CharacterRecord {
    this.requireCharacter(id)
    const parsed = parseWith(CharacterInput, input, 'character')
    this.db
      .prepare(
        `UPDATE characters SET
           name = ?, role = ?, age = ?, personality = ?, appearance = ?,
           voice = ?, bio = ?, goals = ?, fears = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.name,
        parsed.role,
        parsed.age ?? null,
        parsed.personality ?? null,
        parsed.appearance ?? null,
        parsed.voice ?? null,
        parsed.bio ?? null,
        parsed.goals ?? null,
        parsed.fears ?? null,
        parsed.notes ?? null,
        this.clock.isoNow(),
        id,
      )
    return this.requireCharacter(id)
  }

  deleteCharacter(id: EntityId): void {
    this.requireCharacter(id)
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id)
  }

  private requireCharacter(id: EntityId): CharacterRecord {
    const row = this.db
      .prepare('SELECT * FROM characters WHERE id = ?')
      .get(id) as CharacterRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Character ${id} not found.`)
    return rowToCharacter(row)
  }

  // ----------------------------------------------------------------- Locations

  listLocations(): LocationRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM locations ORDER BY created_at ASC')
      .all() as LocationRow[]
    return rows.map(rowToLocation)
  }

  createLocation(input: z.input<typeof LocationInput>): LocationRecord {
    const parsed = parseWith(LocationInput, input, 'location')
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO locations
         (id, name, description, climate, architecture, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        parsed.name,
        parsed.description ?? null,
        parsed.climate ?? null,
        parsed.architecture ?? null,
        parsed.notes ?? null,
        'DRAFT',
        now,
        now,
      )
    return this.requireLocation(id)
  }

  updateLocation(id: EntityId, input: z.input<typeof LocationInput>): LocationRecord {
    this.requireLocation(id)
    const parsed = parseWith(LocationInput, input, 'location')
    this.db
      .prepare(
        `UPDATE locations SET
           name = ?, description = ?, climate = ?, architecture = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.name,
        parsed.description ?? null,
        parsed.climate ?? null,
        parsed.architecture ?? null,
        parsed.notes ?? null,
        this.clock.isoNow(),
        id,
      )
    return this.requireLocation(id)
  }

  deleteLocation(id: EntityId): void {
    this.requireLocation(id)
    this.db.prepare('DELETE FROM locations WHERE id = ?').run(id)
  }

  private requireLocation(id: EntityId): LocationRecord {
    const row = this.db
      .prepare('SELECT * FROM locations WHERE id = ?')
      .get(id) as LocationRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Location ${id} not found.`)
    return rowToLocation(row)
  }

  // ------------------------------------------------------------------ Episodes

  listEpisodes(): EpisodeWithStats[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM scenes s WHERE s.episode_id = e.id) AS scene_count
         FROM episodes e
         ORDER BY e.season ASC, e.number ASC`,
      )
      .all() as (EpisodeRow & { scene_count: number })[]
    return rows.map((row) => {
      const episode = rowToEpisode(row)
      return { ...episode, sceneCount: row.scene_count }
    })
  }

  createEpisode(input: z.input<typeof EpisodeInput>): EpisodeRecord {
    const parsed = parseWith(EpisodeInput, input, 'episode')
    const id = newEntityId()
    const now = this.clock.isoNow()
    try {
      this.db
        .prepare(
          `INSERT INTO episodes (id, season, number, title, synopsis, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          parsed.season,
          parsed.number,
          parsed.title,
          parsed.synopsis ?? null,
          'TODO',
          now,
          now,
        )
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new MiraiError(
          'ALREADY_EXISTS',
          `Episode S${parsed.season}E${parsed.number} already exists.`,
        )
      }
      throw err
    }
    return this.requireEpisode(id)
  }

  updateEpisode(id: EntityId, input: z.input<typeof EpisodeInput>): EpisodeRecord {
    this.requireEpisode(id)
    const parsed = parseWith(EpisodeInput, input, 'episode')
    try {
      this.db
        .prepare(
          `UPDATE episodes SET season = ?, number = ?, title = ?, synopsis = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          parsed.season,
          parsed.number,
          parsed.title,
          parsed.synopsis ?? null,
          this.clock.isoNow(),
          id,
        )
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new MiraiError(
          'ALREADY_EXISTS',
          `Episode S${parsed.season}E${parsed.number} already exists.`,
        )
      }
      throw err
    }
    return this.requireEpisode(id)
  }

  deleteEpisode(id: EntityId): void {
    this.requireEpisode(id)
    this.db.prepare('DELETE FROM episodes WHERE id = ?').run(id)
  }

  private requireEpisode(id: EntityId): EpisodeRecord {
    const row = this.db
      .prepare('SELECT * FROM episodes WHERE id = ?')
      .get(id) as EpisodeRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Episode ${id} not found.`)
    return rowToEpisode(row)
  }

  // -------------------------------------------------------------------- Scenes

  listScenes(episodeId: EntityId): SceneRecord[] {
    this.requireEpisode(episodeId)
    const rows = this.db
      .prepare('SELECT * FROM scenes WHERE episode_id = ? ORDER BY order_index ASC')
      .all(episodeId) as SceneRow[]
    return rows.map((row) => rowToScene(row, this.characterIdsFor(row.id)))
  }

  /** Look up a single scene across episodes (used by AI context building). */
  getSceneById(id: EntityId): SceneRecord {
    return this.requireScene(id)
  }

  /** Look up a single episode (used by the render/export pipeline). */
  getEpisodeById(id: EntityId): EpisodeRecord {
    return this.requireEpisode(id)
  }

  /** Look up a location name (used by AI context building). */
  locationName(id: string | undefined): string | undefined {
    if (!id) return undefined
    const row = this.db
      .prepare('SELECT name FROM locations WHERE id = ?')
      .get(id) as { name: string } | undefined
    return row?.name
  }

  createScene(episodeId: EntityId, input: z.input<typeof SceneInput>): SceneRecord {
    this.requireEpisode(episodeId)
    const parsed = parseWith(SceneInput, input, 'scene')
    this.assertLocationExists(parsed.locationId)
    for (const characterId of parsed.characterIds) this.requireCharacter(characterId)

    const id = newEntityId()
    const now = this.clock.isoNow()
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS max FROM scenes WHERE episode_id = ?')
      .get(episodeId) as { max: number }
    const orderIndex = maxRow.max + 1

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO scenes
           (id, episode_id, order_index, title, location_id, time_of_day, synopsis, screenplay, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          episodeId,
          orderIndex,
          parsed.title,
          parsed.locationId ?? null,
          parsed.timeOfDay,
          parsed.synopsis ?? null,
          parsed.screenplay ?? null,
          'TODO',
          now,
          now,
        )
      this.replaceSceneCharacters(id, parsed.characterIds)
    })
    insert()
    return this.requireScene(id)
  }

  updateScene(id: EntityId, input: z.input<typeof SceneInput>): SceneRecord {
    this.requireScene(id)
    const parsed = parseWith(SceneInput, input, 'scene')
    this.assertLocationExists(parsed.locationId)
    for (const characterId of parsed.characterIds) this.requireCharacter(characterId)

    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE scenes SET
             title = ?, location_id = ?, time_of_day = ?, synopsis = ?, screenplay = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          parsed.title,
          parsed.locationId ?? null,
          parsed.timeOfDay,
          parsed.synopsis ?? null,
          parsed.screenplay ?? null,
          this.clock.isoNow(),
          id,
        )
      this.replaceSceneCharacters(id, parsed.characterIds)
    })
    update()
    return this.requireScene(id)
  }

  deleteScene(id: EntityId): void {
    this.requireScene(id)
    const deleteTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM scene_characters WHERE scene_id = ?').run(id)
      this.db.prepare('DELETE FROM scenes WHERE id = ?').run(id)
    })
    deleteTx()
  }

  /** Move a scene up/down within its episode; keeps order_index contiguous. */
  moveScene(id: EntityId, direction: 'up' | 'down'): void {
    const scene = this.requireScene(id)
    const delta = direction === 'up' ? -1 : 1
    const target = scene.orderIndex + delta
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS n FROM scenes WHERE episode_id = ?')
      .get(scene.episodeId) as { n: number }
    if (target < 0 || target >= countRow.n) {
      throw new MiraiError('VALIDATION_ERROR', `Scene cannot move ${direction} any further.`)
    }
    const swap = this.db.transaction(() => {
      this.db
        .prepare('UPDATE scenes SET order_index = ? WHERE episode_id = ? AND order_index = ?')
        .run(scene.orderIndex, scene.episodeId, target)
      this.db
        .prepare('UPDATE scenes SET order_index = ? WHERE id = ?')
        .run(target, id)
    })
    swap()
  }

  private requireScene(id: EntityId): SceneRecord {
    const row = this.db
      .prepare('SELECT * FROM scenes WHERE id = ?')
      .get(id) as SceneRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Scene ${id} not found.`)
    return rowToScene(row, this.characterIdsFor(id))
  }

  private assertLocationExists(locationId: string | undefined): void {
    if (!locationId) return
    const row = this.db
      .prepare('SELECT id FROM locations WHERE id = ?')
      .get(locationId) as { id: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Location ${locationId} not found.`)
  }

  private characterIdsFor(sceneId: string): EntityId[] {
    const rows = this.db
      .prepare('SELECT character_id FROM scene_characters WHERE scene_id = ? ORDER BY character_id')
      .all(sceneId) as Array<{ character_id: string }>
    return rows.map((r) => r.character_id as EntityId)
  }

  private replaceSceneCharacters(sceneId: EntityId, characterIds: EntityId[]): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO scene_characters (scene_id, character_id) VALUES (?, ?)',
    )
    for (const characterId of characterIds) {
      insert.run(sceneId, characterId)
    }
    const existing = this.characterIdsFor(sceneId)
    const wanted = new Set(characterIds)
    const remove = this.db.prepare(
      'DELETE FROM scene_characters WHERE scene_id = ? AND character_id = ?',
    )
    for (const existingId of existing) {
      if (!wanted.has(existingId)) remove.run(sceneId, existingId)
    }
  }
}

// ---------------------------------------------------------------------- mappers

function rowToCharacter(row: CharacterRow): CharacterRecord {
  const parsed = CharacterRecord.safeParse({
    id: row.id,
    name: row.name,
    role: row.role,
    age: row.age ?? undefined,
    personality: row.personality ?? undefined,
    appearance: row.appearance ?? undefined,
    voice: row.voice ?? undefined,
    bio: row.bio ?? undefined,
    goals: row.goals ?? undefined,
    fears: row.fears ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted character record ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}

function rowToLocation(row: LocationRow): LocationRecord {
  const parsed = LocationRecord.safeParse({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    climate: row.climate ?? undefined,
    architecture: row.architecture ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted location record ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}

function rowToEpisode(row: EpisodeRow): EpisodeRecord {
  const parsed = EpisodeRecord.safeParse({
    id: row.id,
    season: row.season,
    number: row.number,
    title: row.title,
    synopsis: row.synopsis ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted episode record ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}

function rowToScene(row: SceneRow, characterIds: EntityId[]): SceneRecord {
  const parsed = SceneRecord.safeParse({
    id: row.id,
    episodeId: row.episode_id,
    orderIndex: row.order_index,
    title: row.title,
    locationId: row.location_id ?? undefined,
    timeOfDay: row.time_of_day,
    characterIds,
    synopsis: row.synopsis ?? undefined,
    screenplay: row.screenplay ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted scene record ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}
