/**
 * v0.24 — IP Graph (§4): the impact screen (real dependents of an
 * entity) and derived works (project-to-project canon inheritance).
 * Everything is a REAL round-trip against migrated SQLite databases.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { MangaService } from '../src/creative/mangaService'
import { ProductionService } from '../src/production/productionService'
import { ImpactService } from '../src/production/impactService'
import { TimelineService } from '../src/timeline/timelineService'
import { MediaService } from '../src/media/mediaService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock, setupEnv } from './helpers'

function makeProjectEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-ip-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const media = new MediaService(db, clock, dir)
  const timeline = new TimelineService(db, clock)
  const manga = new MangaService(db, clock, dir)
  const production = new ProductionService(db, clock, dir, creative, storyboard, timeline, media)
  const impact = new ImpactService(db)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'Pilot' })
  return { dir, db, clock, creative, storyboard, media, timeline, manga, production, impact, episode }
}

describe('impact screen (§4) — real dependents', () => {
  it('counts everything a CHARACTER touches, straight from the tables', () => {
    const env = makeProjectEnv('char')
    const ayaka = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const rin = env.creative.createCharacter({ name: 'Rin', role: 'DEUTERAGONIST' })
    const other = env.creative.createCharacter({ name: 'Loner', role: 'SUPPORTING' })

    // direct: 2 scenes with cast
    const s1 = env.creative.createScene(env.episode.id, { title: 'Shrine steps', characterIds: [ayaka.id, rin.id] })
    const s2 = env.creative.createScene(env.episode.id, { title: 'Night talk', characterIds: [ayaka.id] })
    // indirect: shots + subtitles live inside those scenes
    env.storyboard.createShot(s1.id, { title: 'Wide', durationSeconds: 3 })
    env.storyboard.createShot(s2.id, { title: 'Close', durationSeconds: 2 })
    env.db
      .prepare('INSERT INTO subtitles (id, scene_id, start_sec, end_sec, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('01SUBTITLE0000000000000000001', s1.id, 0, 1, 'Olá', env.clock.isoNow(), env.clock.isoNow())

    // relationships + costumes
    env.creative.createRelationship({ fromCharacterId: ayaka.id, toCharacterId: rin.id, kind: 'ROMANTIC' })
    env.creative.createCostume({ characterId: ayaka.id, name: 'Uniforme' })

    // manga lettering referencing ayaka (JSON path query)
    const page = env.manga.createPage(env.episode.id, {})
    env.manga.createPanel(page.id, {
      lettering: [{ kind: 'SPEECH', characterId: ayaka.id, text: 'Viu aquilo?' }],
    })
    // a panel lettered for RIN must NOT count for ayaka
    env.manga.createPanel(page.id, {
      lettering: [{ kind: 'SPEECH', characterId: rin.id, text: 'Vi.' }],
    })

    // task + version linked to ayaka
    env.production.createTask({ title: 'Redesign ayaka', linkType: 'CHARACTER', linkId: ayaka.id })
    env.production.snapshotVersion('CHARACTER', ayaka.id, 'v1')

    const result = env.impact.impact('CHARACTER', ayaka.id)
    expect(result.label).toBe('Ayaka')
    const byKey = new Map(result.impacts.map((e) => [e.key, e.count]))
    expect(byKey.get('scenes')).toBe(2)
    expect(byKey.get('shots')).toBe(2) // indirect through scenes
    expect(byKey.get('subtitles')).toBe(1)
    expect(byKey.get('relationships')).toBe(1)
    expect(byKey.get('costumes')).toBe(1)
    expect(byKey.get('panels')).toBe(1) // NOT 2 — rin's panel is excluded
    expect(byKey.get('tasks')).toBe(1)
    expect(byKey.get('versions')).toBe(1)

    // the loner character has zero impact entries (honesty: nothing fabricated)
    const lonely = env.impact.impact('CHARACTER', other.id)
    expect(lonely.impacts).toHaveLength(0)
  })

  it('counts SCENE dependents including timeline tracks and parent episode', () => {
    const env = makeProjectEnv('scene')
    const scene = env.creative.createScene(env.episode.id, { title: 'Rain' })
    env.storyboard.createShot(scene.id, { title: 'A', durationSeconds: 1 })
    env.storyboard.createShot(scene.id, { title: 'B', durationSeconds: 1 })
    env.db
      .prepare('INSERT INTO subtitles (id, scene_id, start_sec, end_sec, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('01SUBTITLE0000000000000000002', scene.id, 0, 2, 'Chuva', env.clock.isoNow(), env.clock.isoNow())
    env.timeline.createTrack(scene.id, 'VIDEO')
    env.timeline.createTrack(scene.id, 'MUSIC')
    env.production.createTask({ title: 'Animate the rain scene', linkType: 'SCENE', linkId: scene.id })

    const result = env.impact.impact('SCENE', scene.id)
    const byKey = new Map(result.impacts.map((e) => [e.key, e.count]))
    expect(byKey.get('shots')).toBe(2)
    expect(byKey.get('subtitles')).toBe(1)
    expect(byKey.get('tracks')).toBe(2)
    expect(byKey.get('tasks')).toBe(1)
    expect(byKey.get('episode')).toBe(1)
    expect(result.label).toBe('Rain')
  })

  it('counts EPISODE/LOCATION/SHOT dependents and rejects unknown ids', () => {
    const env = makeProjectEnv('misc')
    const scene = env.creative.createScene(env.episode.id, { title: 'Courtyard' })
    env.storyboard.createShot(scene.id, { title: 'Establishing', durationSeconds: 4 })
    const shot = env.storyboard.listShots(scene.id)[0]!
    env.production.createTask({ title: 'Board it', linkType: 'SHOT', linkId: shot.id })
    env.production.snapshotVersion('SHOT', shot.id, 'storyboard pass')

    const ep = env.impact.impact('EPISODE', env.episode.id)
    expect(new Map(ep.impacts.map((e) => [e.key, e.count])).get('scenes')).toBe(1)

    const shotImpact = env.impact.impact('SHOT', shot.id)
    const shotKeys = new Map(shotImpact.impacts.map((e) => [e.key, e.count]))
    expect(shotKeys.get('tasks')).toBe(1)
    expect(shotKeys.get('versions')).toBe(1)
    expect(shotImpact.label).toBe('Establishing')

    const loc = env.creative.createLocation({ name: 'Academy rooftop', description: 'Windy' })
    env.creative.updateScene(scene.id, {
      title: scene.title,
      locationId: loc.id,
      characterIds: [],
      timeOfDay: 'NIGHT',
      synopsis: scene.synopsis,
    })
    const locImpact = env.impact.impact('LOCATION', loc.id)
    expect(new Map(locImpact.impacts.map((e) => [e.key, e.count])).get('scenes')).toBe(1)

    expect(() => env.impact.impact('CHARACTER', '01DOESNOTEXIST00000000000X')).toThrow(MiraiError)
    expect(() => env.impact.impact('SCENE', '01DOESNOTEXIST00000000000X')).toThrow(MiraiError)
  })
})

describe('derived works (§4) — canon inheritance', () => {
  it('creates a derived work with real canon copied into the child project', async () => {
    const env = setupEnv('derived')
    const parent = env.projects.create({
      name: 'Sakura Chronicles',
      dir: env.dirs.projectsDefaultDir,
      config: { title: 'Sakura Chronicles', genres: ['Yuri'], medium: 'ANIME' } as never,
    })

    // write canon into the parent DB
    const parentDb = openDatabase(join(parent.path, 'database', 'project.sqlite'))
    runMigrations(parentDb, PROJECT_DB_MIGRATIONS)
    const clock = makeClock()
    const creative = new CreativeService(parentDb, clock)
    creative.updateBible({ premise: 'A magic school yuri romance.' })
    const a = creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const b = creative.createCharacter({ name: 'Rin', role: 'DEUTERAGONIST' })
    creative.createRelationship({ fromCharacterId: a.id, toCharacterId: b.id, kind: 'ROMANTIC' })
    creative.createCostume({ characterId: a.id, name: 'Uniforme' })
    creative.createLocation({ name: 'Academy', description: 'Old halls' })
    parentDb.close()

    const { summary: child, workId } = env.projects.createDerivedWork({
      parentId: parent.id,
      name: 'Sakura Chronicles — Mangá',
      kind: 'ADAPTATION',
      notes: 'Monthly serialization',
      inherit: { storyBible: true, styleBible: true, characters: true, locations: false },
    })
    expect(workId).toBeTruthy()
    expect(child.name).toBe('Sakura Chronicles — Mangá')
    expect(existsSync(join(child.path, 'database', 'project.sqlite'))).toBe(true)

    // the child really inherited the canon
    const childDb = openDatabase(join(child.path, 'database', 'project.sqlite'))
    const bible = childDb.prepare("SELECT value FROM kv_store WHERE key = 'story-bible'").get() as { value: string }
    expect(bible.value).toContain('magic school')
    const chars = childDb.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n: number }
    expect(chars.n).toBe(2)
    const rels = childDb.prepare('SELECT COUNT(*) AS n FROM character_relationships').get() as { n: number }
    expect(rels.n).toBe(1)
    const costumes = childDb.prepare('SELECT COUNT(*) AS n FROM character_costumes').get() as { n: number }
    expect(costumes.n).toBe(1)
    const locs = childDb.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number }
    expect(locs.n).toBe(0) // locations NOT inherited (flag false)
    childDb.close()

    // the graph lists it from the PARENT side…
    const fromParent = env.projects.listDerivedWorks(parent.id)
    expect(fromParent).toHaveLength(1)
    expect(fromParent[0]!.direction).toBe('child')
    expect(fromParent[0]!.other?.id).toBe(child.id)
    expect(fromParent[0]!.kind).toBe('ADAPTATION')
    // …and from the CHILD side
    const fromChild = env.projects.listDerivedWorks(child.id)
    expect(fromChild).toHaveLength(1)
    expect(fromChild[0]!.direction).toBe('parent')
    expect(fromChild[0]!.other?.id).toBe(parent.id)

    // duplicate link is impossible (UNIQUE)
    expect(() =>
      env.projects.createDerivedWork({
        parentId: parent.id,
        name: 'Sakura Chronicles — Mangá',
        kind: 'ADAPTATION',
        inherit: { storyBible: false, styleBible: false, characters: false, locations: false },
      }),
    ).toThrow()

    // removing the link NEVER deletes the project
    env.projects.removeDerivedWork(workId)
    expect(env.projects.listDerivedWorks(parent.id)).toHaveLength(0)
    expect(existsSync(child.path)).toBe(true)
    expect(() => env.projects.removeDerivedWork(workId)).toThrow(MiraiError)
    await env.projects.close()
  })

  it('rejects derived works from missing parents honestly', () => {
    const env = setupEnv('derived-bad')
    expect(() =>
      env.projects.createDerivedWork({
        parentId: '01GHOSTPROJECT000000000000A',
        name: 'Nope',
        kind: 'SPIN_OFF',
        inherit: { storyBible: true, styleBible: true, characters: true, locations: false },
      }),
    ).toThrow(MiraiError)
  })
})
