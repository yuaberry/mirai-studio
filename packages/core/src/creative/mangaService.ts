/**
 * Manga Pro (§8 of the expansion roadmap) — slice 1: pages, panels and
 * lettering as data. Chapters reuse the existing episodes table; every
 * page belongs to an episode, every panel belongs to a page, and every
 * bubble is a typed record inside the panel's lettering JSON.
 *
 * The lettering script export turns this data into the professional
 * deliverable a letterer/artist works from (per page, per panel,
 * character-attributed dialogue, SFX, reading direction).
 */
import type { Database } from 'better-sqlite3'
import { basename, extname, join } from 'node:path'
import { copyFileSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import {
  IMAGE_EXTENSIONS,
  MangaPageInput,
  MangaPageRecord,
  MangaPanelInput,
  MangaPanelRecord,
  BubbleInput,
  type BubbleKind,
  type BubbleTail,
} from '@mirai/shared'
import type { Clock } from '../types'
import { newEntityId, parseJson } from '../types'
import type { EntityId } from '@mirai/shared'
import { MiraiError } from '@mirai/shared'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const MAX_IMAGE_BYTES = 40 * 1024 * 1024

interface PageRow {
  id: string
  episode_id: string
  number: number
  reading_direction: string
  layout_notes: string | null
  status: string
  created_at: string
  updated_at: string
  panel_count?: number
}

interface PanelRow {
  id: string
  page_id: string
  order_index: number
  shot_id: string | null
  image_asset_id: string | null
  lettering: string
  created_at: string
  updated_at: string
}

interface EpisodeRow {
  id: string
  season: number
  number: number
  title: string
}

interface CharacterRow {
  id: string
  name: string
}

const BUBBLE_ID_RE = /^[0-9A-Z]{26}$/

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

function rowToPage(row: PageRow): MangaPageRecord {
  return {
    id: row.id,
    episodeId: row.episode_id,
    number: row.number,
    readingDirection: row.reading_direction === 'LTR' ? 'LTR' : 'RTL',
    layoutNotes: row.layout_notes ?? undefined,
    status: (row.status as MangaPageRecord['status']) ?? 'TODO',
    panelCount: row.panel_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToPanel(row: PanelRow): MangaPanelRecord {
  const raw = parseJson(row.lettering)
  const bubbles: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : []
  return {
    id: row.id,
    pageId: row.page_id,
    orderIndex: row.order_index,
    shotId: row.shot_id ?? undefined,
    imageAssetId: row.image_asset_id,
    lettering: bubbles
      .map((b, i) => ({
        kind: (typeof b['kind'] === 'string' ? b['kind'] : 'SPEECH') as BubbleKind,
        text: String(b['text'] ?? ''),
        x: typeof b['x'] === 'number' ? b['x'] : 0.5,
        y: typeof b['y'] === 'number' ? b['y'] : 0.5,
        width: typeof b['width'] === 'number' ? b['width'] : 0.35,
        tail: (typeof b['tail'] === 'string' ? b['tail'] : 'BOTTOM_LEFT') as BubbleTail,
        characterId: typeof b['characterId'] === 'string' ? b['characterId'] : undefined,
        orderIndex: typeof b['orderIndex'] === 'number' ? b['orderIndex'] : i,
        id: typeof b['id'] === 'string' && BUBBLE_ID_RE.test(b['id']) ? b['id'] : newEntityId(),
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Validate + normalize the lettering array on its way INTO the database. */
function letteringToJson(input: unknown): string {
  const bubbles = parseWith(z.array(BubbleInput), input, 'lettering')
  return JSON.stringify(
    bubbles
      .map((b, i) => ({ ...b, id: newEntityId(), orderIndex: i }))
      .sort((a, b) => a.orderIndex - b.orderIndex),
  )
}

export class MangaService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  // ------------------------------------------------------------------- pages

  listPages(episodeId: EntityId): MangaPageRecord[] {
    this.requireEpisode(episodeId)
    const rows = this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM manga_panels pn WHERE pn.page_id = p.id) AS panel_count
         FROM manga_pages p WHERE p.episode_id = ? ORDER BY p.number ASC`,
      )
      .all(episodeId) as PageRow[]
    return rows.map(rowToPage)
  }

  createPage(episodeId: EntityId, input: z.input<typeof MangaPageInput>): MangaPageRecord {
    this.requireEpisode(episodeId)
    const parsed = parseWith(MangaPageInput, input, 'manga page')
    const maxRow = this.db
      .prepare('SELECT MAX(number) AS n FROM manga_pages WHERE episode_id = ?')
      .get(episodeId) as { n: number | null }
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO manga_pages (id, episode_id, number, reading_direction, layout_notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        episodeId,
        (maxRow.n ?? 0) + 1,
        parsed.readingDirection,
        parsed.layoutNotes ?? null,
        parsed.status ?? 'TODO',
        now,
        now,
      )
    return this.requirePage(id)
  }

  updatePage(id: EntityId, input: z.input<typeof MangaPageInput>): MangaPageRecord {
    const existing = this.requirePage(id)
    const parsed = parseWith(MangaPageInput, input, 'manga page')
    this.db
      .prepare(
        `UPDATE manga_pages SET reading_direction = ?, layout_notes = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.readingDirection,
        parsed.layoutNotes ?? null,
        parsed.status ?? existing.status,
        this.clock.isoNow(),
        id,
      )
    return this.requirePage(id)
  }

  deletePage(id: EntityId): void {
    const page = this.requirePage(id)
    const tx = this.db.transaction(() => {
      const panels = this.db
        .prepare('SELECT image_asset_id FROM manga_panels WHERE page_id = ? AND image_asset_id IS NOT NULL')
        .all(id) as { image_asset_id: string }[]
      this.db.prepare('DELETE FROM manga_pages WHERE id = ?').run(id)
      for (const p of panels) this.pruneAssetIfOrphan(p.image_asset_id)
      this.renumberPages(page.episodeId)
    })
    tx()
  }

  movePage(id: EntityId, direction: 'up' | 'down'): void {
    const page = this.requirePage(id)
    const target = direction === 'up' ? page.number - 1 : page.number + 1
    const neighbor = this.db
      .prepare('SELECT id FROM manga_pages WHERE episode_id = ? AND number = ?')
      .get(page.episodeId, target) as { id: string } | undefined
    if (!neighbor) {
      throw new MiraiError('VALIDATION_ERROR', `Page cannot move ${direction} any further.`)
    }
    // UNIQUE(episode_id, number): park this page on a negative sentinel
    // so the swap never collides.
    const tx = this.db.transaction(() => {
      const now = this.clock.isoNow()
      this.db
        .prepare('UPDATE manga_pages SET number = ?, updated_at = ? WHERE id = ?')
        .run(-page.number, now, id)
      this.db
        .prepare('UPDATE manga_pages SET number = ?, updated_at = ? WHERE id = ?')
        .run(page.number, now, neighbor.id)
      this.db
        .prepare('UPDATE manga_pages SET number = ?, updated_at = ? WHERE id = ?')
        .run(target, now, id)
    })
    tx()
  }

  // ------------------------------------------------------------------ panels

  listPanels(pageId: EntityId): MangaPanelRecord[] {
    this.requirePage(pageId)
    const rows = this.db
      .prepare('SELECT * FROM manga_panels WHERE page_id = ? ORDER BY order_index ASC')
      .all(pageId) as PanelRow[]
    return rows.map(rowToPanel)
  }

  createPanel(pageId: EntityId, input: z.input<typeof MangaPanelInput>): MangaPanelRecord {
    this.requirePage(pageId)
    const parsed = parseWith(MangaPanelInput, input, 'manga panel')
    if (parsed.shotId) this.assertShotExists(parsed.shotId)
    const maxRow = this.db
      .prepare('SELECT MAX(order_index) AS n FROM manga_panels WHERE page_id = ?')
      .get(pageId) as { n: number | null }
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO manga_panels (id, page_id, order_index, shot_id, image_asset_id, lettering, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(id, pageId, (maxRow.n ?? -1) + 1, parsed.shotId ?? null, letteringToJson(parsed.lettering), now, now)
    return this.requirePanel(id)
  }

  updatePanel(id: EntityId, input: z.input<typeof MangaPanelInput>): MangaPanelRecord {
    this.requirePanel(id) // existence + honest NOT_FOUND
    const parsed = parseWith(MangaPanelInput, input, 'manga panel')
    if (parsed.shotId) this.assertShotExists(parsed.shotId)
    this.db
      .prepare('UPDATE manga_panels SET shot_id = ?, lettering = ?, updated_at = ? WHERE id = ?')
      .run(parsed.shotId ?? null, letteringToJson(parsed.lettering), this.clock.isoNow(), id)
    return this.requirePanel(id)
  }

  deletePanel(id: EntityId): void {
    const panel = this.requirePanel(id)
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM manga_panels WHERE id = ?').run(id)
      if (panel.imageAssetId) this.pruneAssetIfOrphan(panel.imageAssetId)
      this.renumberPanels(panel.pageId)
    })
    tx()
  }

  movePanel(id: EntityId, direction: 'up' | 'down'): void {
    const panel = this.requirePanel(id)
    const delta = direction === 'up' ? -1 : 1
    const target = panel.orderIndex + delta
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS n FROM manga_panels WHERE page_id = ?')
      .get(panel.pageId) as { n: number }
    if (target < 0 || target >= countRow.n) {
      throw new MiraiError('VALIDATION_ERROR', `Panel cannot move ${direction} any further.`)
    }
    const swap = this.db.transaction(() => {
      this.db
        .prepare('UPDATE manga_panels SET order_index = ? WHERE page_id = ? AND order_index = ?')
        .run(panel.orderIndex, panel.pageId, target)
      this.db
        .prepare('UPDATE manga_panels SET order_index = ? WHERE id = ?')
        .run(target, id)
    })
    swap()
  }

  // ------------------------------------------------------------------- image

  /** Import a real image file as the panel's art (mirrors storyboard frames). */
  attachPanelImage(panelId: EntityId, sourcePath: string): MangaPanelRecord {
    const panel = this.requirePanel(panelId)
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
    const tx = this.db.transaction(() => {
      mkdirSync(join(this.projectRoot, 'images', 'assets'), { recursive: true })
      copyFileSync(sourcePath, join(this.projectRoot, relativePath))
      this.db
        .prepare(
          `INSERT INTO assets (id, kind, relative_path, original_name, mime, bytes, created_at)
           VALUES (?, 'IMAGE', ?, ?, ?, ?, ?)`,
        )
        .run(id, relativePath, basename(sourcePath), IMAGE_MIME[ext] ?? 'application/octet-stream', size, now)
      this.db
        .prepare('UPDATE manga_panels SET image_asset_id = ?, updated_at = ? WHERE id = ?')
        .run(id, now, panelId)
      if (panel.imageAssetId) this.pruneAssetIfOrphan(panel.imageAssetId)
    })
    tx()
    return this.requirePanel(panelId)
  }

  /** Delete an asset record + file when no shot AND no panel references it. */
  pruneAssetIfOrphan(id: EntityId): void {
    const used = this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM shots WHERE frame_asset_id = ?) AS in_shots,
           (SELECT COUNT(*) FROM manga_panels WHERE image_asset_id = ?) AS in_panels`,
      )
      .get(id, id) as { in_shots: number; in_panels: number }
    if (used.in_shots > 0 || used.in_panels > 0) return
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

  // ----------------------------------------------------------------- export

  /**
   * Write the professional lettering script for an episode (chapter) to
   * exports/manga/S{season}E{number}-lettering.txt and return the absolute
   * path. This is the deliverable a letterer/artist works from.
   */
  exportLetteringScript(episodeId: EntityId): { path: string; pages: number; bubbles: number } {
    const episode = this.requireEpisode(episodeId) as EpisodeRow
    const pages = this.listPages(episodeId)
    const nameById = new Map<string, string>(
      (this.db.prepare('SELECT id, name FROM characters').all() as CharacterRow[]).map((c) => [c.id, c.name]),
    )

    const lines: string[] = []
    lines.push('MIRAI STUDIO — LETTERING SCRIPT')
    lines.push(`Episode: S${episode.season}E${episode.number} — "${episode.title}"`)
    const rtl = pages.some((p) => p.readingDirection === 'RTL')
    lines.push(`Reading direction: ${rtl ? 'RIGHT-TO-LEFT (manga standard)' : 'LEFT-TO-RIGHT'}`)
    if (pages.some((p) => p.layoutNotes)) lines.push('Layout notes are marked per page below.')
    lines.push('')

    let bubbleCount = 0
    for (const page of pages) {
      lines.push(`PAGE ${page.number} (${page.readingDirection === 'RTL' ? 'right-to-left' : 'left-to-right'})`)
      if (page.layoutNotes) lines.push(`  Layout notes: ${page.layoutNotes}`)
      const panels = this.listPanels(page.id)
      if (panels.length === 0) lines.push('  (no panels yet)')
      panels.forEach((panel, i) => {
        const ref = panel.shotId ? ` — shot ref ${panel.shotId}` : ''
        lines.push(`  PANEL ${i + 1}${ref}`)
        if (panel.lettering.length === 0) {
          lines.push('    (no lettering)')
          return
        }
        panel.lettering.forEach((bubble) => {
          bubbleCount += 1
          const who = bubble.characterId ? (nameById.get(bubble.characterId) ?? 'UNKNOWN CHARACTER') : null
          const label =
            bubble.kind === 'SFX'
              ? 'SFX'
              : bubble.kind === 'NARRATION' || bubble.kind === 'CAPTION'
                ? bubble.kind.toLowerCase()
                : `${who ?? 'UNATTRIBUTED'} (${bubble.kind.toLowerCase()})`
          const tail = bubble.tail === 'NONE' ? '' : ` [tail ${bubble.tail.toLowerCase().replace(/_/g, ' ')}]`
          lines.push(`    ${bubble.orderIndex + 1}. ${label}: "${bubble.text}"${tail}`)
        })
      })
      lines.push('')
    }

    const dir = join(this.projectRoot, 'exports', 'manga')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `S${episode.season}E${episode.number}-lettering.txt`)
    writeFileSync(path, lines.join('\n'), 'utf8')
    return { path, pages: pages.length, bubbles: bubbleCount }
  }

  /** Absolute path of the episode's lettering script (for reveal). */
  letteringScriptPath(episodeId: EntityId): string {
    const episode = this.requireEpisode(episodeId) as EpisodeRow
    return join(
      this.projectRoot,
      'exports',
      'manga',
      `S${episode.season}E${episode.number}-lettering.txt`,
    )
  }

  // ----------------------------------------------------------------- helpers

  private requireEpisode(episodeId: EntityId): EpisodeRow {
    const row = this.db
      .prepare('SELECT id, season, number, title FROM episodes WHERE id = ?')
      .get(episodeId) as EpisodeRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Episode ${episodeId} not found.`)
    return row
  }

  private requirePage(id: EntityId): MangaPageRecord {
    const row = this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM manga_panels pn WHERE pn.page_id = p.id) AS panel_count
         FROM manga_pages p WHERE p.id = ?`,
      )
      .get(id) as PageRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Manga page ${id} not found.`)
    return rowToPage(row)
  }

  private requirePanel(id: EntityId): MangaPanelRecord {
    const row = this.db
      .prepare('SELECT * FROM manga_panels WHERE id = ?')
      .get(id) as PanelRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Manga panel ${id} not found.`)
    return rowToPanel(row)
  }

  private assertShotExists(shotId: string): void {
    const row = this.db.prepare('SELECT id FROM shots WHERE id = ?').get(shotId) as { id: string } | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Shot ${shotId} not found.`)
  }

  /** Contiguous 1..n numbering after a page is deleted (UNIQUE-safe). */
  private renumberPages(episodeId: EntityId): void {
    this.db.prepare('UPDATE manga_pages SET number = -number WHERE episode_id = ?').run(episodeId)
    const rows = this.db
      .prepare('SELECT id FROM manga_pages WHERE episode_id = ? ORDER BY number DESC')
      .all(episodeId) as { id: string }[]
    const update = this.db.prepare('UPDATE manga_pages SET number = ? WHERE id = ?')
    rows.forEach((row, i) => update.run(i + 1, row.id))
  }

  /** Contiguous 0..n-1 ordering after a panel is deleted. */
  private renumberPanels(pageId: EntityId): void {
    const rows = this.db
      .prepare('SELECT id FROM manga_panels WHERE page_id = ? ORDER BY order_index ASC')
      .all(pageId) as { id: string }[]
    const update = this.db.prepare('UPDATE manga_panels SET order_index = ? WHERE id = ?')
    rows.forEach((row, i) => update.run(i, row.id))
  }
}

