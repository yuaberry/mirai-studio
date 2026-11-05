import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeCreative(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-creative-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  return { creative, db, clock }
}

describe('StoryBible', () => {
  it('defaults to empty and round-trips updates', () => {
    const { creative } = makeCreative('bible')
    expect(creative.getBible()).toEqual({})

    const bible = { premise: 'Two girls bond over magic', tone: 'bittersweet', themes: 'growing up' }
    expect(creative.updateBible(bible)).toEqual(bible)
    expect(creative.getBible()).toEqual(bible)

    expect(creative.updateBible({ premise: 'New premise' })).toEqual({ premise: 'New premise' })
  })

  it('rejects an over-long premise via zod', () => {
    const { creative } = makeCreative('bible-invalid')
    expect(() => creative.updateBible({ premise: 'x'.repeat(5_000) })).toThrow(MiraiError)
  })
})

describe('Characters', () => {
  it('creates with defaults, lists, updates and deletes', () => {
    const { creative } = makeCreative('characters')
    const yuna = creative.createCharacter({
      name: 'Yuna',
      role: 'PROTAGONIST',
      age: '17',
      personality: 'Earnest, a little clumsy, hides her bravery behind politeness.',
    })
    expect(yuna.status).toBe('DRAFT')
    expect(yuna.role).toBe('PROTAGONIST')

    const mio = creative.createCharacter({ name: 'Mio' })
    expect(mio.role).toBe('SUPPORTING')
    expect(creative.listCharacters().map((c) => c.name)).toEqual(['Yuna', 'Mio'])

    const updated = creative.updateCharacter(yuna.id, {
      name: 'Yuna Hoshimiya',
      role: 'PROTAGONIST',
      goals: 'Protect Mio at any cost.',
    })
    expect(updated.name).toBe('Yuna Hoshimiya')
    expect(updated.goals).toBe('Protect Mio at any cost.')
    expect(updated.age).toBeUndefined()

    creative.deleteCharacter(mio.id)
    expect(creative.listCharacters()).toHaveLength(1)
  })

  it('rejects an empty name', () => {
    const { creative } = makeCreative('character-invalid')
    expect(() => creative.createCharacter({ name: '' })).toThrow(MiraiError)
  })

  it('fails to update or delete a missing character with NOT_FOUND', () => {
    const { creative } = makeCreative('character-missing')
    expect(() =>
      creative.updateCharacter('01H5P2Z3A4B5C6D7E8F9G0J1K2', { name: 'x' }),
    ).toThrow(/not found/i)
    expect(() => creative.deleteCharacter('01H5P2Z3A4B5C6D7E8F9G0J1K2')).toThrow(/not found/i)
  })
})

describe('Locations', () => {
  it('CRUDs a location', () => {
    const { creative } = makeCreative('locations')
    const academy = creative.createLocation({
      name: 'Lumen Academy',
      climate: 'Eternal spring, wind carries sakura petals',
      architecture: 'White marble towers around a floating crystal core',
    })
    expect(academy.status).toBe('DRAFT')

    const updated = creative.updateLocation(academy.id, {
      name: 'Lumen Magic Academy',
      description: 'The school where the story begins.',
    })
    expect(updated.name).toBe('Lumen Magic Academy')

    creative.deleteLocation(academy.id)
    expect(creative.listLocations()).toHaveLength(0)
  })
})

describe('Episodes', () => {
  it('creates episodes with scene counts and enforces unique season/number', () => {
    const { creative } = makeCreative('episodes')
    const ep1 = creative.createEpisode({ season: 1, number: 1, title: 'Petals of a Promise' })
    expect(ep1.status).toBe('TODO')

    const ep2 = creative.createEpisode({ season: 1, number: 2, title: 'The Crystal Exam' })
    expect(creative.listEpisodes().map((e) => e.title)).toEqual(['Petals of a Promise', 'The Crystal Exam'])

    expect(() => creative.createEpisode({ season: 1, number: 1, title: 'Duplicate' })).toThrow(
      /already exists/i,
    )
    expect(() =>
      creative.updateEpisode(ep2.id, { season: 1, number: 1, title: 'The Crystal Exam' }),
    ).toThrow(/already exists/i)

    creative.createScene(ep1.id, { title: 'Opening — the rooftop promise' })
    creative.createScene(ep1.id, { title: 'Late for the entrance ceremony' })
    const stats = creative.listEpisodes().find((e) => e.id === ep1.id)!
    expect(stats.sceneCount).toBe(2)
  })

  it('deleting an episode cascades its scenes', () => {
    const { creative } = makeCreative('episode-cascade')
    const ep = creative.createEpisode({ season: 1, number: 1, title: 'Gone' })
    creative.createScene(ep.id, { title: 'S1' })
    creative.deleteEpisode(ep.id)
    expect(() => creative.listScenes(ep.id)).toThrow(/not found/i)
    expect(creative.listEpisodes()).toHaveLength(0)
  })
})

describe('Scenes', () => {
  function setup() {
    const env = makeCreative('scenes')
    const ep = env.creative.createEpisode({ season: 1, number: 1, title: 'Episode One' })
    const yuna = env.creative.createCharacter({ name: 'Yuna' })
    const mio = env.creative.createCharacter({ name: 'Mio' })
    const rooftop = env.creative.createLocation({ name: 'Academy Rooftop' })
    return { ...env, ep, yuna, mio, rooftop }
  }

  it('creates scenes in order with characters, location and screenplay', () => {
    const { creative, ep, yuna, mio, rooftop } = setup()

    const scene = creative.createScene(ep.id, {
      title: 'The rooftop promise',
      locationId: rooftop.id,
      timeOfDay: 'NIGHT',
      characterIds: [yuna.id, mio.id],
      synopsis: 'Yuna and Mio meet at midnight.',
      screenplay: 'INT. ACADEMY ROOFTOP — NIGHT\n\nYUNA\n"I will become strong enough to protect you."',
    })

    expect(scene.orderIndex).toBe(0)
    expect(scene.characterIds).toHaveLength(2)
    expect(scene.locationId).toBe(rooftop.id)
    expect(scene.timeOfDay).toBe('NIGHT')

    const second = creative.createScene(ep.id, { title: 'Morning bells' })
    expect(second.orderIndex).toBe(1)

    const listed = creative.listScenes(ep.id)
    expect(listed.map((s) => s.title)).toEqual(['The rooftop promise', 'Morning bells'])
  })

  it('updates scene fields and rewrites the character set (replace semantics)', () => {
    const { creative, ep, yuna, mio } = setup()
    const scene = creative.createScene(ep.id, {
      title: 'Scene A',
      characterIds: [yuna.id, mio.id],
    })

    const updated = creative.updateScene(scene.id, {
      title: 'Scene A (revised)',
      characterIds: [mio.id],
      synopsis: 'Mio alone now.',
    })
    expect(updated.characterIds).toEqual([mio.id])
    expect(updated.title).toBe('Scene A (revised)')
  })

  it('moves scenes up/down and guards the edges', () => {
    const { creative, ep } = setup()
    const a = creative.createScene(ep.id, { title: 'A' })
    const b = creative.createScene(ep.id, { title: 'B' })
    const c = creative.createScene(ep.id, { title: 'C' })

    expect(() => creative.moveScene(a.id, 'up')).toThrow(/cannot move/i)
    creative.moveScene(a.id, 'down')
    expect(creative.listScenes(ep.id).map((s) => s.title)).toEqual(['B', 'A', 'C'])
    creative.moveScene(c.id, 'up')
    expect(creative.listScenes(ep.id).map((s) => s.title)).toEqual(['B', 'C', 'A'])
    expect(() => creative.moveScene(b.id, 'up')).toThrow(/cannot move/i)
    expect(() => creative.moveScene(a.id, 'down')).toThrow(/cannot move/i)
    void b
  })

  it('rejects unknown location/character references with clear errors', () => {
    const { creative, ep } = setup()
    expect(() =>
      creative.createScene(ep.id, { title: 'X', locationId: '01H5P2Z3A4B5C6D7E8F9G0J1K2' }),
    ).toThrow(/Location .* not found/i)
    expect(() =>
      creative.createScene(ep.id, { title: 'X', characterIds: ['01H5P2Z3A4B5C6D7E8F9G0J1K2'] }),
    ).toThrow(/Character .* not found/i)
  })

  it('deleting a character removes it from scenes but keeps the scene', () => {
    const { creative, ep, yuna, mio } = setup()
    const scene = creative.createScene(ep.id, {
      title: 'Together',
      characterIds: [yuna.id, mio.id],
    })
    creative.deleteCharacter(yuna.id)
    const after = creative.listScenes(ep.id).find((s) => s.id === scene.id)!
    expect(after.characterIds).toEqual([mio.id])
  })

  it('deleting a location keeps the scene with location cleared (SET NULL)', () => {
    const { creative, ep, rooftop } = setup()
    const scene = creative.createScene(ep.id, { title: 'At the rooftop', locationId: rooftop.id })
    creative.deleteLocation(rooftop.id)
    const after = creative.listScenes(ep.id).find((s) => s.id === scene.id)!
    expect(after.locationId).toBeUndefined()
  })
})
