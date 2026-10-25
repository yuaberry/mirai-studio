/**
 * PosterService (v0.28, §7 Visual Dev Lab slice 2) — the project's
 * promotional poster/key visual, generated from LIVING data: title +
 * genres from the manifest, the moodboard palette as the color script
 * (with per-project hue fallback), the author's tagline. Pure SVG —
 * the same dependency-free compositing honesty as the manga proofs.
 */
import type { Database } from 'better-sqlite3'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { PosterState, type MoodboardItem } from '@mirai/shared'
import type { Clock } from '../types'
import { MiraiError } from '@mirai/shared'

const POSTER_KEY = 'poster'

export interface PosterInput {
  title: string
  /** e.g. 'ANIME' → label resolved by the caller. */
  mediumLabel: string
  genres: string[]
  tagline?: string
  /** The moodboard palette (color script); may be empty → hue fallback. */
  palette: string[]
  /** Stable per-project hue for the fallback gradient (id hash). */
  hue: number
}

export interface PosterResult {
  svg: string
  width: number
  height: number
  palette: string[]
  tagline?: string
}

const AMP = String.fromCharCode(38)
const esc = (t: string): string =>
  t
    .replace(new RegExp(AMP, 'g'), AMP + 'amp;')
    .replace(/</g, AMP + 'lt;')
    .replace(/>/g, AMP + 'gt;')
    .replace(/"/g, AMP + 'quot;')

/** Greedy wrap for display type (~13px/char at size 22). */
function wrap(text: string, maxChars: number): string[] {
  const limit = Math.max(maxChars, 8)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line.length === 0) line = word
    else if (line.length + 1 + word.length <= limit) line += ' ' + word
    else {
      lines.push(line)
      line = word
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

/** Two brand hues from the palette (or stable fallbacks from the id hash). */
function resolvePalette(palette: string[], hue: number): [string, string] {
  if (palette.length >= 2) return [palette[0]!, palette[1]!]
  if (palette.length === 1) return [palette[0]!, `hsl(${(hue + 40) % 360}, 72%, 32%)`]
  return [`hsl(${hue}, 72%, 26%)`, `hsl(${(hue + 48) % 360}, 74%, 33%)`]
}

export class PosterService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  // ------------------------------------------------------------------ state

  getState(): z.input<typeof PosterState> {
    const row = this.db
      .prepare('SELECT value FROM kv_store WHERE key = ?')
      .get(POSTER_KEY) as { value: string } | undefined
    if (!row) return {}
    try {
      return PosterState.parse(JSON.parse(row.value))
    } catch {
      return {}
    }
  }

  updateState(state: z.input<typeof PosterState>): z.input<typeof PosterState> {
    const checked = PosterState.safeParse(state)
    if (!checked.success) {
      throw new MiraiError('VALIDATION_ERROR', 'Invalid poster state.', {
        details: checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const now = this.clock.isoNow()
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)',
        )
        .run(POSTER_KEY, JSON.stringify(checked.data), now)
    })
    tx()
    return checked.data
  }

  // ------------------------------------------------------------------ build

  /** Pure SVG poster (1200×1800, 2:3) from the living project facts. */
  buildPoster(input: PosterInput): PosterResult {
    const W = 1200
    const H = 1800
    const [c1, c2] = resolvePalette(input.palette, input.hue)
    const out: string[] = []

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)

    // ---- background: the color script as a cinematic gradient
    out.push(
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(c1)}"/><stop offset="1" stop-color="${esc(c2)}"/></linearGradient></defs>`,
    )
    out.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`)

    // film grain grid + glow orbs
    out.push(
      `<g stroke="rgba(255,255,255,0.06)" stroke-width="1">${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="${H}"/>`).join('')}${Array.from({ length: 36 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="${W}" y2="${i * 50}"/>`).join('')}</g>`,
    )
    out.push(`<circle cx="${W * 0.82}" cy="${H * 0.18}" r="260" fill="rgba(255,255,255,0.07)"/>`)
    out.push(`<circle cx="${W * 0.15}" cy="${H * 0.85}" r="320" fill="rgba(0,0,0,0.16)"/>`)

    // ---- drifting petals, static (poster is a still)
    const petals = [
      { x: 180, y: 420, s: 26, r: 0.3 },
      { x: 980, y: 300, s: 18, r: -0.5 },
      { x: 760, y: 700, s: 22, r: 0.9 },
      { x: 260, y: 1100, s: 16, r: -0.2 },
      { x: 900, y: 1350, s: 24, r: 0.5 },
      { x: 120, y: 1500, s: 20, r: 1.2 },
      { x: 620, y: 180, s: 14, r: -1.0 },
    ]
    for (const p of petals) {
      out.push(
        `<g transform="translate(${p.x} ${p.y}) rotate(${p.r})"><path d="M0 ${-p.s} C ${p.s * 0.9} ${-p.s * 0.4}, ${p.s * 0.7} ${p.s * 0.6}, 0 ${p.s} C ${-p.s * 0.7} ${p.s * 0.6}, ${-p.s * 0.9} ${-p.s * 0.4}, 0 ${-p.s}" fill="rgba(255,255,255,0.13)"/></g>`,
      )
    }

    // ---- medium eyebrow
    out.push(
      `<text x="100" y="360" font-family="'Space Grotesk', Georgia, serif" font-size="30" font-weight="700" letter-spacing="14" fill="rgba(255,255,255,0.85)">${esc(input.mediumLabel.toUpperCase())}</text>`,
    )

    // ---- title, wrapped big
    const titleLines = wrap(input.title, 16)
    const titleTop = 520
    titleLines.slice(0, 4).forEach((line, i) => {
      out.push(
        `<text x="100" y="${titleTop + i * 118}" font-family="'Space Grotesk', Georgia, serif" font-size="96" font-weight="700" fill="#ffffff">${esc(line)}</text>`,
      )
    })

    // ---- tagline
    const taglineY = titleTop + Math.min(titleLines.length, 4) * 118 + 60
    if (input.tagline && input.tagline.trim().length > 0) {
      const tagLines = wrap(input.tagline, 34).slice(0, 3)
      tagLines.forEach((line, i) => {
        out.push(
          `<text x="100" y="${taglineY + i * 54}" font-family="Georgia, serif" font-size="38" font-style="italic" fill="rgba(255,255,255,0.92)">${esc(line)}</text>`,
        )
      })
    }

    // ---- genre chips at the bottom
    const chips = input.genres.slice(0, 4)
    let chipX = 100
    const chipY = H - 220
    for (const chip of chips) {
      const w = Math.max(chip.length * 20 + 44, 110)
      out.push(
        `<rect x="${chipX}" y="${chipY}" width="${w}" height="52" rx="26" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>`,
      )
      out.push(
        `<text x="${chipX + w / 2}" y="${chipY + 34}" font-family="'Inter', sans-serif" font-size="24" font-weight="600" fill="#ffffff" text-anchor="middle">${esc(chip)}</text>`,
      )
      chipX += w + 18
    }

    // ---- the color script strip (proof the palette is real)
    const stripY = H - 130
    const swatches: string[] = input.palette.length > 0 ? input.palette : [c1, c2]
    const sw = Math.min(1200 / swatches.length, 220)
    swatches.forEach((color, i) => {
      out.push(
        `<rect x="100" y="${stripY}" width="${sw - 10}" height="26" rx="6" fill="${esc(color)}" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" transform="translate(${i * sw} 0)"/>`,
      )
    })

    // ---- studio mark
    out.push(
      `<text x="100" y="${H - 60}" font-family="'Inter', sans-serif" font-size="24" font-weight="700" letter-spacing="8" fill="rgba(255,255,255,0.7)">MIRAI STUDIO</text>`,
    )

    out.push('</svg>')
    return {
      svg: out.join('\n'),
      width: W,
      height: H,
      palette: swatches,
      tagline: input.tagline,
    }
  }

  // ----------------------------------------------------------------- export

  /** Write the poster SVG into exports/poster/ and return the real path. */
  exportPoster(input: PosterInput): { path: string; bytes: number; width: number; height: number } {
    const poster = this.buildPoster(input)
    const dir = join(this.projectRoot, 'exports', 'poster')
    mkdirSync(dir, { recursive: true })
    const safe = input.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'poster'
    const stamp = this.clock.isoNow().slice(0, 10)
    const path = join(dir, `${safe}-poster-${stamp}.svg`)
    writeFileSync(path, poster.svg, 'utf8')
    return { path, bytes: Buffer.byteLength(poster.svg, 'utf8'), width: poster.width, height: poster.height }
  }

  /** Absolute path of the exported poster (for reveal). */
  posterPath(title: string): string {
    const safe = title.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'poster'
    return join(this.projectRoot, 'exports', 'poster', `${safe}-poster-${this.clock.isoNow().slice(0, 10)}.svg`)
  }

  /** The moodboard palette as the poster's color script source. */
  moodboardPalette(moodboard: { list(): MoodboardItem[] }): string[] {
    return moodboard.list().map((i) => i.color).filter((c): c is string => c !== null)
  }
}
