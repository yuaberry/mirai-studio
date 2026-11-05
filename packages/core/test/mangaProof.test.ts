/**
 * v0.25 — Manga Pro slice 2: manual panel layout (page-relative coords),
 * the SVG page proof (real compositing: art embedded base64, bubbles
 * drawn from data, tails mirrored for RTL) and the chapter package zip.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { MangaService } from '../src/creative/mangaService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { readZipEntries } from '../src/import/zip'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v25-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const manga = new MangaService(db, clock, dir)
  const episode = creative.createEpisode({ season: 2, number: 1, title: 'The Proof' })
  return { dir, db, clock, creative, storyboard, manga, episode }
}

/** Minimal 1x1 PNG. */
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
)

describe('panel layout coords (§8 slice 2)', () => {
  it('stores manual page-relative boxes and keeps auto-stack as null', () => {
    const env = makeEnv('coords')
    const page = env.manga.createPage(env.episode.id, {})
    const auto = env.manga.createPanel(page.id, {})
    const manual = env.manga.createPanel(page.id, { coords: { x: 0.1, y: 0.05, w: 0.8, h: 0.4 } })

    expect(auto.coords).toBeNull()
    expect(manual.coords).toEqual({ x: 0.1, y: 0.05, w: 0.8, h: 0.4 })

    // updating through the REAL path (lettering preserved by the caller)
    const updated = env.manga.updatePanel(auto.id, { coords: { x: 0.25, y: 0.55, w: 0.5, h: 0.35 } })
    expect(updated.coords).toEqual({ x: 0.25, y: 0.55, w: 0.5, h: 0.35 })

    // clearing back to auto: coords omitted → null again
    const cleared = env.manga.updatePanel(auto.id, {})
    expect(cleared.coords).toBeNull()
    expect(() => env.manga.createPanel(page.id, { coords: { x: 2, y: 0, w: 0.5, h: 0.5 } })).toThrow(MiraiError)
  })
})

describe('SVG page proof (compositing)', () => {
  it('embeds real art base64, draws bubbles with wrapped text, tails and placeholders', () => {
    const env = makeEnv('proof')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka & Rin', role: 'PROTAGONIST' })
    const page = env.manga.createPage(env.episode.id, {})

    const artPanel = env.manga.createPanel(page.id, { coords: { x: 0.05, y: 0.04, w: 0.9, h: 0.5 } })
    const imgPath = join(env.dir, 'panel-art.png')
    writeFileSync(imgPath, TINY_PNG)
    env.manga.attachPanelImage(artPanel.id, imgPath)
    env.manga.updatePanel(artPanel.id, {
      coords: { x: 0.05, y: 0.04, w: 0.9, h: 0.5 },
      lettering: [
        { kind: 'SPEECH', characterId: ayaka.id, text: 'You saw that too, right? The lantern moved on its own!', tail: 'BOTTOM_RIGHT' },
        { kind: 'SFX', text: 'DOON!' },
      ],
    })

    const emptyPanel = env.manga.createPanel(page.id, { coords: { x: 0.05, y: 0.58, w: 0.9, h: 0.35 } })

    const { svg, width, height } = env.manga.pageProofSvg(page.id)
    expect(width).toBe(1200)
    expect(height).toBe(1697)
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')

    // real art embedded as base64 data URI
    expect(svg).toContain('data:image/png;base64,')

    // speech bubble drawn + text wrapped (long line split into multiple <text>)
    expect(svg).toContain('<ellipse')
    expect(svg).toContain('You saw that too, right? The')
    expect(svg).toContain('lantern moved on its own!')

    // SFX styled with paint-order stroke
    expect(svg).toContain('DOON!')
    expect(svg).toContain('paint-order="stroke"')

    // artless panel gets an honest placeholder
    expect(svg).toContain('PANEL 2 — no art')

    // tail polygon pointing (BOTTOM_RIGHT → tail drawn)
    expect(svg).toContain('<polygon')

    // page number footer
    expect(svg).toContain('— 1 —')
    expect(emptyPanel.orderIndex).toBe(1)
  })

  it('mirrors panels and tails for RTL pages (editor = proof)', () => {
    const env = makeEnv('rtl')
    const page = env.manga.createPage(env.episode.id, { readingDirection: 'RTL' })
    env.manga.createPanel(page.id, {
      coords: { x: 0.02, y: 0.05, w: 0.45, h: 0.4 }, // LEFT side in layout space
      lettering: [{ kind: 'SPEECH', text: 'Oi', x: 0.5, y: 0.5, width: 0.4, tail: 'BOTTOM_LEFT' }],
    })
    const { svg } = env.manga.pageProofSvg(page.id)

    // mirrored x: 1 - 0.02 - 0.45 = 0.53 → x = 36 + 0.53*1128 = 633.84
    expect(svg).toContain('x="633.84') // panel box mirrored to the right half
    // the tail flipped BOTTOM_LEFT → BOTTOM_RIGHT: polygon tip is on the RIGHT of the bubble center
    const points = /<polygon points="([^"]+)"/.exec(svg)?.[1] ?? ''
    const [tipX, tipY] = points.split(' ')[2]!.split(',').map(Number)
    const ellipse = /<ellipse cx="([0-9.]+)" cy="([0-9.]+)"/.exec(svg)
    expect(tipX).toBeGreaterThan(Number(ellipse![1])) // tail points RIGHT (mirrored)
    expect(tipY).toBeGreaterThan(Number(ellipse![2])) // tail points DOWN from the bubble
  })

  it('auto-stacks panels without coords (full-width slices)', () => {
    const env = makeEnv('auto')
    const page = env.manga.createPage(env.episode.id, {})
    env.manga.createPanel(page.id, {})
    env.manga.createPanel(page.id, {})
    const { svg } = env.manga.pageProofSvg(page.id)
    // two full-width PANEL rects (gray fill distinguishes them from the page border)
    expect((svg.match(/fill="#f4f4f5" stroke="#111111" stroke-width="3"/g) ?? []).length).toBe(2)
    expect(svg).toContain('width="1128"')
  })
})

describe('chapter package (zip)', () => {
  it('bundles proofs + lettering script + manifest with real facts', () => {
    const env = makeEnv('package')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const page1 = env.manga.createPage(env.episode.id, {})
    env.manga.createPanel(page1.id, {
      lettering: [
        { kind: 'SPEECH', characterId: ayaka.id, text: 'Primeira fala.' },
        { kind: 'SFX', text: 'TOON!' },
      ],
    })
    env.manga.createPanel(page1.id, {})
    env.manga.createPage(env.episode.id, { readingDirection: 'LTR' })

    const result = env.manga.exportChapterPackage(env.episode.id)
    expect(result.pages).toBe(2)
    expect(result.bubbles).toBe(2)
    expect(existsSync(result.path)).toBe(true)
    expect(statSync(result.path).size).toBe(result.bytes)
    expect(result.path).toContain('S2E1-package-')

    const entries = readZipEntries(readFileSync(result.path))
    const byName = new Map(entries.map((e) => [e.name, e.data.toString('utf8')]))
    expect(byName.has('proofs/page-01.svg')).toBe(true)
    expect(byName.has('proofs/page-02.svg')).toBe(true)
    expect(byName.get('proofs/page-01.svg')!).toContain('<svg')

    const script = byName.get('lettering-script.txt')!
    expect(script).toContain('S2E1 — "The Proof"')
    expect(script).toContain('Ayaka (speech): "Primeira fala."')

    const manifest = JSON.parse(byName.get('manifest.json')!) as {
      pages: number
      panels: number
      bubbles: number
      readingDirection: string
      episode: { season: number; number: number; title: string }
    }
    expect(manifest.pages).toBe(2)
    expect(manifest.panels).toBe(2) // page 1 has two panels, page 2 none
    expect(manifest.bubbles).toBe(2)
    expect(manifest.readingDirection).toBe('RTL') // page 1 is RTL
    expect(manifest.episode.title).toBe('The Proof')
  })

  it('exports an honest empty package for a chapter with no pages', () => {
    const env = makeEnv('package-empty')
    const episode2 = env.creative.createEpisode({ season: 2, number: 9, title: 'Empty' })
    const result = env.manga.exportChapterPackage(episode2.id)
    expect(result.pages).toBe(0)
    expect(result.bubbles).toBe(0)
    const byName = new Map(readZipEntries(readFileSync(result.path)).map((e) => [e.name, e.data.toString('utf8')]))
    const manifest = JSON.parse(byName.get('manifest.json')!) as { pages: number }
    expect(manifest.pages).toBe(0)
  })
})
