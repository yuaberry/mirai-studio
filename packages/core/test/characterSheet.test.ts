/**
 * v0.31 — AI-anime quality loop: the character REFERENCE SHEET (real
 * assets, honest 4-consumer prune) — the multi-speaker voice and the
 * AI sheet generation are exercised through the smoke (real host).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { MoodboardService } from '../src/visual/moodboardService'
import { CharacterSheetService } from '../src/visual/characterSheetService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v31-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const moodboard = new MoodboardService(db, clock, dir)
  const sheets = new CharacterSheetService(db, clock, dir)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'P' })
  return { dir, db, clock, creative, storyboard, moodboard, sheets, episode }
}

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
)

describe('character reference sheet (v0.31)', () => {
  it('imports real files, exposes the id on the character, replaces + prunes the previous', () => {
    const env = makeEnv('attach')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })

    const png = join(env.dir, 'sheet.png')
    writeFileSync(png, TINY_PNG)
    const first = env.sheets.attachFile(ayaka.id, png)
    expect(env.creative.getCharacter(ayaka.id).referenceAssetId).toBe(first.id)
    expect(existsSync(join(env.dir, 'images', 'characters', `${first.id}.png`))).toBe(true)

    // replace prunes the previous (nothing else referenced it)
    const second = env.sheets.registerSheet(ayaka.id, TINY_PNG, 'image/png', 'ai-sheet')
    expect(env.creative.getCharacter(ayaka.id).referenceAssetId).toBe(second.id)
    expect(existsSync(join(env.dir, 'images', 'characters', `${first.id}.png`))).toBe(false)

    // clear detaches + prunes
    env.sheets.clearSheet(ayaka.id)
    expect(env.creative.getCharacter(ayaka.id).referenceAssetId).toBeNull()
    expect(existsSync(join(env.dir, 'images', 'characters', `${second.id}.png`))).toBe(false)
  })

  it('NEVER prunes a sheet asset that other consumers reference (shots/moodboard/characters)', () => {
    const env = makeEnv('prune-shared')
    const scene = env.creative.createScene(env.episode.id, { title: 'S' })
    const shot = env.storyboard.createShot(scene.id, { title: 'Sh', durationSeconds: 2 })

    // an asset that is BOTH a shot frame AND a character sheet (via attachFile of the same bytes is separate; simulate by registering then re-using the asset id? The 4-consumer check guards the prune — test via a sheet whose id also lands in a shot frame)
    const png = join(env.dir, 'shared.png')
    writeFileSync(png, TINY_PNG)
    const frameAsset = env.storyboard.importFrame(shot.id, png)

    // the character sheet service prunes only ITS asset; simulate the guard:
    // attempt to prune the shot's frame asset through the sheet path (public pruneOrphanedSheet)
    env.sheets.pruneOrphanedSheet(frameAsset.id)
    expect(existsSync(join(env.dir, 'images', 'assets', `${frameAsset.id}.png`))).toBe(true) // STILL referenced by the shot

    // a moodboard reference is also protected
    const moodRef = env.moodboard.attachImage(png)
    env.sheets.pruneOrphanedSheet(moodRef.imageAssetId)
    expect(existsSync(join(env.dir, 'images', 'assets', `${moodRef.imageAssetId}.png`))).toBe(true)

    // cleanup path proves the guard releases: remove shot frame + board item → the frame file prunes via the shot path
    env.storyboard.clearFrame(shot.id)
    env.moodboard.remove(moodRef.id)
    expect(existsSync(join(env.dir, 'images', 'assets', `${frameAsset.id}.png`))).toBe(false)
  })

  it('prunes the orphaned sheet after the character is deleted (via the public API)', () => {
    const env = makeEnv('orphan')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const sheet = env.sheets.registerSheet(ayaka.id, TINY_PNG, 'image/png')
    const sheetPath = join(env.dir, 'images', 'characters', `${sheet.id}.png`)
    expect(existsSync(sheetPath)).toBe(true)

    env.creative.deleteCharacter(ayaka.id) // the row dies; the asset lingers…
    env.sheets.pruneOrphanedSheet(sheet.id) // …until the honest prune
    expect(existsSync(sheetPath)).toBe(false)
  })

  it('validates imports honestly (bad type, missing file, unknown character)', () => {
    const env = makeEnv('invalid')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const txt = join(env.dir, 'sheet.txt')
    writeFileSync(txt, 'nope')
    expect(() => env.sheets.attachFile(ayaka.id, txt)).toThrow(MiraiError)
    expect(() => env.sheets.attachFile(ayaka.id, join(env.dir, 'ghost.png'))).toThrow(MiraiError)
    expect(() => env.sheets.registerSheet('01DOESNOTEXIST00000000000X', TINY_PNG, 'image/png')).toThrow(MiraiError)
  })
})
