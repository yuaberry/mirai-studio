/**
 * Phase 7 — production suite: task board, crew, governed approval pipeline
 * with audit trail, entity versioning, QC checks and analytics.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { MediaService } from '../src/media/mediaService'
import { ProductionService } from '../src/production/productionService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { TimelineService } from '../src/timeline/timelineService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-prod-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const media = new MediaService(db, clock, dir)
  const timeline = new TimelineService(db, clock)
  const production = new ProductionService(db, clock, dir, creative, storyboard, timeline, media)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'Episode One' })
  const scene = creative.createScene(episode.id, { title: 'The rooftop promise' })
  return { dir, db, clock, creative, storyboard, media, timeline, production, episode, scene }
}

describe('task board', () => {
  it('creates, patches, moves between columns and deletes', () => {
    const env = makeEnv('tasks')
    const task = env.production.createTask({ title: 'Storyboard the climax', priority: 'HIGH' })
    expect(task.status).toBe('TODO')
    expect(task.priority).toBe('HIGH')
    expect(task.orderIndex).toBe(0)

    const second = env.production.createTask({ title: 'Record voice lines', priority: 'NORMAL' })
    expect(second.orderIndex).toBe(1)

    // Patch fields without touching the column.
    const patched = env.production.updateTask(task.id, { description: 'Scene 12 needs 14 shots.' })
    expect(patched.description).toBe('Scene 12 needs 14 shots.')

    // Moving appends at the end of the target column.
    const moved = env.production.setTaskStatus(second.id, 'IN_PROGRESS')
    expect(moved.status).toBe('IN_PROGRESS')
    const firstMove = env.production.setTaskStatus(task.id, 'IN_PROGRESS')
    expect(firstMove.orderIndex).toBeGreaterThan(moved.orderIndex)

    // Column filtering.
    expect(env.production.listTasks('IN_PROGRESS')).toHaveLength(2)
    expect(env.production.listTasks('TODO')).toHaveLength(0)
    expect(env.production.listTasks()).toHaveLength(2)

    env.production.deleteTask(task.id)
    expect(env.production.listTasks('IN_PROGRESS')).toHaveLength(1)
  })

  it('links tasks to entities and assigns crew members', () => {
    const env = makeEnv('assign')
    const director = env.production.createCrewMember('Yua', 'DIRECTOR')
    const task = env.production.createTask({
      title: 'Approve rooftop scene',
      linkType: 'SCENE',
      linkId: env.scene.id,
      assigneeId: director.id,
    })
    expect(task.linkType).toBe('SCENE')
    expect(task.assigneeId).toBe(director.id)

    // Crew deletion unassigns but never deletes tasks.
    env.production.deleteCrewMember(director.id)
    const after = env.production.getTask(task.id)
    expect(after.assigneeId).toBeNull()
    expect(env.production.listCrew()).toHaveLength(0)
  })

  it('rejects empty patches and unknown tasks', () => {
    const env = makeEnv('badtasks')
    const task = env.production.createTask({ title: 'x' })
    expect(() => env.production.updateTask(task.id, {} as never)).toThrow(MiraiError)
    expect(() => env.production.deleteTask('01HZZZZZZZZZZZZZZZZZZZZZZZZ' as never)).toThrow(MiraiError)
  })
})

describe('approval pipeline', () => {
  it('advances one step at a time and logs every transition', () => {
    const env = makeEnv('approve')
    const character = env.creative.createCharacter({ name: 'Yuna', role: 'PROTAGONIST' })
    const first = env.production.transition('CHARACTER', character.id, 'REVIEW', 'Ready for review', 'Yua')
    expect(first.fromStatus).toBe('DRAFT')
    expect(first.toStatus).toBe('REVIEW')
    expect(first.actorName).toBe('Yua')

    const second = env.production.transition('CHARACTER', character.id, 'APPROVED', 'Design locked')
    expect(second.fromStatus).toBe('REVIEW')
    // Status really persisted on the entity.
    expect(env.creative.getCharacter(character.id).status).toBe('APPROVED')

    // Audit trail is complete and ordered.
    const log = env.production.listApprovals('CHARACTER', character.id)
    expect(log).toHaveLength(2)
    expect(log[0]!.toStatus).toBe('APPROVED')
  })

  it('blocks pipeline skips but allows free backward revisions', () => {
    const env = makeEnv('rules')
    const character = env.creative.createCharacter({ name: 'Rin' })
    // DRAFT → APPROVED is a skip: blocked.
    expect(() => env.production.transition('CHARACTER', character.id, 'APPROVED')).toThrow(MiraiError)
    // Scenes follow the production pipeline: TODO → IN_PROGRESS is fine…
    env.production.transition('SCENE', env.scene.id, 'IN_PROGRESS')
    // …REVIEW next…
    env.production.transition('SCENE', env.scene.id, 'REVIEW')
    expect(env.creative.getSceneById(env.scene.id).status).toBe('REVIEW')
    // …and jumping straight back to TODO (revision loop) is always allowed.
    env.production.transition('SCENE', env.scene.id, 'TODO', 'Needs a rewrite')
    expect(env.creative.getSceneById(env.scene.id).status).toBe('TODO')
    // But a SCENE can't use ASSET statuses at all.
    expect(() => env.production.transition('SCENE', env.scene.id, 'DRAFT')).toThrow(MiraiError)
  })

  it('shots advance through their own pipeline', () => {
    const env = makeEnv('shots')
    const shot = env.storyboard.createShot(env.scene.id, { title: 'The promise' })
    env.production.transition('SHOT', shot.id, 'IN_PROGRESS')
    env.production.transition('SHOT', shot.id, 'REVIEW')
    env.production.transition('SHOT', shot.id, 'APPROVED')
    expect(env.storyboard.getShotById(shot.id).status).toBe('APPROVED')
  })
})

describe('entity versioning', () => {
  it('snapshots, restores and diffs — restore never loses work', () => {
    const env = makeEnv('versions')
    const character = env.creative.createCharacter({ name: 'Yuna', appearance: 'Pink hair, amber eyes.' })
    const v1 = env.production.snapshotVersion('CHARACTER', character.id, 'First design')
    expect(v1.version).toBe(1)

    // Change the live record.
    env.creative.updateCharacter(character.id, { name: 'Yuna Hoshimiya', appearance: 'Silver hair now.' })
    expect(env.creative.getCharacter(character.id).appearance).toBe('Silver hair now.')

    // Restore v1 — the changed state is auto-snapshotted first.
    const restored = env.production.restoreVersion(v1.id)
    expect(restored.version).toBe(1)
    expect(env.creative.getCharacter(character.id).name).toBe('Yuna')
    expect(env.creative.getCharacter(character.id).appearance).toBe('Pink hair, amber eyes.')

    // The auto safety snapshot holds the pre-restore state.
    const versions = env.production.listVersions('CHARACTER', character.id)
    expect(versions).toHaveLength(2)
    const latest = versions[0]!
    expect(latest.label).toBe('auto — before restore')
  })

  it('diffs two versions field by field', () => {
    const env = makeEnv('diff')
    const character = env.creative.createCharacter({ name: 'Yuna', role: 'PROTAGONIST' })
    const v1 = env.production.snapshotVersion('CHARACTER', character.id)
    env.creative.updateCharacter(character.id, { name: 'Yuna H.', role: 'PROTAGONIST', goals: 'Protect the club.' })
    const v2 = env.production.snapshotVersion('CHARACTER', character.id)

    const entries = env.production.diffVersions(v1.id, v2.id)
    const byField = new Map(entries.map((e) => [e.field, e]))
    expect(byField.get('name')!.from).toBe('Yuna')
    expect(byField.get('name')!.to).toBe('Yuna H.')
    expect(byField.get('goals')!.to).toBe('Protect the club.')
    // Unchanged fields don't appear.
    expect(byField.has('role')).toBe(false)
    // Cross-entity diffs are refused.
    expect(() =>
      env.production.diffVersions(v1.id, '01HZZZZZZZZZZZZZZZZZZZZZZZZ' as never),
    ).toThrow(MiraiError)
  })

  it('versions scenes including the screenplay', () => {
    const env = makeEnv('scenvers')
    env.creative.updateScene(env.scene.id, { title: 'The rooftop promise', screenplay: 'YUNA\n"I will protect you."' })
    const v1 = env.production.snapshotVersion('SCENE', env.scene.id)
    env.creative.updateScene(env.scene.id, { title: 'The rooftop promise', screenplay: 'YUNA\n"I WILL protect you."' })
    env.production.restoreVersion(v1.id)
    expect(env.creative.getSceneById(env.scene.id).screenplay).toBe('YUNA\n"I will protect you."')
  })
})

describe('quality control', () => {
  it('mature QC flags non-adult cast on 18+ productions (and stays quiet otherwise)', () => {
    const env = makeEnv('mature-qc')
    env.creative.createCharacter({
      name: 'Adult Lead',
      role: 'PROTAGONIST',
      age: '21',
      appearance: 'Silver hair, amber eyes — described so appearance QC stays quiet.',
    })
    env.creative.createCharacter({ name: 'Ambiguous One', role: 'SUPPORTING' }) // no age
    env.creative.createCharacter({ name: 'Teen Side', role: 'SUPPORTING', age: '16' })

    const safe = env.production.runQc('13+')
    expect(safe.findings.some((f) => f.checkId === 'mature-cast-not-adult')).toBe(false)

    const mature = env.production.runQc('18+')
    const flagged = mature.findings.filter((f) => f.checkId === 'mature-cast-not-adult')
    expect(flagged.length).toBe(2) // ambiguous + minor
    expect(mature.findings.some((f) => f.title.includes('Adult Lead'))).toBe(false)
    expect(mature.errorCount).toBeGreaterThanOrEqual(2)
  })

  it('flags every production gap with actionable hints', () => {
    const env = makeEnv('qc')
    // Episode with one scene; scene has a shot with dialogue but no frame/voice.
    const shot = env.storyboard.createShot(env.scene.id, {
      title: 'Empty shot',
      dialogue: 'YUNA\n"Line one."',
    })
    // A second episode with no scenes at all.
    env.creative.createEpisode({ season: 1, number: 2, title: 'Empty' })

    const report = env.production.runQc()
    const ids = new Set(report.findings.map((f) => f.checkId))
    expect(ids.has('scene-no-screenplay')).toBe(true)
    expect(ids.has('shot-no-frame')).toBe(true)
    expect(ids.has('shot-dialogue-no-voice')).toBe(true)
    expect(ids.has('episode-no-scenes')).toBe(true)

    // Fix everything and the report cleans up.
    env.creative.updateScene(env.scene.id, { title: 'The rooftop promise', screenplay: 'YUNA\n"Line."' })
    env.storyboard.updateShot(shot.id, { title: 'Full shot' })
    env.storyboard.createShot(env.scene.id, { title: 'v2' }) // still frameless, fine
    const after = env.production.runQc()
    expect(after.findings.some((f) => f.checkId === 'scene-no-screenplay')).toBe(false)
    expect(after.warningCount).toBeGreaterThan(0)
    expect(after.ranAt).toBeTruthy()
  })
})

describe('production analytics', () => {
  it('aggregates real production state', () => {
    const env = makeEnv('analytics')
    env.storyboard.createShot(env.scene.id, { title: 'With dialogue', dialogue: 'a' })
    const framed = env.storyboard.createShot(env.scene.id, { title: 'Framed' })
    void framed
    env.timeline.buildFromScene(env.scene.id)
    const director = env.production.createCrewMember('Yua', 'DIRECTOR')
    env.production.createTask({ title: 'Review', assigneeId: director.id })
    env.production.transition('SCENE', env.scene.id, 'IN_PROGRESS')
    env.production.snapshotVersion('SCENE', env.scene.id)

    const a = env.production.overview()
    expect(a.episodes.total).toBe(1)
    expect(a.scenes.total).toBe(1)
    expect(a.scenes.withTimeline).toBe(1)
    expect(a.shots.total).toBe(2)
    expect(a.shots.withFrame).toBeLessThan(2)
    expect(a.shots.byStatus['TODO']).toBe(2)
    expect(a.tasks.total).toBe(1)
    expect(a.tasks.byStatus['TODO']).toBe(1)
    expect(a.crew.total).toBe(1)
    expect(a.approvals.events).toBe(1)
    expect(a.versions.total).toBe(1)
  })
})
