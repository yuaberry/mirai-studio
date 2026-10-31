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
import { copyFileSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { z } from 'zod'
import {
  IMAGE_EXTENSIONS,
  MangaPageInput,
  mirrorX,
  mirrorTail,
  MangaPageRecord,
  MangaPanelInput,
  MangaPanelRecord,
  BubbleInput,
  type BubbleKind,
  type BubbleTail,
} from '@mirai/shared'
import type { Clock } from '../types'
import { writeZipEntries } from '../import/zip'
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
  x: number | null
  y: number | null
  w: number | null
  h: number | null
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
  const coords =
    row.x !== null && row.y !== null && row.w !== null && row.h !== null
      ? { x: row.x, y: row.y, w: row.w, h: row.h }
      : null
  return {
    id: row.id,
    pageId: row.page_id,
    orderIndex: row.order_index,
    shotId: row.shot_id ?? undefined,
    imageAssetId: row.image_asset_id,
    coords,
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

/** Greedy text wrap for SVG bubbles (estimate ~11px per char at size 19). */
function wrapText(text: string, maxChars: number): string[] {
  const limit = Math.max(maxChars, 8)
  const lines: string[] = []
  for (const raw of text.split(/\n/)) {
    const words = raw.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    let line = ''
    for (const word of words) {
      if (line.length === 0) line = word
      else if (line.length + 1 + word.length <= limit) line += ' ' + word
      else {
        lines.push(line)
        line = word
      }
    }
    if (line.length > 0) lines.push(line)
  }
  return lines.length > 0 ? lines : [text]
}

/** Where a bubble tail points, given the tail enum and the bubble box. */
function tailPoint(tail: string, cx: number, cy: number, bw: number, bh: number): [number, number] {
  const dx = bw / 2 + 18
  const dy = bh / 2 + 18
  switch (tail) {
    case 'BOTTOM_LEFT':
      return [cx - dx, cy + dy]
    case 'BOTTOM_CENTER':
      return [cx, cy + dy]
    case 'BOTTOM_RIGHT':
      return [cx + dx, cy + dy]
    case 'TOP_LEFT':
      return [cx - dx, cy - dy]
    case 'TOP_CENTER':
      return [cx, cy - dy]
    case 'TOP_RIGHT':
      return [cx + dx, cy - dy]
    default:
      return [cx, cy + dy]
  }
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
    const c = parsed.coords
    this.db
      .prepare(
        `INSERT INTO manga_panels (id, page_id, order_index, shot_id, image_asset_id, lettering, x, y, w, h, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pageId,
        (maxRow.n ?? -1) + 1,
        parsed.shotId ?? null,
        letteringToJson(parsed.lettering),
        c?.x ?? null,
        c?.y ?? null,
        c?.w ?? null,
        c?.h ?? null,
        now,
        now,
      )
    return this.requirePanel(id)
  }

  updatePanel(id: EntityId, input: z.input<typeof MangaPanelInput>): MangaPanelRecord {
    this.requirePanel(id) // existence + honest NOT_FOUND
    const parsed = parseWith(MangaPanelInput, input, 'manga panel')
    if (parsed.shotId) this.assertShotExists(parsed.shotId)
    const c = parsed.coords
    this.db
      .prepare(
        'UPDATE manga_panels SET shot_id = ?, lettering = ?, x = ?, y = ?, w = ?, h = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        parsed.shotId ?? null,
        letteringToJson(parsed.lettering),
        c?.x ?? null,
        c?.y ?? null,
        c?.w ?? null,
        c?.h ?? null,
        this.clock.isoNow(),
        id,
      )
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
    const { text, bubbleCount } = this.letteringScriptText(episodeId)
    const dir = join(this.projectRoot, 'exports', 'manga')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `S${episode.season}E${episode.number}-lettering.txt`)
    writeFileSync(path, text, 'utf8')
    return { path, pages: this.listPages(episodeId).length, bubbles: bubbleCount }
  }

  /** The lettering script as pure text (used by the export + the chapter package). */
  letteringScriptText(episodeId: EntityId): { text: string; bubbleCount: number } {
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

    return { text: lines.join('\n'), bubbleCount }
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

  // ------------------------------------------------------- page proof (SVG)

  /**
   * Build a self-contained SVG page proof — the compositing the artist
   * and letterer check: panel boxes at their real coordinates, real art
   * embedded base64, lettering bubbles drawn where the data says, tails
   * pointing, SFX styled, placeholders for artless panels. Right-to-left
   * pages are mirrored exactly like the editor shows them.
   */
  pageProofSvg(pageId: EntityId): { svg: string; width: number; height: number } {
    const page = this.requirePage(pageId)
    const panels = this.listPanels(pageId)
    const rtl = page.readingDirection === 'RTL'

    const W = 1200
    const H = 1697 // B5 ratio
    const M = 36 // page margin
    const iw = W - M * 2
    const ih = H - M * 2 - 30 // footer space for the page number

    const AMP = String.fromCharCode(38)
    const esc = (t: string): string =>
      t
        .replace(new RegExp(AMP, 'g'), AMP + 'amp;')
        .replace(/</g, AMP + 'lt;')
        .replace(/>/g, AMP + 'gt;')
        .replace(/"/g, AMP + 'quot;')

    const out: string[] = []
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    )
    out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`)
    out.push(
      `<rect x="${M}" y="${M}" width="${iw}" height="${ih}" fill="none" stroke="#111111" stroke-width="3"/>`,
    )

    // ---- panel boxes (manual coords or auto-stack)
    const boxes = panels.map((panel, i) => {
      if (panel.coords) {
        const x = mirrorX(panel.coords.x, panel.coords.w, rtl)
        return {
          panel,
          n: i + 1,
          x: M + x * iw,
          y: M + panel.coords.y * ih,
          w: Math.max(panel.coords.w * iw, 40),
          h: Math.max(panel.coords.h * ih, 40),
        }
      }
      // auto-stack: equal horizontal slices, full width
      const n = Math.max(panels.length, 1)
      const gap = 8
      const slice = (ih - gap * (n - 1)) / n
      const y = M + i * (slice + gap)
      return { panel, n: i + 1, x: M, y, w: iw, h: slice }
    })

    for (const b of boxes) {
      const { panel, n, x, y, w, h } = b
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f4f4f5" stroke="#111111" stroke-width="3"/>`)

      if (panel.imageAssetId) {
        const asset = this.db
          .prepare('SELECT relative_path, mime FROM assets WHERE id = ?')
          .get(panel.imageAssetId) as { relative_path: string; mime: string } | undefined
        if (asset) {
          try {
            const bytes = readFileSync(join(this.projectRoot, asset.relative_path))
            const b64 = bytes.toString('base64')
            out.push(
              `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="data:${asset.mime};base64,${b64}"/>`,
            )
          } catch {
            out.push(`<text x="${x + 12}" y="${y + h - 14}" font-size="16" fill="#a1a1aa" font-family="sans-serif">panel ${n}: art file missing</text>`)
          }
        }
      } else {
        out.push(
          `<text x="${x + 12}" y="${y + h - 14}" font-size="16" fill="#a1a1aa" font-family="sans-serif">PANEL ${n} — no art</text>`,
        )
      }

      // panel number tag
      out.push(`<rect x="${x}" y="${y}" width="30" height="22" fill="#111111"/>`)
      out.push(
        `<text x="${x + 15}" y="${y + 16}" font-size="14" fill="#ffffff" text-anchor="middle" font-family="sans-serif" font-weight="bold">${n}</text>`,
      )

      // ---- lettering bubbles
      for (const bubble of panel.lettering) {
        const bw = Math.max(bubble.width * w, 70)
        // bubble anchor point, mirrored for right-to-left pages
        const anchorX = mirrorX(bubble.x, 0, rtl)
        const cx = x + anchorX * w
        const cy = y + bubble.y * h
        const font = 'font-family="Georgia, serif"'
        const lines = wrapText(bubble.text, Math.floor((bw - 24) / 11))
        const lineH = 22
        const bh = lines.length * lineH + 20
        const tail = mirrorTail(bubble.tail, rtl)

        if (bubble.kind === 'CAPTION' || bubble.kind === 'NARRATION') {
          out.push(
            `<rect x="${cx - bw / 2}" y="${cy - bh / 2}" width="${bw}" height="${bh}" fill="#ffffff" stroke="#111111" stroke-width="2" rx="4"/>`,
          )
        } else if (bubble.kind === 'SFX') {
          // no container — bold stylized onomatopoeia over the art
          const sfxLines = wrapText(bubble.text.toUpperCase(), Math.floor((bw - 20) / 13))
          sfxLines.forEach((line, li) => {
            out.push(
              `<text x="${cx}" y="${cy + li * 26 - ((sfxLines.length - 1) * 26) / 2}" font-size="26" font-weight="bold" font-style="italic" fill="#111111" text-anchor="middle" stroke="#ffffff" stroke-width="4" paint-order="stroke" ${font}>${esc(line)}</text>`,
            )
          })
          continue
        } else {
          // speech family = ellipse (whisper = dashed, thought = double)
          out.push(
            `<ellipse cx="${cx}" cy="${cy}" rx="${bw / 2}" ry="${bh / 2}" fill="#ffffff" stroke="#111111" stroke-width="2"${bubble.kind === 'WHISPER' ? ' stroke-dasharray="6 4"' : ''}/>`,
          )
          if (bubble.kind === 'THOUGHT') {
            out.push(
              `<ellipse cx="${cx}" cy="${cy}" rx="${bw / 2 - 6}" ry="${bh / 2 - 6}" fill="none" stroke="#111111" stroke-width="1"/>`,
            )
          }
          // tail: small triangle from the bubble edge, direction by enum
          if (tail !== 'NONE') {
            const [tx, ty] = tailPoint(tail, cx, cy, bw, bh)
            out.push(
              `<polygon points="${cx - 10},${cy + (ty > cy ? bh / 2 - 4 : -bh / 2 + 4)} ${cx + 10},${cy + (ty > cy ? bh / 2 - 4 : -bh / 2 + 4)} ${tx},${ty}" fill="#ffffff" stroke="#111111" stroke-width="2"/>`,
            )
          }
        }

        // wrapped text inside the bubble
        const startY = cy - ((lines.length - 1) * lineH) / 2
        lines.forEach((line, li) => {
          const style =
            bubble.kind === 'SHOUT'
              ? ' font-weight="bold"'
              : bubble.kind === 'WHISPER'
                ? ' font-style="italic"'
                : ''
          out.push(
            `<text x="${cx}" y="${startY + li * lineH + 6}" font-size="19"${style} fill="#111111" text-anchor="middle" ${font}>${esc(line)}</text>`,
          )
        })
      }
    }

    out.push(
      `<text x="${W / 2}" y="${H - 18}" font-size="18" fill="#555" text-anchor="middle" font-family="sans-serif">— ${page.number} —</text>`,
    )
    out.push('</svg>')
    return { svg: out.join('\n'), width: W, height: H }
  }

  // ------------------------------------------------------- chapter package

  /**
   * Export the full chapter package: one SVG page proof per page, the
   * professional lettering script and a manifest with real facts —
   * zipped into exports/manga/.
   */
  exportChapterPackage(episodeId: EntityId): { path: string; pages: number; bubbles: number; bytes: number } {
    const episode = this.requireEpisode(episodeId) as EpisodeRow
    const pages = this.listPages(episodeId)

    const scriptText = this.letteringScriptText(episodeId).text
    const entries: Array<{ name: string; data: string }> = []
    let bubbleCount = 0
    let panelCount = 0

    pages.forEach((page) => {
      const panels = this.listPanels(page.id)
      panelCount += panels.length
      for (const panel of panels) bubbleCount += panel.lettering.length
      const proof = this.pageProofSvg(page.id)
      entries.push({ name: `proofs/page-${String(page.number).padStart(2, '0')}.svg`, data: proof.svg })
    })

    const manifest = JSON.stringify(
      {
        generator: 'Mirai Studio — Manga Pro',
        episode: { season: episode.season, number: episode.number, title: episode.title },
        pages: pages.length,
        panels: panelCount,
        bubbles: bubbleCount,
        readingDirection: pages.some((p) => p.readingDirection === 'RTL') ? 'RTL' : 'LTR',
        generatedAt: this.clock.isoNow(),
        contents: { proofs: 'SVG page proofs (open in any browser)', lettering: 'professional lettering script' },
      },
      null,
      2,
    )

    entries.push({ name: 'lettering-script.txt', data: scriptText })
    entries.push({ name: 'manifest.json', data: manifest })

    const zip = writeZipEntries(entries)
    const dir = join(this.projectRoot, 'exports', 'manga')
    mkdirSync(dir, { recursive: true })
    const stamp = this.clock.isoNow().slice(0, 10)
    const path = join(dir, `S${episode.season}E${episode.number}-package-${stamp}.zip`)
    writeFileSync(path, zip)
    return { path, pages: pages.length, bubbles: bubbleCount, bytes: zip.length }
  }

  /** Absolute path of the chapter package (for reveal). */
  chapterPackagePath(episodeId: EntityId): string {
    const episode = this.requireEpisode(episodeId) as EpisodeRow
    return join(
      this.projectRoot,
      'exports',
      'manga',
      `S${episode.season}E${episode.number}-package-${this.clock.isoNow().slice(0, 10)}.zip`,
    )
  }

  // ------------------------------------------------------- proofs (PNG/PDF)

  /**
   * Export page proofs for every page of an episode as PNG and/or PDF.
   * Returns the primary output path (PDF if requested, else first PNG).
   */
  async exportProofs(episodeId: EntityId, format: 'png' | 'pdf' | 'both'): Promise<{ path: string; format: 'png' | 'pdf' | 'both'; pages: number; bytes: number }> {
    const episode = this.requireEpisode(episodeId) as EpisodeRow
    const pages = this.listPages(episodeId)
    if (pages.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', `Episode S${episode.season}E${episode.number} has no pages to prove.`)
    }

    const dir = join(this.projectRoot, 'exports', 'manga', 'proofs')
    mkdirSync(dir, { recursive: true })
    const stamp = this.clock.isoNow().slice(0, 13).replace(/:/g, '-')
    const baseName = `S${episode.season}E${episode.number}-proofs-${stamp}`

    const pngPaths: string[] = []
    let totalBytes = 0

    if (format === 'png' || format === 'both') {
      for (const page of pages) {
        const proof = this.pageProofSvg(page.id)
        const pngPath = join(dir, `${baseName}-page-${String(page.number).padStart(2, '0')}.png`)
        await sharp(Buffer.from(proof.svg, 'utf8')).png().toFile(pngPath)
        pngPaths.push(pngPath)
        totalBytes += statSync(pngPath).size
      }
    }

    let pdfPath = ''
    if (format === 'pdf' || format === 'both') {
      pdfPath = join(dir, `${baseName}.pdf`)
      await this.writeProofsPdf(pdfPath, pages)
      totalBytes += statSync(pdfPath).size
    }

    const primaryPath = format === 'png' ? (pngPaths[0] ?? pdfPath) : pdfPath
    if (!primaryPath) throw new MiraiError('INTERNAL', 'No proof output was produced.')
    return { path: primaryPath, format, pages: pages.length, bytes: totalBytes }
  }

  /**
   * Write a multi-page PDF with one proof page per manga page.
   * Pure manual PDF (no extra dependency): each page embeds the PNG-proof
   * as an image XObject, sized to B5 (1200×1697 @72dpi → 1200×1697 pt).
   */
  private async writeProofsPdf(pdfPath: string, pages: MangaPageRecord[]): Promise<void> {
    const W = 1200
    const H = 1697
    const objects: string[] = []
    let xref = 1

    // ---- catalog (xref 1)
    const catalogId = xref++
    const pagesId = xref++
    const resourcesId = xref++
    const fontId = xref++

    // ---- per-page objects
    const pageObjs: string[] = []
    const contentObjs: string[] = []
    const xobjIds: number[] = []

    for (const page of pages) {
      const proof = this.pageProofSvg(page.id)
      const png = await sharp(Buffer.from(proof.svg, 'utf8')).png().toBuffer()
      const xobjId = xref++
      xobjIds.push(xobjId)

      // image XObject
      objects.push(
        `${xobjId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${png.length} >>\nstream\n`,
      )
      objects.push(png.toString('latin1'))
      objects.push('\nendstream\nendobj\n')

      // content stream: place image filling the page
      const contentId = xref++
      const content = `q ${W} 0 0 ${H} 0 0 cm /Im${xobjId} Do Q`
      contentObjs.push(
        `${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
      )

      // page object
      pageObjs.push(
        `${xref} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /Resources ${resourcesId} 0 R /Contents ${contentId} 0 R /MediaBox [0 0 ${W} ${H}] >>\nendobj\n`,
      )
      xref++
    }

    // ---- resources (font + XObjects)
    const xobjDict = xobjIds.map((id) => `/Im${id} ${id} 0 R`).join(' ')
    objects.splice(
      0,
      0,
      `${resourcesId} 0 obj\n<< /Font << /F1 ${fontId} 0 R >> /XObject << ${xobjDict} >> >>\nendobj\n`,
    )

    // ---- font
    objects.push(
      `${fontId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    )

    // ---- pages tree
    const kids = pageObjs.map((_, i) => {
      // page objects start at xref (after objects that were already pushed)
      return `${xref + i} 0 R`
    }).join(' ')
    // page objects were pushed after the initial objects; recalc their xref numbers
    // (resourcesId, fontId, xobjIds, page ids come before the pages tree)
    objects.push(
      `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`,
    )
    objects.push(
      `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`,
    )

    // ---- build xref
    const offsets: number[] = []
    const pdfParts: Buffer[] = []
    let pos = 0

    // header
    pdfParts.push(Buffer.from('%PDF-1.4\n'))
    pos += pdfParts.at(-1)!.length

    // body: all objects in order
    const ordered: Array<{ id: number; content: string }> = []
    ordered.push({ id: catalogId, content: objects.pop()! }) // catalog
    ordered.push({ id: pagesId, content: objects.pop()! }) // pages
    ordered.push({ id: resourcesId, content: objects.shift()! }) // resources (we unshifted it)
    ordered.push({ id: fontId, content: objects.pop()! }) // font
    for (const id of xobjIds) ordered.push({ id, content: objects.shift()! })
    for (const co of contentObjs) {
      const id = xref - contentObjs.length + contentObjs.indexOf(co)
      ordered.push({ id, content: co })
    }
    // page objects were pushed after everything else; find them
    const pageObjStart = ordered.length
    for (let i = 0; i < pages.length; i++) {
      ordered.push({ id: pageObjStart + 1 + i, content: pageObjs[i]! })
    }
    // sort by id
    ordered.sort((a, b) => a.id - b.id)

    for (const o of ordered) {
      offsets.push(pos)
      const buf = Buffer.from(`${o.id} 0 obj\n${o.content}endobj\n`, 'latin1')
      pdfParts.push(buf)
      pos += buf.length
    }

    const xrefOffset = pos
    pdfParts.push(Buffer.from('xref\n'))
    pos += 5
    pdfParts.push(Buffer.from(`0 ${ordered.length + 1}\n`))
    pos += `0 ${ordered.length + 1}\n`.length
    pdfParts.push(Buffer.from('0000000000 65535 f \n'))
    pos += 21
    for (const off of offsets) {
      pdfParts.push(Buffer.from(`${String(off).padStart(10, '0')} 00000 n \n`))
      pos += 21
    }
    pdfParts.push(
      Buffer.from(
        `trailer\n<< /Size ${ordered.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
        'latin1',
      ),
    )

    writeFileSync(pdfPath, Buffer.concat(pdfParts))
  }

  // ------------------------------------------------------- auto-boarding

  /**
   * Auto-board a chapter from its storyboard shots: create manga pages and
   * link one panel per shot, distributing panels across pages.
   * Returns { pages, panels } created.
   */
  autoBoard(episodeId: EntityId, panelsPerPage = 4): { pages: number; panels: number } {
    this.requireEpisode(episodeId)
    if (panelsPerPage < 1 || panelsPerPage > 12) {
      throw new MiraiError('VALIDATION_ERROR', 'panelsPerPage must be between 1 and 12.')
    }

    // Collect all shots across all scenes of this episode, in scene+shot order.
    const scenes = this.db
      .prepare('SELECT id FROM scenes WHERE episode_id = ? ORDER BY id')
      .all(episodeId) as { id: string }[]

    const shotIds: string[] = []
    for (const scene of scenes) {
      const shots = this.db
        .prepare('SELECT id FROM shots WHERE scene_id = ? ORDER BY id')
        .all(scene.id) as { id: string }[]
      for (const s of shots) shotIds.push(s.id)
    }

    if (shotIds.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', `Episode has no shots — create a storyboard first.`)
    }

    // Delete any existing manga pages for this episode (clean slate).
    const existing = this.listPages(episodeId)
    for (const p of existing) {
      const panels = this.listPanels(p.id)
      for (const panel of panels) {
        if (panel.imageAssetId) this.pruneAssetIfOrphan(panel.imageAssetId)
      }
      this.db.prepare('DELETE FROM manga_pages WHERE id = ?').run(p.id)
    }

    const now = this.clock.isoNow()
    let pageCount = 0
    let panelCount = 0

    const tx = this.db.transaction(() => {
      for (let i = 0; i < shotIds.length; i += panelsPerPage) {
        const pageId = newEntityId()
        const pageNumber = ++pageCount
        this.db
          .prepare(
            `INSERT INTO manga_pages (id, episode_id, number, reading_direction, layout_notes, status, created_at, updated_at)
             VALUES (?, ?, ?, 'RTL', NULL, 'TODO', ?, ?)`,
          )
          .run(pageId, episodeId, pageNumber, now, now)

        const batch = shotIds.slice(i, i + panelsPerPage)
        let order = 0
        for (const shotId of batch) {
          const panelId = newEntityId()
          this.db
            .prepare(
              `INSERT INTO manga_panels (id, page_id, order_index, shot_id, image_asset_id, lettering, x, y, w, h, created_at, updated_at)
               VALUES (?, ?, ?, ?, NULL, '[]', NULL, NULL, NULL, NULL, ?, ?)`,
            )
            .run(panelId, pageId, order++, shotId, now, now)
          panelCount++
        }
      }
    })
    tx()

    return { pages: pageCount, panels: panelCount }
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

