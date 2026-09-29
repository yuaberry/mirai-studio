/**
 * MediaService (Phase 4) — the project's Music/SFX/Ambience library.
 * Real files are imported via dialog in the main process; the service
 * registers them as assets and organizes them as library tracks.
 */
import { copyFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { extname, join } from 'node:path'
import {
  MiraiError,
  MediaTrack,
  SceneMedia,
  type MediaKind,
  type MediaRole,
  type EntityId,
} from '@mirai/shared'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus', '.weba']
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
}
const MAX_AUDIO_BYTES = 100 * 1024 * 1024

interface MediaRow {
  id: string
  kind: string
  title: string
  asset_id: string
  tags: string | null
  created_at: string
  updated_at: string
}

export class MediaService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  list(kind?: string): MediaTrack[] {
    const rows =
      kind && kind !== 'all'
        ? (this.db
            .prepare('SELECT * FROM media_tracks WHERE kind = ? ORDER BY created_at ASC')
            .all(kind) as MediaRow[])
        : (this.db
            .prepare('SELECT * FROM media_tracks ORDER BY created_at ASC')
            .all() as MediaRow[])
    return rows.map(rowToTrack)
  }

  /** Imports a real audio file into the media library. */
  import(kind: MediaKind, sourcePath: string, title?: string): MediaTrack {
    const ext = extname(sourcePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Unsupported audio type "${ext || 'unknown'}" — allowed: ${AUDIO_EXTENSIONS.join(', ')}.`,
      )
    }
    let size: number
    try {
      size = statSync(sourcePath).size
    } catch {
      throw new MiraiError('PATH_INVALID', `File not found: ${sourcePath}`)
    }
    if (size > MAX_AUDIO_BYTES) {
      throw new MiraiError('VALIDATION_ERROR', `Audio is too large (${(size / 1024 / 1024).toFixed(1)} MB) — limit is 100 MB.`)
    }

    const assetId = newEntityId()
    const trackId = newEntityId()
    const now = this.clock.isoNow()
    const relativePath = join('audio', 'library', `${assetId}${ext}`)
    const defaultTitle = title ?? sourcePath.split('/').pop()?.replace(ext, '') ?? 'Untitled'

    const tx = this.db.transaction(() => {
      mkdirSync(join(this.projectRoot, 'audio', 'library'), { recursive: true })
      copyFileSync(sourcePath, join(this.projectRoot, relativePath))
      this.db
        .prepare(
          `INSERT INTO assets (id, kind, relative_path, original_name, mime, bytes, created_at)
           VALUES (?, 'AUDIO', ?, ?, ?, ?, ?)`,
        )
        .run(assetId, relativePath, `${defaultTitle}${ext}`, AUDIO_MIME[ext] ?? 'application/octet-stream', size, now)
      this.db
        .prepare(
          `INSERT INTO media_tracks (id, kind, title, asset_id, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(trackId, kind, defaultTitle, assetId, now, now)
    })
    tx()
    return this.get(trackId)
  }

  get(id: EntityId): MediaTrack {
    const row = this.db
      .prepare('SELECT * FROM media_tracks WHERE id = ?')
      .get(id) as MediaRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Media track ${id} not found.`)
    return rowToTrack(row)
  }

  update(id: EntityId, input: { title: string; tags?: string }): MediaTrack {
    this.get(id)
    this.db
      .prepare('UPDATE media_tracks SET title = ?, tags = ?, updated_at = ? WHERE id = ?')
      .run(input.title, input.tags ?? null, this.clock.isoNow(), id)
    return this.get(id)
  }

  delete(id: EntityId): void {
    const track = this.get(id)
    // Remove scene assignments first (FK cascade handles it, but be explicit)
    this.db.prepare('DELETE FROM scene_media WHERE media_id = ?').run(id)
    this.db.prepare('DELETE FROM media_tracks WHERE id = ?').run(id)
    // Prune the underlying asset + file
    const assetRow = this.db
      .prepare('SELECT relative_path FROM assets WHERE id = ?')
      .get(track.assetId) as { relative_path: string } | undefined
    if (assetRow) {
      this.db.prepare('DELETE FROM assets WHERE id = ?').run(track.assetId)
      try {
        unlinkSync(join(this.projectRoot, assetRow.relative_path))
      } catch {
        // file already gone
      }
    }
  }

  assetAbsolutePath(assetId: EntityId): string {
    const row = this.db
      .prepare('SELECT relative_path FROM assets WHERE id = ?')
      .get(assetId) as { relative_path: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Asset ${assetId} not found.`)
    const abs = join(this.projectRoot, row.relative_path)
    if (!abs.startsWith(this.projectRoot)) {
      throw new MiraiError('PATH_INVALID', 'Asset path escapes the project folder.')
    }
    return abs
  }

  // -------------------------------------------------------- scene assignment

  assignToScene(sceneId: EntityId, mediaId: EntityId, role: MediaRole, volume: number): void {
    this.get(mediaId)
    this.db
      .prepare(
        `INSERT INTO scene_media (scene_id, media_id, role, volume)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scene_id, media_id) DO UPDATE SET role = excluded.role, volume = excluded.volume`,
      )
      .run(sceneId, mediaId, role, volume)
  }

  removeFromScene(sceneId: EntityId, mediaId: EntityId): void {
    this.db
      .prepare('DELETE FROM scene_media WHERE scene_id = ? AND media_id = ?')
      .run(sceneId, mediaId)
  }

  listSceneMedia(sceneId: EntityId): Array<SceneMedia & { track?: MediaTrack }> {
    const rows = this.db
      .prepare(
        `SELECT sm.*, mt.title as media_title, mt.kind as media_kind
         FROM scene_media sm
         JOIN media_tracks mt ON mt.id = sm.media_id
         WHERE sm.scene_id = ?`,
      )
      .all(sceneId) as Array<{
        scene_id: string
        media_id: string
        role: string
        volume: number
        media_title: string
        media_kind: string
      }>

    return rows.map((row) => {
      const track = this.get(row.media_id)
      return {
        sceneId: row.scene_id as EntityId,
        mediaId: row.media_id as EntityId,
        role: row.role as MediaRole,
        volume: row.volume,
        track,
      }
    })
  }
}

function rowToTrack(row: MediaRow): MediaTrack {
  const parsed = MediaTrack.safeParse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    assetId: row.asset_id,
    tags: row.tags ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted media track ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}
