/**
 * StoryboardService (Phase 3) — shots with professional camera metadata,
 * the visual Style Bible, and the asset registry behind imported frames.
 *
 * Frames are REAL: files are copied into the project's images/assets folder
 * and served by the main process through the restricted mirai-asset://
 * protocol (asset id → validated path inside the project).
 */
import { copyFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { extname, join } from 'node:path'
import { z } from 'zod'
import {
  AssetRecord,
  IMAGE_EXTENSIONS,
  MiraiError,
  ShotInput,
  ShotRecord,
  StyleBible,
  type AssetKind,
  type EntityId,
  type StyleBible as StyleBibleType,
} from '@mirai/shared'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'

const STYLE_KEY = 'style-bible'
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

interface ShotRow {
  id: string
  scene_id: string
  order_index: number
  title: string
  shot_type: string
  lens: string
  camera_movement: string
  duration_seconds: number
  dialogue: string | null
  notes: string | null
  frame_asset_id: string | null
  status: string
  created_at: string
  updated_at: string
}

interface AssetRow {
  id: string
  kind: string
  relative_path: string
  original_name: string
  mime: string
  bytes: number
  created_at: string
}

/** Parse with zod, converting failures into a MiraiError (spec §26). */
function parseShotInput(input: unknown) {
  const result = ShotInput.safeParse(input)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', 'Invalid shot.', {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}

export class StoryboardService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    /** Absolute path of the open project root — assets resolve relative to it. */
    private readonly projectRoot: string,
  ) {}

  // ----------------------------------------------------------------- shots

  listShots(sceneId: EntityId): ShotRecord[] {
    this.requireScene(sceneId)
    const rows = this.db
      .prepare('SELECT * FROM shots WHERE scene_id = ? ORDER BY order_index ASC')
      .all(sceneId) as ShotRow[]
    return rows.map(rowToShot)
  }

  createShot(sceneId: EntityId, input: z.input<typeof ShotInput>): ShotRecord {
    this.requireScene(sceneId)
    const parsed = parseShotInput(input)
    const id = newEntityId()
    const now = this.clock.isoNow()
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS max FROM shots WHERE scene_id = ?')
      .get(sceneId) as { max: number }
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO shots
           (id, scene_id, order_index, title, shot_type, lens, camera_movement,
            duration_seconds, dialogue, notes, frame_asset_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'TODO', ?, ?)`,
        )
        .run(
          id,
          sceneId,
          maxRow.max + 1,
          parsed.title,
          parsed.shotType,
          parsed.lens,
          parsed.cameraMovement,
          parsed.durationSeconds,
          parsed.dialogue ?? null,
          parsed.notes ?? null,
          now,
          now,
        )
    })
    insert()
    return this.requireShot(id)
  }

  updateShot(id: EntityId, input: z.input<typeof ShotInput>): ShotRecord {
    this.requireShot(id)
    const parsed = parseShotInput(input)
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `UPDATE shots SET
           title = ?, shot_type = ?, lens = ?, camera_movement = ?,
           duration_seconds = ?, dialogue = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.title,
        parsed.shotType,
        parsed.lens,
        parsed.cameraMovement,
        parsed.durationSeconds,
        parsed.dialogue ?? null,
        parsed.notes ?? null,
        now,
        id,
      )
    return this.requireShot(id)
  }

  deleteShot(id: EntityId): void {
    this.requireShot(id)
    const tx = this.db.transaction(() => {
      const shot = this.requireShot(id)
      if (shot.frameAssetId) this.pruneAssetIfOrphan(shot.frameAssetId)
      this.db.prepare('DELETE FROM shots WHERE id = ?').run(id)
    })
    tx()
  }

  /** Move a shot up/down within its scene; keeps order_index contiguous. */
  moveShot(id: EntityId, direction: 'up' | 'down'): void {
    const shot = this.requireShot(id)
    const delta = direction === 'up' ? -1 : 1
    const target = shot.orderIndex + delta
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS n FROM shots WHERE scene_id = ?')
      .get(shot.sceneId) as { n: number }
    if (target < 0 || target >= countRow.n) {
      throw new MiraiError('VALIDATION_ERROR', `Shot cannot move ${direction} any further.`)
    }
    const swap = this.db.transaction(() => {
      this.db
        .prepare('UPDATE shots SET order_index = ? WHERE scene_id = ? AND order_index = ?')
        .run(shot.orderIndex, shot.sceneId, target)
      this.db
        .prepare('UPDATE shots SET order_index = ? WHERE id = ?')
        .run(target, id)
    })
    swap()
  }

  // ----------------------------------------------------------------- frames

  /**
   * Copies a real image file into `images/assets/` and attaches it to a shot.
   * The source is validated (extension + size) BEFORE anything is registered.
   */
  importFrame(shotId: EntityId, sourcePath: string): AssetRecord {
    const shot = this.requireShot(shotId)

    const ext = extname(sourcePath).toLowerCase()
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Unsupported image type "${ext || 'unknown'}" — allowed: ${IMAGE_EXTENSIONS.join(', ')}.`,
      )
    }
    let size: number
    try {
      size = statSync(sourcePath).size
    } catch {
      throw new MiraiError('PATH_INVALID', `File not found: ${sourcePath}`)
    }
    if (size > MAX_IMAGE_BYTES) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Image is too large (${(size / 1024 / 1024).toFixed(1)} MB) — the limit is 40 MB.`,
      )
    }

    const id = newEntityId()
    const now = this.clock.isoNow()
    const relativePath = join('images', 'assets', `${id}${ext}`)
    const absolutePath = join(this.projectRoot, relativePath)

    const tx = this.db.transaction(() => {
      mkdirSync(join(this.projectRoot, 'images', 'assets'), { recursive: true })
      copyFileSync(sourcePath, absolutePath)
      this.db
        .prepare(
          `INSERT INTO assets (id, kind, relative_path, original_name, mime, bytes, created_at)
           VALUES (?, 'IMAGE', ?, ?, ?, ?, ?)`,
        )
        .run(id, relativePath, basename(sourcePath), IMAGE_MIME[ext] ?? 'application/octet-stream', size, now)
      // Detach + prune the previous frame if it becomes an orphan.
      const previous = shot.frameAssetId
      this.db
        .prepare('UPDATE shots SET frame_asset_id = ?, updated_at = ? WHERE id = ?')
        .run(id, now, shotId)
      if (previous) this.pruneAssetIfOrphan(previous)
    })
    tx()
    return this.getAsset(id)
  }

  clearFrame(shotId: EntityId): void {
    const shot = this.requireShot(shotId)
    if (!shot.frameAssetId) return
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE shots SET frame_asset_id = NULL, updated_at = ? WHERE id = ?')
        .run(this.clock.isoNow(), shotId)
      this.pruneAssetIfOrphan(shot.frameAssetId!)
    })
    tx()
  }

  // ----------------------------------------------------------------- assets

  getAsset(id: EntityId): AssetRecord {
    const row = this.db
      .prepare('SELECT * FROM assets WHERE id = ?')
      .get(id) as AssetRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Asset ${id} not found.`)
    return {
      id: row.id,
      kind: row.kind as AssetKind,
      relativePath: row.relative_path,
      originalName: row.original_name,
      mime: row.mime,
      bytes: row.bytes,
      createdAt: row.created_at,
    }
  }

  /** Absolute path for serving — validated to stay inside the project root. */
  assetAbsolutePath(id: EntityId): string {
    const asset = this.getAsset(id)
    const absolutePath = join(this.projectRoot, asset.relativePath)
    if (!absolutePath.startsWith(this.projectRoot + join('/', '')) && absolutePath !== this.projectRoot) {
      throw new MiraiError('PATH_INVALID', 'Asset path escapes the project folder.')
    }
    return absolutePath
  }

  revealAssetPath(id: EntityId): string {
    return this.assetAbsolutePath(id)
  }

  /** Delete an asset record + file when no shot references it. */
  pruneAssetIfOrphan(id: EntityId): void {
    const used = this.db
      .prepare('SELECT COUNT(*) AS n FROM shots WHERE frame_asset_id = ?')
      .get(id) as { n: number }
    if (used.n > 0) return
    const row = this.db
      .prepare('SELECT relative_path FROM assets WHERE id = ?')
      .get(id) as { relative_path: string } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id)
    try {
      unlinkSync(join(this.projectRoot, row.relative_path))
    } catch {
      // file already gone — the registry entry is the source of truth
    }
  }

  // ------------------------------------------------------------ style bible

  getStyleBible(): StyleBibleType {
    const row = this.db
      .prepare('SELECT value FROM kv_store WHERE key = ?')
      .get(STYLE_KEY) as { value: string } | undefined
    if (!row) return {}
    try {
      return StyleBible.parse(JSON.parse(row.value))
    } catch {
      return {}
    }
  }

  updateStyleBible(style: StyleBibleType): StyleBibleType {
    const checked = StyleBible.safeParse(style)
    if (!checked.success) {
      throw new MiraiError('VALIDATION_ERROR', 'Invalid style bible.', {
        details: checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const parsed = checked.data
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(STYLE_KEY, JSON.stringify(parsed), now)
    return parsed
  }

  // -------------------------------------------------------------- internal

  private requireScene(sceneId: EntityId): void {
    const row = this.db
      .prepare('SELECT id FROM scenes WHERE id = ?')
      .get(sceneId) as { id: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Scene ${sceneId} not found.`)
  }

  private requireShot(id: EntityId): ShotRecord {
    const row = this.db
      .prepare('SELECT * FROM shots WHERE id = ?')
      .get(id) as ShotRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Shot ${id} not found.`)
    return rowToShot(row)
  }
}

// ---------------------------------------------------------------------- utils

function rowToShot(row: ShotRow): ShotRecord {
  const parsed = ShotRecord.safeParse({
    id: row.id,
    sceneId: row.scene_id,
    orderIndex: row.order_index,
    title: row.title,
    shotType: row.shot_type,
    lens: row.lens,
    cameraMovement: row.camera_movement,
    durationSeconds: row.duration_seconds,
    dialogue: row.dialogue ?? undefined,
    notes: row.notes ?? undefined,
    frameAssetId: row.frame_asset_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted shot record ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}

function basename(path: string): string {
  const parts = path.replace(/[\\/]/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}
