/**
 * v0.21 — Phase 1/2 remaining core: relationships, costumes, project memory
 * (FTS5 real search) and AI usage persistence. All REAL round-trips.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { AiUsageService } from '../src/ai/aiUsage'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { APP_DB_MIGRATIONS, PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v21-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'Episode One' })
  return { creative, episode, db, clock }
}

describe('relationships + costumes (Phase 1)', () => {
  it('creates relationships, lists them both ways, and rejects self-loops', () => {
    const env = makeEnv('rel')
    const a = env.creative.createCharacter({ name: 'Ayaka', role: 'PROTAGONIST' })
    const b = env.creative.createCharacter({ name: 'Rin', role: 'DEUTERAGONIST' })
    const rel = env.creative.createRelationship({ fromCharacterId: a.id, toCharacterId: b.id, kind: 'ROMANTIC', notes: 'Confession letters' })
    expect(rel.kind).toBe('ROMANTIC')
    expect(env.creative.listRelationships(a.id)).toHaveLength(1)
    // the relationship shows from BOTH sides
    expect(env.creative.listRelationships(b.id)).toHaveLength(1)
    expect(env.creative.listRelationships()).toHaveLength(1)
    expect(() =>
      env.creative.createRelationship({ fromCharacterId: a.id, toCharacterId: a.id, kind: 'ALLY' }),
    ).toThrow(MiraiError)
    env.creative.deleteRelationship(rel.id)
    expect(env.creative.listRelationships()).toHaveLength(0)
  })

  it('cascade-deletes relationships and costumes with the character', () => {
    const env = makeEnv('cascade')
    const a = env.creative.createCharacter({ name: 'Kaito', role: 'PROTAGONIST' })
    const b = env.creative.createCharacter({ name: 'Yuki', role: 'SUPPORTING' })
    env.creative.createRelationship({ fromCharacterId: a.id, toCharacterId: b.id, kind: 'FAMILY' })
    env.creative.createCostume({ characterId: a.id, name: 'Uniforme de guarda', description: 'Capa cinza' })
    expect(env.creative.listRelationships()).toHaveLength(1)
    expect(env.creative.listCostumes(a.id)).toHaveLength(1)
    env.creative.deleteCharacter(a.id)
    expect(env.creative.listRelationships()).toHaveLength(0)
    expect(() => env.creative.listCostumes(a.id)).not.toThrow()
  })

  it('manages costumes per character', () => {
    const env = makeEnv('costume')
    const a = env.creative.createCharacter({ name: 'Hana', role: 'SUPPORTING' })
    const c1 = env.creative.createCostume({ characterId: a.id, name: 'Kimono de festival', occasion: 'Festival' })
    env.creative.createCostume({ characterId: a.id, name: 'Uniforme escolar' })
    expect(env.creative.listCostumes(a.id)).toHaveLength(2)
    expect(c1.occasion).toBe('Festival')
    env.creative.deleteCostume(c1.id)
    expect(env.creative.listCostumes(a.id)).toHaveLength(1)
  })
})

describe('project memory — FTS5 (Phase 2)', () => {
  it('indexes scenes and characters via triggers and searches with snippets', () => {
    const env = makeEnv('fts')
    const char = env.creative.createCharacter({
      name: 'Ayaka Kisaragi',
      appearance: 'Cabelos prata, olhos âmbar, faixa vermelha herdada da avó.',
    })
    const scene = env.creative.createScene(env.episode.id, {
      title: 'Telhado ao amanhecer',
      synopsis: 'Ayaka treina sozinha; a faísca escapa da faixa vermelha.',
    })
    // updates reindex through the UPDATE trigger
    env.creative.updateScene(scene.id, {
      title: scene.title,
      timeOfDay: scene.timeOfDay,
      characterIds: scene.characterIds,
      locationId: scene.locationId ?? undefined,
      synopsis: scene.synopsis,
      screenplay: 'AYAKA\n"Pela terceira vez hoje… por que você não apaga?"',
    })

    const byFaísca = env.creative.searchProjectMemory('faísca')
    expect(byFaísca.length).toBeGreaterThan(0)
    expect(byFaísca.some((r) => r.entityType === 'SCENE' && r.entityId === scene.id)).toBe(true)

    const byAmbar = env.creative.searchProjectMemory('ambar') // diacritic-insensitive
    expect(byAmbar.some((r) => r.entityType === 'CHARACTER' && r.entityId === char.id)).toBe(true)

    const byDialogue = env.creative.searchProjectMemory('"não apaga"')
    expect(byDialogue.some((r) => r.entityType === 'SCENE')).toBe(true)

    // delete removes from the index
    env.creative.deleteScene(scene.id)
    expect(env.creative.searchProjectMemory('faísca').some((r) => r.entityId === scene.id)).toBe(false)

    // short queries return nothing
    expect(env.creative.searchProjectMemory('a')).toHaveLength(0)
  })
})

describe('AI usage persistence (Phase 2)', () => {
  it('records calls and summarizes REAL totals per model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirai-usage-'))
    const db = openDatabase(join(dir, 'app.sqlite'))
    runMigrations(db, APP_DB_MIGRATIONS)
    const usage = new AiUsageService(db)
    const clock = makeClock()

    usage.record({ kind: 'chat', provider: 'nvidia', model: 'glm-5.3', promptTokens: 1200, completionTokens: 300, durationMs: 4200 }, clock.isoNow())
    usage.record({ kind: 'chat', provider: 'nvidia', model: 'glm-5.3', promptTokens: 800, completionTokens: 150, durationMs: 2100 }, clock.isoNow())
    usage.record({ kind: 'image', model: 'flux', promptTokens: 0, completionTokens: 0, durationMs: 900, status: 'ERROR', error: 'provider 500' }, clock.isoNow())

    const summary = usage.summary()
    expect(summary.totalCalls).toBe(3)
    expect(summary.totalErrors).toBe(1)
    expect(summary.totalPromptTokens).toBe(2000)
    expect(summary.totalCompletionTokens).toBe(450)
    expect(summary.byModel[0]!.model).toBe('glm-5.3')
    expect(summary.byModel[0]!.calls).toBe(2)
    expect(summary.recentErrors[0]!.error).toBe('provider 500')
  })
})
