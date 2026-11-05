/**
 * v0.22 — Manga Pro slice 1 (§8): pages, panels, lettering as data and the
 * professional lettering script export. All REAL round-trips against a
 * migrated project DB, including image attach/prune with real files.
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
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v22-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const manga = new MangaService(db, clock, dir)
  const episode = creative.createEpisode({ season: 1, number: 3, title: 'The Xylophone Shrine' })
  return { dir, db, clock, creative, storyboard, manga, episode }
}

/** Minimal 1x1 PNG (real file on disk) for image attach tests. */
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
)

describe('manga pages (§8 slice 1)', () => {
  it('auto-numbers pages 1..n and renumbers after delete', () => {
    const env = makeEnv('pages')
    const p1 = env.manga.createPage(env.episode.id, { readingDirection: 'RTL' })
    const p2 = env.manga.createPage(env.episode.id, {})
    const p3 = env.manga.createPage(env.episode.id, { readingDirection: 'LTR' })
    expect([p1.number, p2.number, p3.number]).toEqual([1, 2, 3])

    env.manga.deletePage(p2.id)
    const pages = env.manga.listPages(env.episode.id)
    expect(pages.map((p) => p.number)).toEqual([1, 2])
    expect(pages[0]!.id).toBe(p1.id)
    expect(pages[1]!.id).toBe(p3.id)
    expect(pages[1]!.readingDirection).toBe('LTR')
  })

  it('swaps page order with move (UNIQUE-safe) and guards the edges', () => {
    const env = makeEnv('move')
    const p1 = env.manga.createPage(env.episode.id, {})
    const p2 = env.manga.createPage(env.episode.id, {})
    const p3 = env.manga.createPage(env.episode.id, {})
    env.manga.movePage(p3.id, 'up')
    expect(env.manga.listPages(env.episode.id).map((p) => p.id)).toEqual([p1.id, p3.id, p2.id])
    expect(() => env.manga.movePage(p1.id, 'up')).toThrow(MiraiError)
    // p3 is now number 2 (the middle) — move it down
    env.manga.movePage(p3.id, 'down')
    expect(env.manga.listPages(env.episode.id).map((p) => p.id)).toEqual([p1.id, p2.id, p3.id])
  })

  it('cascades pages and panels when the episode dies', () => {
    const env = makeEnv('cascade')
    const page = env.manga.createPage(env.episode.id, {})
    env.manga.createPanel(page.id, { lettering: [] })
    env.creative.deleteEpisode(env.episode.id)
    // the episode is gone, so listing its pages is NOT_FOUND…
    expect(() => env.manga.listPages(env.episode.id)).toThrow(MiraiError)
    // …and the rows really cascaded away.
    const rows = env.db.prepare('SELECT COUNT(*) AS n FROM manga_pages').get() as { n: number }
    const panelRows = env.db.prepare('SELECT COUNT(*) AS n FROM manga_panels').get() as { n: number }
    expect(rows.n).toBe(0)
    expect(panelRows.n).toBe(0)
  })

  it('updates page direction + notes and rejects unknown data', () => {
    const env = makeEnv('update')
    const page = env.manga.createPage(env.episode.id, {})
    const updated = env.manga.updatePage(page.id, { readingDirection: 'LTR', layoutNotes: 'double spread' })
    expect(updated.readingDirection).toBe('LTR')
    expect(updated.layoutNotes).toBe('double spread')
    expect(() => env.manga.updatePage(page.id, { readingDirection: 'SIDEWAYS' as never })).toThrow(MiraiError)
  })
})

describe('manga panels + lettering (text as data)', () => {
  it('creates panels with typed lettering, round-trips and validates', () => {
    const env = makeEnv('panels')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const page = env.manga.createPage(env.episode.id, {})

    const panel = env.manga.createPanel(page.id, {
      lettering: [
        { kind: 'SPEECH', characterId: ayaka.id, text: 'You saw that too, right?', x: 0.3, y: 0.2, tail: 'BOTTOM_RIGHT' },
        { kind: 'SFX', text: 'DOON!' },
      ],
    })
    expect(panel.orderIndex).toBe(0)
    expect(panel.lettering).toHaveLength(2)
    // reading order is stable
    expect(panel.lettering[0]!.text).toBe('You saw that too, right?')
    expect(panel.lettering[1]!.kind).toBe('SFX')
    expect(panel.lettering[0]!.id).toMatch(/^[0-9A-Z]{26}$/)

    // update replaces the lettering wholesale (the UI edits a list)
    const second = env.manga.updatePanel(panel.id, {
      lettering: [{ kind: 'CAPTION', text: 'Meanwhile, at the shrine…', x: 0.5, y: 0.05 }],
    })
    expect(second.lettering).toHaveLength(1)
    expect(second.lettering[0]!.kind).toBe('CAPTION')

    // invalid kind is rejected (zod at the boundary)
    expect(() =>
      env.manga.createPanel(page.id, { lettering: [{ kind: 'INTERCOM' as never, text: 'nope' }] }),
    ).toThrow(MiraiError)
  })

  it('orders panels, moves them and renumbers after delete', () => {
    const env = makeEnv('panel-order')
    const page = env.manga.createPage(env.episode.id, {})
    const a = env.manga.createPanel(page.id, {})
    const b = env.manga.createPanel(page.id, {})
    const c = env.manga.createPanel(page.id, {})
    expect([a.orderIndex, b.orderIndex, c.orderIndex]).toEqual([0, 1, 2])

    env.manga.movePanel(a.id, 'down')
    let panels = env.manga.listPanels(page.id)
    expect(panels.map((p) => p.id)).toEqual([b.id, a.id, c.id])
    env.manga.movePanel(a.id, 'up') // back to the original order
    expect(env.manga.listPanels(page.id).map((p) => p.id)).toEqual([a.id, b.id, c.id])
    expect(() => env.manga.movePanel(a.id, 'up')).toThrow(MiraiError) // edge

    env.manga.deletePanel(b.id)
    panels = env.manga.listPanels(page.id)
    expect(panels.map((p) => p.orderIndex)).toEqual([0, 1])
  })

  it('links a panel to a real shot and rejects dead shot ids', () => {
    const env = makeEnv('shot-link')
    const scene = env.creative.createScene(env.episode.id, { title: 'Shrine steps' })
    const shot = env.storyboard.createShot(scene.id, { title: 'Wide of the steps', durationSeconds: 4 })
    const page = env.manga.createPage(env.episode.id, {})
    const panel = env.manga.createPanel(page.id, { shotId: shot.id, lettering: [] })
    expect(panel.shotId).toBe(shot.id)
    expect(() => env.manga.updatePanel(panel.id, { shotId: '01ABCDEFGHJKLMNPQRSTVWXYZ0', lettering: [] })).toThrow(MiraiError)
  })
})

describe('manga panel art (real files)', () => {
  it('attaches art, re-attaches pruning the orphan, and prune respects shots', () => {
    const env = makeEnv('art')
    const page = env.manga.createPage(env.episode.id, {})
    const panel = env.manga.createPanel(page.id, {})
    const imgPath = join(env.dir, 'art.png')
    writeFileSync(imgPath, TINY_PNG)

    const withArt = env.manga.attachPanelImage(panel.id, imgPath)
    const firstAssetId = withArt.imageAssetId
    expect(firstAssetId).toBeTruthy()
    expect(existsSync(join(env.dir, 'images', 'assets', `${firstAssetId}.png`))).toBe(true)

    // re-attach: the old file is pruned (no other reference)
    const reArt = env.manga.attachPanelImage(panel.id, imgPath)
    expect(reArt.imageAssetId).not.toBe(firstAssetId)
    expect(existsSync(join(env.dir, 'images', 'assets', `${firstAssetId}.png`))).toBe(false)

    // panel art and shot frames live as SEPARATE assets: deleting the panel
    // prunes its own asset and never touches the storyboard's files.
    const scene = env.creative.createScene(env.episode.id, { title: 'Panel source' })
    const shot = env.storyboard.createShot(scene.id, { title: 'Ref', durationSeconds: 2 })
    const shotAsset = env.storyboard.importFrame(shot.id, imgPath)
    const artPanel = env.manga.createPanel(page.id, {})
    env.manga.attachPanelImage(artPanel.id, imgPath)
    const artId = env.manga.listPanels(page.id).find((p) => p.id === artPanel.id)!.imageAssetId!
    expect(artId).not.toBe(shotAsset.id) // separate asset per attach — no hidden sharing
    env.manga.deletePanel(artPanel.id)
    expect(existsSync(join(env.dir, 'images', 'assets', `${artId}.png`))).toBe(false)
    expect(existsSync(join(env.dir, 'images', 'assets', `${shotAsset.id}.png`))).toBe(true)
  })

  it('rejects non-image files and missing paths', () => {
    const env = makeEnv('art-invalid')
    const page = env.manga.createPage(env.episode.id, {})
    const panel = env.manga.createPanel(page.id, {})
    const txt = join(env.dir, 'not-an-image.txt')
    writeFileSync(txt, 'hello')
    expect(() => env.manga.attachPanelImage(panel.id, txt)).toThrow(MiraiError)
    expect(() => env.manga.attachPanelImage(panel.id, join(env.dir, 'ghost.png'))).toThrow(MiraiError)
  })
})

describe('lettering script export (professional deliverable)', () => {
  it('writes the real script with pages, panels, attribution and direction', () => {
    const env = makeEnv('export')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const page1 = env.manga.createPage(env.episode.id, { readingDirection: 'RTL', layoutNotes: 'bleed both edges' })
    const page2 = env.manga.createPage(env.episode.id, {})

    const p1 = env.manga.createPanel(page1.id, {
      lettering: [
        { kind: 'SPEECH', characterId: ayaka.id, text: 'You saw that too, right?' },
        { kind: 'SFX', text: 'DOON!' },
      ],
    })
    env.manga.createPanel(page1.id, { lettering: [{ kind: 'CAPTION', text: 'Meanwhile…' }] })
    env.manga.createPanel(page2.id, { lettering: [{ kind: 'THOUGHT', characterId: ayaka.id, text: 'The xylophone answered.' }] })

    const result = env.manga.exportLetteringScript(env.episode.id)
    expect(result.pages).toBe(2)
    expect(result.bubbles).toBe(4)
    expect(statSync(result.path).size).toBeGreaterThan(100)

    const text = readFileSync(result.path, 'utf8')
    expect(text).toContain('MIRAI STUDIO — LETTERING SCRIPT')
    expect(text).toContain('S1E3 — "The Xylophone Shrine"')
    expect(text).toContain('RIGHT-TO-LEFT (manga standard)')
    expect(text).toContain('PAGE 1 (right-to-left)')
    expect(text).toContain('Layout notes: bleed both edges')
    expect(text).toContain('PANEL 1')
    expect(text).toContain('Ayaka (speech): "You saw that too, right?"')
    expect(text).toContain('SFX: "DOON!"')
    expect(text).toContain('PAGE 2')
    // per-page panel numbering (the lettering standard) + the page-2 line
    expect(text).toContain('PAGE 2 (right-to-left)')
    expect(text).toContain('Ayaka (thought): "The xylophone answered."')

    // deterministic path + reveal helper agree
    expect(env.manga.letteringScriptPath(env.episode.id)).toBe(result.path)

    // deleting the panel does not invalidate the exported file
    env.manga.deletePanel(p1.id)
    expect(existsSync(result.path)).toBe(true)
  })

  it('exports an honest empty script when no pages exist', () => {
    const env = makeEnv('export-empty')
    const result = env.manga.exportLetteringScript(env.episode.id)
    expect(result.pages).toBe(0)
    expect(result.bubbles).toBe(0)
    expect(readFileSync(result.path, 'utf8')).toContain('LEFT-TO-RIGHT')
  })
})
