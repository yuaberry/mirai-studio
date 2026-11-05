/**
 * ImpactService (v0.24) — the IP impact screen (§4): given one entity,
 * count its REAL dependents straight from the project tables. Every
 * number is a live query — no caching, no fabrication. This answers
 * "if I edit this character, what does it touch?" with facts.
 */
import type { Database } from 'better-sqlite3'
import type { ImpactEntry, ImpactKind, ImpactResult } from '@mirai/shared'
import { MiraiError } from '@mirai/shared'
import type { EntityId } from '@mirai/shared'

interface IdRow {
  id: string
}

const count = (db: Database, sql: string, ...params: unknown[]): { ids: string[]; n: number } => {
  const rows = db.prepare(sql).all(...params) as IdRow[]
  return { ids: rows.map((r) => r.id).slice(0, 50), n: rows.length }
}

export class ImpactService {
  constructor(private readonly db: Database) {}

  impact(kind: ImpactKind, id: EntityId): ImpactResult {
    switch (kind) {
      case 'CHARACTER':
        return this.character(id)
      case 'SCENE':
        return this.scene(id)
      case 'EPISODE':
        return this.episode(id)
      case 'LOCATION':
        return this.location(id)
      case 'SHOT':
        return this.shot(id)
    }
  }

  // -------------------------------------------------------------- character

  private character(id: EntityId): ImpactResult {
    const row = this.db
      .prepare('SELECT name FROM characters WHERE id = ?')
      .get(id) as { name: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Character ${id} not found.`)

    const impacts: ImpactEntry[] = []
    const push = (key: string, label: string, r: { ids: string[]; n: number }) => {
      if (r.n > 0) impacts.push({ key, label, count: r.n, entityIds: r.ids })
    }

    const scenes = count(
      this.db,
      'SELECT scene_id AS id FROM scene_characters WHERE character_id = ?',
      id,
    )
    push('scenes', 'Scenes this character appears in', scenes)

    const panels = count(
      this.db,
      `SELECT p.id AS id FROM manga_panels p, json_each(p.lettering) j
       WHERE j.value ->> 'characterId' = ?`,
      id,
    )
    push('panels', 'Manga panels with this character lettered', panels)

    const relationships = count(
      this.db,
      `SELECT id FROM character_relationships WHERE from_character_id = ? OR to_character_id = ?`,
      id,
      id,
    )
    push('relationships', 'Relationships', relationships)

    const costumes = count(
      this.db,
      'SELECT id FROM character_costumes WHERE character_id = ?',
      id,
    )
    push('costumes', 'Costumes', costumes)

    // indirect: shots inside the scenes this character appears in
    const shots = count(
      this.db,
      `SELECT DISTINCT sh.id AS id FROM shots sh
       JOIN scene_characters sc ON sc.scene_id = sh.scene_id
       WHERE sc.character_id = ?`,
      id,
    )
    push('shots', 'Shots in their scenes', shots)

    const subtitles = count(
      this.db,
      `SELECT DISTINCT sub.id AS id FROM subtitles sub
       JOIN scene_characters sc ON sc.scene_id = sub.scene_id
       WHERE sc.character_id = ?`,
      id,
    )
    push('subtitles', 'Subtitle cues in their scenes', subtitles)

    const tasks = count(
      this.db,
      'SELECT id FROM tasks WHERE link_type = ? AND link_id = ?',
      'CHARACTER',
      id,
    )
    push('tasks', 'Linked production tasks', tasks)

    const versions = count(
      this.db,
      'SELECT id FROM entity_versions WHERE entity_type = ? AND entity_id = ?',
      'CHARACTER',
      id,
    )
    push('versions', 'Snapshotted versions', versions)

    return { kind: 'CHARACTER', id, label: row.name, impacts }
  }

  // ----------------------------------------------------------------- scene

  private scene(id: EntityId): ImpactResult {
    const row = this.db
      .prepare('SELECT title, episode_id FROM scenes WHERE id = ?')
      .get(id) as { title: string; episode_id: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Scene ${id} not found.`)

    const impacts: ImpactEntry[] = []
    const push = (key: string, label: string, r: { ids: string[]; n: number }) => {
      if (r.n > 0) impacts.push({ key, label, count: r.n, entityIds: r.ids })
    }

    push('shots', 'Shots', count(this.db, 'SELECT id FROM shots WHERE scene_id = ?', id))
    push('subtitles', 'Subtitle cues', count(this.db, 'SELECT id FROM subtitles WHERE scene_id = ?', id))
    push(
      'tracks',
      'Timeline tracks',
      count(this.db, 'SELECT id FROM timeline_tracks WHERE scene_id = ?', id),
    )
    push(
      'characters',
      'Cast',
      count(this.db, 'SELECT character_id AS id FROM scene_characters WHERE scene_id = ?', id),
    )
    push(
      'tasks',
      'Linked production tasks',
      count(this.db, 'SELECT id FROM tasks WHERE link_type = ? AND link_id = ?', 'SCENE', id),
    )
    push(
      'versions',
      'Snapshotted versions',
      count(this.db, 'SELECT id FROM entity_versions WHERE entity_type = ? AND entity_id = ?', 'SCENE', id),
    )

    const ep = this.db
      .prepare('SELECT id FROM episodes WHERE id = ?')
      .get(row.episode_id) as IdRow | undefined
    if (ep) {
      impacts.push({ key: 'episode', label: 'Parent episode', count: 1, entityIds: [ep.id] })
    }

    return { kind: 'SCENE', id, label: row.title, impacts }
  }

  // --------------------------------------------------------------- episode

  private episode(id: EntityId): ImpactResult {
    const row = this.db
      .prepare('SELECT title FROM episodes WHERE id = ?')
      .get(id) as { title: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Episode ${id} not found.`)

    const impacts: ImpactEntry[] = []
    const push = (key: string, label: string, r: { ids: string[]; n: number }) => {
      if (r.n > 0) impacts.push({ key, label, count: r.n, entityIds: r.ids })
    }

    push('scenes', 'Scenes', count(this.db, 'SELECT id FROM scenes WHERE episode_id = ?', id))
    push(
      'pages',
      'Manga pages',
      count(this.db, 'SELECT id FROM manga_pages WHERE episode_id = ?', id),
    )
    push(
      'tasks',
      'Linked production tasks',
      count(this.db, 'SELECT id FROM tasks WHERE link_type = ? AND link_id = ?', 'EPISODE', id),
    )
    push(
      'versions',
      'Snapshotted versions',
      count(this.db, 'SELECT id FROM entity_versions WHERE entity_type = ? AND entity_id = ?', 'EPISODE', id),
    )

    // indirect: everything inside the scenes
    const shots = count(
      this.db,
      'SELECT id FROM shots WHERE scene_id IN (SELECT id FROM scenes WHERE episode_id = ?)',
      id,
    )
    push('shots', 'Shots across its scenes', shots)

    return { kind: 'EPISODE', id, label: row.title, impacts }
  }

  // -------------------------------------------------------------- location

  private location(id: EntityId): ImpactResult {
    const row = this.db
      .prepare('SELECT name FROM locations WHERE id = ?')
      .get(id) as { name: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Location ${id} not found.`)

    const impacts: ImpactEntry[] = []
    const push = (key: string, label: string, r: { ids: string[]; n: number }) => {
      if (r.n > 0) impacts.push({ key, label, count: r.n, entityIds: r.ids })
    }

    push('scenes', 'Scenes set here', count(this.db, 'SELECT id FROM scenes WHERE location_id = ?', id))
    push(
      'shots',
      'Shots in those scenes',
      count(
        this.db,
        'SELECT id FROM shots WHERE scene_id IN (SELECT id FROM scenes WHERE location_id = ?)',
        id,
      ),
    )
    push(
      'tasks',
      'Linked production tasks',
      count(this.db, 'SELECT id FROM tasks WHERE link_type = ? AND link_id = ?', 'LOCATION', id),
    )
    push(
      'versions',
      'Snapshotted versions',
      count(this.db, 'SELECT id FROM entity_versions WHERE entity_type = ? AND entity_id = ?', 'LOCATION', id),
    )

    return { kind: 'LOCATION', id, label: row.name, impacts }
  }

  // ------------------------------------------------------------------ shot

  private shot(id: EntityId): ImpactResult {
    const row = this.db
      .prepare('SELECT title, scene_id FROM shots WHERE id = ?')
      .get(id) as { title: string; scene_id: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Shot ${id} not found.`)

    const impacts: ImpactEntry[] = []
    const push = (key: string, label: string, r: { ids: string[]; n: number }) => {
      if (r.n > 0) impacts.push({ key, label, count: r.n, entityIds: r.ids })
    }

    const shotRow = this.db
      .prepare('SELECT frame_asset_id, audio_asset_id, video_asset_id, blend_asset_id FROM shots WHERE id = ?')
      .get(id) as { frame_asset_id: string | null; audio_asset_id: string | null; video_asset_id: string | null; blend_asset_id: string | null }
    const assetIds = [shotRow.frame_asset_id, shotRow.audio_asset_id, shotRow.video_asset_id, shotRow.blend_asset_id]
      .filter((a): a is string => a !== null)
    if (assetIds.length > 0) {
      impacts.push({ key: 'assets', label: 'Attached assets', count: assetIds.length, entityIds: assetIds.slice(0, 50) })
    }

    push(
      'tasks',
      'Linked production tasks',
      count(this.db, 'SELECT id FROM tasks WHERE link_type = ? AND link_id = ?', 'SHOT', id),
    )
    push(
      'versions',
      'Snapshotted versions',
      count(this.db, 'SELECT id FROM entity_versions WHERE entity_type = ? AND entity_id = ?', 'SHOT', id),
    )
    push(
      'panels',
      'Manga panels referencing this shot',
      count(this.db, 'SELECT id FROM manga_panels WHERE shot_id = ?', id),
    )

    return { kind: 'SHOT', id, label: row.title, impacts }
  }
}
