/**
 * MoodboardService (v0.27, §7 Visual Dev Lab slice 1) — the project's
 * reference board: real images through the asset pipeline, captions,
 * one user-picked palette color per item (the board's color strip is
 * the color script's first artifact), orderable. Removing an item
 * deletes its asset ONLY when nothing else references it.
 */
import type { Database } from 'better-sqlite3'
import { basename, extname, join } from 'node:path'
import { copyFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { z } from 'zod'
import { IMAGE_EXTENSIONS, MoodboardItemInput, type MoodboardItem } from '@mirai/shared'
import type { Clock } from '../types'
import type { EntityId } from '@mirai/shared'
import { MiraiError } from '@mirai/shared'
import { newEntityId } from '../types'

interface ItemRow {
  id: string
  image_asset_id: string
  caption: string | null
  color: string | null
  order_index: number
  created_at: string
  updated_at: string
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

function parseWith<T extends z.ZodTypeAny>(schema: T, data: unknown, label: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', `Invalid ${label}.`, {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}

function rowToItem(row: ItemRow): MoodboardItem {
  return {
    id: row.id,
    imageAssetId: row.image_asset_id,
    caption: row.caption,
    color: row.color,
    orderIndex: row.order_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class MoodboardService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  list(): MoodboardItem[] {
    const rows = this.db
      .prepare('SELECT * FROM moodboard_items ORDER BY order_index ASC')
      .all() as ItemRow[]
    return rows.map(rowToItem)
  }

  /** Import a real image as a new board reference (appended at the end). */
  attachImage(sourcePath: string): MoodboardItem {
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

    const assetId = newEntityId()
    const itemId = newEntityId()
    const now = this.clock.isoNow()
    const relativePath = join('images', 'assets', `${assetId}${ext}`)
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS n FROM moodboard_items')
      .get() as { n: number }

    const tx = this.db.transaction(() => {
      mkdirSync(join(this.projectRoot, 'images', 'assets'), { recursive: true })
      copyFileSync(sourcePath, join(this.projectRoot, relativePath))
      this.db
        .prepare(
          `INSERT INTO assets (id, kind, relative_path, original_name, mime, bytes, created_at)
           VALUES (?, 'IMAGE', ?, ?, ?, ?, ?)`,
        )
        .run(assetId, relativePath, basename(sourcePath), IMAGE_MIME[ext] ?? 'application/octet-stream', size, now)
      this.db
        .prepare(
          `INSERT INTO moodboard_items (id, image_asset_id, caption, color, order_index, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(itemId, assetId, maxRow.n + 1, now, now)
    })
    tx()
    return this.requireItem(itemId)
  }

  update(id: EntityId, input: z.input<typeof MoodboardItemInput>): MoodboardItem {
    this.requireItem(id)
    const parsed = parseWith(MoodboardItemInput, input, 'moodboard item')
    this.db
      .prepare('UPDATE moodboard_items SET caption = ?, color = ?, updated_at = ? WHERE id = ?')
      .run(parsed.caption ?? null, parsed.color ?? null, this.clock.isoNow(), id)
    return this.requireItem(id)
  }

  remove(id: EntityId): void {
    const item = this.requireItem(id)
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM moodboard_items WHERE id = ?').run(id)
      this.pruneAssetIfUnreferenced(item.imageAssetId)
      this.renumber()
    })
    tx()
  }

  move(id: EntityId, direction: 'up' | 'down'): void {
    const item = this.requireItem(id)
    const target = item.orderIndex + (direction === 'up' ? -1 : 1)
    const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM moodboard_items').get() as { n: number }
    if (target < 0 || target >= countRow.n) {
      throw new MiraiError('VALIDATION_ERROR', `Item cannot move ${direction} any further.`)
    }
    const swap = this.db.transaction(() => {
      this.db
        .prepare('UPDATE moodboard_items SET order_index = ? WHERE order_index = ?')
        .run(item.orderIndex, target)
      this.db
        .prepare('UPDATE moodboard_items SET order_index = ? WHERE id = ?')
        .run(target, id)
    })
    swap()
  }

  /** The board's color strip — palette colors in board order. */
  palette(): string[] {
    return this.list()
      .map((i) => i.color)
      .filter((c): c is string => c !== null)
  }

  /** Delete an asset + file when NOTHING references it (shots, panels, board). */
  private pruneAssetIfUnreferenced(assetId: EntityId): void {
    const used = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM shots WHERE frame_asset_id = ?) AS in_shots,
           (SELECT COUNT(*) FROM manga_panels WHERE image_asset_id = ?) AS in_panels,
           (SELECT COUNT(*) FROM moodboard_items WHERE image_asset_id = ?) AS in_board`,
      )
      .get(assetId, assetId, assetId) as { in_shots: number; in_panels: number; in_board: number }
    if (used.in_shots > 0 || used.in_panels > 0 || used.in_board > 0) return
    const row = this.db
      .prepare('SELECT relative_path FROM assets WHERE id = ?')
      .get(assetId) as { relative_path: string } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
    try {
      unlinkSync(join(this.projectRoot, row.relative_path))
    } catch {
      // file already gone — the registry entry is the source of truth
    }
  }

  private requireItem(id: EntityId): MoodboardItem {
    const row = this.db
      .prepare('SELECT * FROM moodboard_items WHERE id = ?')
      .get(id) as ItemRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Moodboard item ${id} not found.`)
    return rowToItem(row)
  }

  private renumber(): void {
    const rows = this.db
      .prepare('SELECT id FROM moodboard_items ORDER BY order_index ASC')
      .all() as { id: string }[]
    const update = this.db.prepare('UPDATE moodboard_items SET order_index = ? WHERE id = ?')
    rows.forEach((row, i) => update.run(i, row.id))
  }
}
