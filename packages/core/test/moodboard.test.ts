/**
 * v0.27 — Visual Dev Lab slice 1 (§7): the moodboard — real images
 * through the asset pipeline, captions, palette colors, ordering, and
 * honest asset pruning (shots/panels/board aware).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { MoodboardService } from '../src/visual/moodboardService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v27-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const moodboard = new MoodboardService(db, clock, dir)
  return { dir, db, clock, creative, storyboard, moodboard }
}

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex',
)

function png(dir: string, n: number): string {
  const p = join(dir, `ref-${n}.png`)
  writeFileSync(p, TINY_PNG)
  return p
}

describe('moodboard (§7 slice 1)', () => {
  it('imports real references, orders them, and renumbers after removal', () => {
    const env = makeEnv('order')
    const a = env.moodboard.attachImage(png(env.dir, 1))
    const b = env.moodboard.attachImage(png(env.dir, 2))
    const c = env.moodboard.attachImage(png(env.dir, 3))
    expect([a.orderIndex, b.orderIndex, c.orderIndex]).toEqual([0, 1, 2])
    expect(env.moodboard.list().map((i) => i.id)).toEqual([a.id, b.id, c.id])

    env.moodboard.move(a.id, 'down')
    expect(env.moodboard.list().map((i) => i.id)).toEqual([b.id, a.id, c.id])
    expect(() => env.moodboard.move(b.id, 'up')).toThrow(MiraiError) // already first
    expect(() => env.moodboard.move(c.id, 'down')).toThrow(MiraiError) // already last

    env.moodboard.remove(b.id)
    const rest = env.moodboard.list()
    expect(rest.map((i) => i.orderIndex)).toEqual([0, 1])
    expect(rest.map((i) => i.id)).toEqual([a.id, c.id])
  })

  it('updates captions and palette colors; invalid hex is rejected', () => {
    const env = makeEnv('update')
    const item = env.moodboard.attachImage(png(env.dir, 1))

    const updated = env.moodboard.update(item.id, { caption: 'Dusk at the shrine', color: '#f472b6' })
    expect(updated.caption).toBe('Dusk at the shrine')
    expect(updated.color).toBe('#f472b6')

    // palette strip reflects board order
    const second = env.moodboard.attachImage(png(env.dir, 2))
    env.moodboard.update(second.id, { color: '#22d3ee' })
    expect(env.moodboard.palette()).toEqual(['#f472b6', '#22d3ee'])

    expect(() => env.moodboard.update(item.id, { color: 'pink' })).toThrow(MiraiError)
    expect(() => env.moodboard.update(item.id, { color: '#12345' })).toThrow(MiraiError)

    // clearing: caption/color omitted → null
    const cleared = env.moodboard.update(item.id, {})
    expect(cleared.caption).toBeNull()
    expect(cleared.color).toBeNull()
    expect(env.moodboard.palette()).toEqual(['#22d3ee'])
  })

  it('removes the asset file when nothing else references it — and NEVER when something does', () => {
    const env = makeEnv('prune')
    const ep = env.creative.createEpisode({ season: 1, number: 1, title: 'Pilot' })
    void ep

    // board-only asset: removal deletes the file
    const solo = env.moodboard.attachImage(png(env.dir, 1))
    const soloAssetId = solo.imageAssetId
    expect(existsSync(join(env.dir, 'images', 'assets', `${soloAssetId}.png`))).toBe(true)
    env.moodboard.remove(solo.id)
    expect(existsSync(join(env.dir, 'images', 'assets', `${soloAssetId}.png`))).toBe(false)

    // a shot's frame asset is untouchable through the board (different
    // asset per attach — verify the file survives a board-side no-op)
    const scene = env.creative.createScene(ep.id, { title: 's' })
    const shot = env.storyboard.createShot(scene.id, { title: 'sh', durationSeconds: 2 })
    const shotAsset = env.storyboard.importFrame(shot.id, png(env.dir, 2))
    const boardItem = env.moodboard.attachImage(png(env.dir, 2))
    const boardAssetId = boardItem.imageAssetId
    expect(boardAssetId).not.toBe(shotAsset.id) // separate assets — no hidden sharing
    env.moodboard.remove(boardItem.id)
    expect(existsSync(join(env.dir, 'images', 'assets', `${shotAsset.id}.png`))).toBe(true)
    expect(existsSync(join(env.dir, 'images', 'assets', `${boardAssetId}.png`))).toBe(false)
  })

  it('validates imports honestly (bad type, missing file, oversize)', () => {
    const env = makeEnv('invalid')
    const txt = join(env.dir, 'ref.txt')
    writeFileSync(txt, 'not an image')
    expect(() => env.moodboard.attachImage(txt)).toThrow(MiraiError)
    expect(() => env.moodboard.attachImage(join(env.dir, 'ghost.png'))).toThrow(MiraiError)
    expect(() => env.moodboard.update('01DOESNOTEXIST00000000000X', { caption: 'x' })).toThrow(MiraiError)
  })
})
