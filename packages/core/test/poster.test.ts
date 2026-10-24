/**
 * v0.28 — Visual Dev Lab slice 2 (§7): the Poster Studio — the key
 * visual composed from LIVING data (title/genres, the moodboard palette
 * as the color script, the author's tagline), state persisted in kv,
 * SVG export, and the AI tagline schema enforced at the boundary.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError, TaglineDraft, PosterState } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { MoodboardService } from '../src/visual/moodboardService'
import { PosterService } from '../src/visual/posterService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v28-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const moodboard = new MoodboardService(db, clock, dir)
  const poster = new PosterService(db, clock, dir)
  return { dir, db, clock, creative, moodboard, poster }
}

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
)

const AMP = String.fromCharCode(38)

describe('poster state (kv)', () => {
  it('starts empty, round-trips tagline + palette override, rejects invalid', () => {
    const env = makeEnv('state')
    expect(env.poster.getState()).toEqual({})

    const saved = env.poster.updateState({ tagline: 'A lua responde em silêncio.' })
    expect(saved.tagline).toBe('A lua responde em silêncio.')
    expect(env.poster.getState().tagline).toBe('A lua responde em silêncio.')

    const withPalette = env.poster.updateState({ tagline: 't', paletteOverride: ['#f472b6', '#22d3ee'] })
    expect(withPalette.paletteOverride).toEqual(['#f472b6', '#22d3ee'])

    expect(() => env.poster.updateState({ paletteOverride: ['pink'] })).toThrow(MiraiError)
    expect(() => env.poster.updateState({ tagline: 'x'.repeat(301) })).toThrow(MiraiError)

    // clearing: omitted fields go away
    expect(env.poster.updateState({}).tagline).toBeUndefined()
  })
})

describe('poster composition', () => {
  it('composes from living data: title, genres, tagline, palette chips + strip', () => {
    const env = makeEnv('compose')
    const result = env.poster.buildPoster({
      title: 'Sakura Chronicles',
      mediumLabel: 'Anime',
      genres: ['Yuri', 'Isekai', 'Fantasia'],
      tagline: 'Onde as cartas escolhem as guardiãs.',
      palette: ['#f472b6', '#22d3ee', '#a78bfa'],
      hue: 210,
    })

    expect(result.width).toBe(1200)
    expect(result.height).toBe(1800)
    expect(result.palette).toEqual(['#f472b6', '#22d3ee', '#a78bfa'])
    const svg = result.svg
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('ANIME</text>') // medium eyebrow (uppercased)
    expect(svg).toContain('Sakura')
    expect(svg).toContain('Chronicles')
    // the tagline WRAPS at 34 chars — assert its real lines
    expect(svg).toContain('Onde as cartas escolhem as')
    expect(svg).toContain('guardiãs.')
    expect(svg).toContain('Yuri')
    expect(svg).toContain('Isekai')
    expect(svg).toContain('MIRAI STUDIO')
    // the color script strip carries the real palette
    expect(svg).toContain('fill="#f472b6"')
    expect(svg).toContain('fill="#22d3ee"')
    // petals present (the brand motif)
    expect(svg).toMatch(/<g transform="translate\(\d+ \d+\) rotate/)
    // well-formed: closes the root
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('falls back to a stable per-project hue when the board has no palette', () => {
    const env = makeEnv('fallback')
    const a = env.poster.buildPoster({ title: 'Hollow', mediumLabel: 'Manga', genres: [], palette: [], hue: 120 })
    expect(a.palette).toEqual(['hsl(120, 72%, 26%)', 'hsl(168, 74%, 33%)'])
    expect(a.svg).toContain('stop-color="hsl(120, 72%, 26%)"')

    // single-swatch boards: the strip shows the REAL palette (one swatch —
    // honest), while the fallback hue completes the BACKGROUND gradient
    const b = env.poster.buildPoster({ title: 'One', mediumLabel: 'Anime', genres: [], palette: ['#123456'], hue: 10 })
    expect(b.palette).toEqual(['#123456'])
    expect(b.svg).toContain('stop-color="#123456"')
    expect(b.svg).toContain('stop-color="hsl(50, 72%, 32%)"')
  })

  it('escapes XML-hostile titles and taglines', () => {
    const env = makeEnv('escape')
    const result = env.poster.buildPoster({
      title: 'Yuna & Rin <Final> "Requiem"',
      mediumLabel: 'Anime',
      genres: ['Drama'],
      tagline: 'love & loss > fear',
      palette: [],
      hue: 5,
    })
    const svg = result.svg
    // the title wraps at 16 chars — the escaped lines, in order
    expect(svg).toContain(`Yuna ${AMP}amp; Rin`)
    expect(svg).toContain(`${AMP}lt;Final${AMP}gt;`)
    expect(svg).toContain(`${AMP}quot;Requiem${AMP}quot;`)
    expect(svg).toContain(`love ${AMP}amp; loss ${AMP}gt; fear`)
    // raw specials must never leak into text runs
    expect(svg).not.toContain('Yuna & Rin <Final>')
  })

  it('wraps long titles into display lines', () => {
    const env = makeEnv('wrap')
    const result = env.poster.buildPoster({
      title: 'The Extremely Long Title Of A Very Ambitious Anime Project',
      mediumLabel: 'Anime',
      genres: [],
      palette: [],
      hue: 5,
    })
    const textCount = (result.svg.match(/font-size="96"/g) ?? []).length
    expect(textCount).toBeGreaterThan(1) // wrapped into multiple lines
    expect(textCount).toBeLessThanOrEqual(4) // honest cap
  })

  it('moodboardPalette reads the real board', () => {
    const env = makeEnv('palette-source')
    const png = join(env.dir, 'ref.png')
    writeFileSync(png, TINY_PNG)
    const a = env.moodboard.attachImage(png)
    env.moodboard.update(a.id, { color: '#f472b6' })
    expect(env.poster.moodboardPalette(env.moodboard)).toEqual(['#f472b6'])
  })

  it('exports a real SVG file into exports/poster/', () => {
    const env = makeEnv('export')
    const result = env.poster.exportPoster({
      title: 'Sakura Chronicles',
      mediumLabel: 'Anime',
      genres: ['Yuri'],
      tagline: 't',
      palette: ['#f472b6'],
      hue: 5,
    })
    expect(existsSync(result.path)).toBe(true)
    expect(result.path).toContain(join('exports', 'poster'))
    expect(result.path).toMatch(/-poster-\d{4}-\d{2}-\d{2}\.svg$/)
    expect(statSync(result.path).size).toBe(result.bytes)
  })
})

describe('AI tagline schema (boundary)', () => {
  it('accepts exactly 3 candidates and rejects anything else', () => {
    expect(TaglineDraft.parse({ taglines: ['a', 'b', 'c'] })).toEqual({ taglines: ['a', 'b', 'c'] })
    expect(TaglineDraft.safeParse({ taglines: ['a', 'b'] }).success).toBe(false)
    expect(TaglineDraft.safeParse({ taglines: ['a', 'b', 'c', 'd'] }).success).toBe(false)
    expect(TaglineDraft.safeParse({ taglines: ['a', '', 'c'] }).success).toBe(false)
    expect(TaglineDraft.safeParse({}).success).toBe(false)
  })

  it('PosterState accepts the documented shapes only', () => {
    expect(PosterState.safeParse({}).success).toBe(true)
    expect(PosterState.safeParse({ tagline: 'x' }).success).toBe(true)
    expect(PosterState.safeParse({ tagline: 42 }).success).toBe(false)
  })
})
