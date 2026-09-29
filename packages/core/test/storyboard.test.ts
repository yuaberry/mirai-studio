import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-sb-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'Episode One' })
  const scene = creative.createScene(episode.id, { title: 'The rooftop promise' })
  return { dir, db, creative, storyboard, episode, scene }
}

function makeFakeImage(name: string, size = 1024): string {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-img-'))
  const file = join(dir, name)
  writeFileSync(file, Buffer.alloc(size, 0x89)) // fake PNG bytes
  return file
}

describe('Shots', () => {
  it('creates shots in order with full camera metadata', () => {
    const { storyboard, scene } = makeEnv('create')
    const shot = storyboard.createShot(scene.id, {
      title: 'The promise',
      shotType: 'CLOSE_UP',
      lens: '85mm',
      cameraMovement: 'DOLLY_IN',
      durationSeconds: 4.5,
      dialogue: 'YUNA\n"I will protect you."',
      notes: 'Hold 2s, then push in.',
    })
    expect(shot.orderIndex).toBe(0)
    expect(shot.shotType).toBe('CLOSE_UP')
    expect(shot.lens).toBe('85mm')
    expect(shot.cameraMovement).toBe('DOLLY_IN')
    expect(shot.durationSeconds).toBeCloseTo(4.5)
    expect(shot.frameAssetId).toBeNull()
    expect(shot.status).toBe('TODO')

    const second = storyboard.createShot(scene.id, { title: 'Cutaway — city lights' })
    expect(second.orderIndex).toBe(1)
    expect(storyboard.listShots(scene.id)).toHaveLength(2)
  })

  it('updates metadata, moves up/down and guards edges', () => {
    const { storyboard, scene } = makeEnv('update')
    const a = storyboard.createShot(scene.id, { title: 'A' })
    const b = storyboard.createShot(scene.id, { title: 'B' })
    const c = storyboard.createShot(scene.id, { title: 'C' })

    expect(() => storyboard.moveShot(a.id, 'up')).toThrow(/cannot move/i)
    storyboard.moveShot(a.id, 'down')
    expect(storyboard.listShots(scene.id).map((s) => s.title)).toEqual(['B', 'A', 'C'])
    storyboard.moveShot(c.id, 'up')
    expect(storyboard.listShots(scene.id).map((s) => s.title)).toEqual(['B', 'C', 'A'])
    expect(() => storyboard.moveShot(b.id, 'up')).toThrow(/cannot move/i)
    expect(() => storyboard.moveShot(a.id, 'down')).toThrow(/cannot move/i)

    const updated = storyboard.updateShot(b.id, {
      title: 'B (revised)',
      shotType: 'WIDE',
      lens: '24mm',
      cameraMovement: 'PAN',
      durationSeconds: 6,
    })
    expect(updated.title).toBe('B (revised)')
    expect(updated.shotType).toBe('WIDE')
    expect(updated.lens).toBe('24mm')
  })

  it('rejects invalid inputs and unknown scenes', () => {
    const { storyboard, scene } = makeEnv('invalid')
    expect(() => storyboard.createShot(scene.id, { title: '' })).toThrow(MiraiError)
    expect(() => storyboard.createShot(scene.id, { title: 'x', durationSeconds: 0 })).toThrow(MiraiError)
    expect(() =>
      storyboard.createShot('01H5P2Z3A4B5C6D7E8F9G0J1K2', { title: 'x' }),
    ).toThrow(/Scene .* not found/i)
  })

  it('deleting the scene cascades its shots', () => {
    const { creative, storyboard, scene, episode } = makeEnv('cascade')
    const shot = storyboard.createShot(scene.id, { title: 'gone' })
    creative.deleteEpisode(episode.id)
    expect(() => storyboard.listShots(scene.id)).toThrow(/not found/i)
    expect(() => storyboard.createShot(scene.id, { title: 'x' })).toThrow(/not found/i)
    void shot
  })
})

describe('Frames (real image assets)', () => {
  it('imports a frame file into the project, serves it, replaces and prunes orphans', () => {
    const { storyboard, dir, scene } = makeEnv('frames')
    const shot = storyboard.createShot(scene.id, { title: 'With frame' })
    const image = makeFakeImage('frame-a.png', 2048)

    const asset = storyboard.importFrame(shot.id, image)
    expect(asset.kind).toBe('IMAGE')
    expect(asset.originalName).toBe('frame-a.png')
    expect(asset.mime).toBe('image/png')
    expect(asset.bytes).toBe(2048)
    expect(asset.relativePath.startsWith('images/assets/')).toBe(true)
    expect(existsSync(join(dir, asset.relativePath))).toBe(true)

    // Served path resolves inside the project and the file exists.
    const served = storyboard.assetAbsolutePath(asset.id)
    expect(served.startsWith(dir)).toBe(true)
    expect(existsSync(served)).toBe(true)

    // Attach a second frame — the first becomes an orphan and is pruned.
    const image2 = makeFakeImage('frame-b.png', 512)
    const asset2 = storyboard.importFrame(shot.id, image2)
    expect(() => storyboard.getAsset(asset.id)).toThrow(/not found/i)
    expect(existsSync(join(dir, asset.relativePath))).toBe(false)
    expect(storyboard.getAsset(asset2.id).id).toBe(asset2.id)

    // Clearing the frame prunes the now-orphan asset + deletes the file.
    storyboard.clearFrame(shot.id)
    expect(() => storyboard.getAsset(asset2.id)).toThrow(/not found/i)
    expect(existsSync(join(dir, asset2.relativePath))).toBe(false)
  })

  it('validates extension and size, and missing sources', () => {
    const { storyboard, scene } = makeEnv('validate')
    const shot = storyboard.createShot(scene.id, { title: 's' })

    const textFile = makeFakeImage('notes.txt')
    expect(() => storyboard.importFrame(shot.id, textFile)).toThrow(/Unsupported image type/i)

    const bigFile = makeFakeImage('huge.png', 41 * 1024 * 1024)
    expect(() => storyboard.importFrame(shot.id, bigFile)).toThrow(/too large/i)

    expect(() => storyboard.importFrame(shot.id, '/nonexistent/frame.png')).toThrow(/not found/i)
  })

  it('blocks path escape from corrupted registry rows (security)', () => {
    const { storyboard, dir, db, scene } = makeEnv('escape')
    const shot = storyboard.createShot(scene.id, { title: 's' })
    const image = makeFakeImage('ok.png')
    const asset = storyboard.importFrame(shot.id, image)

    // DB surgery simulating corruption: point the asset outside the project.
    db.prepare('UPDATE assets SET relative_path = ? WHERE id = ?').run(
      '../escaped.png',
      asset.id,
    )
    expect(() => storyboard.assetAbsolutePath(asset.id)).toThrow(/escapes the project/i)

    // Also a nested traversal must be blocked.
    db.prepare('UPDATE assets SET relative_path = ? WHERE id = ?').run(
      'images/../../escaped.png',
      asset.id,
    )
    expect(() => storyboard.assetAbsolutePath(asset.id)).toThrow(/escapes the project/i)
    void dir
  })

  it('importFrame cancels cleanly when the source disappears mid-copy', () => {
    const { storyboard, scene } = makeEnv('missing')
    const shot = storyboard.createShot(scene.id, { title: 's' })
    const transient = makeFakeImage('transient.png')
    rmSync(transient, { force: true })
    expect(() => storyboard.importFrame(shot.id, transient)).toThrow(/not found/i)
  })
})

describe('Style Bible', () => {
  it('round-trips the visual identity document', () => {
    const { storyboard } = makeEnv('style')
    expect(storyboard.getStyleBible()).toEqual({})
    const style = {
      artDirection: 'Luminous TV-anime with painted backgrounds.',
      lineart: 'Fine, confident strokes; bold only on impact.',
      palette: 'Sakura pink, dusk violet, cyan accents.',
    }
    expect(storyboard.updateStyleBible(style)).toEqual(style)
    expect(storyboard.getStyleBible()).toEqual(style)
  })

  it('rejects an over-long field via zod', () => {
    const { storyboard } = makeEnv('style-invalid')
    expect(() => storyboard.updateStyleBible({ palette: 'x'.repeat(5_000) })).toThrow(MiraiError)
  })
})
