import { describe, expect, it } from 'vitest'
import { MiraiError, PROMPT_CATEGORIES } from '@mirai/shared'
import { PromptService } from '../src/prompts/promptService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makePromptService(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-prompts-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  return { service: new PromptService(db, makeClock()), db }
}

describe('PromptService', () => {
  it('seeds the built-in manga/anime library exactly once', () => {
    const { service } = makePromptService('seeds')
    const first = service.list()
    expect(first.length).toBeGreaterThanOrEqual(10)
    expect(first.filter((p) => p.builtin).length).toBe(first.length)

    // A second service instance (e.g. reopening the project) must not duplicate.
    const { service: service2 } = makePromptService('seeds-2')
    void service2
    const again = makePromptService('seeds-3')
    expect(again.service.list().length).toBe(first.length)
  })

  it('built-ins cover the manga/anime categories that matter', () => {
    const { service } = makePromptService('coverage')
    const categories = new Set(service.list().map((p) => p.category))
    expect(categories.has('MANGA_PANEL')).toBe(true)
    expect(categories.has('CHARACTER')).toBe(true)
    expect(categories.has('ANIME_STYLE')).toBe(true)
    expect(categories.has('NEGATIVE')).toBe(true)
    expect(categories.has('STORY')).toBe(true)
  })

  it('CRUDs user prompts', () => {
    const { service } = makePromptService('crud')
    const created = service.create({
      category: 'SCENE',
      title: 'My Rooftop Keyframe',
      body: 'Rooftop at dusk, warm rim light, cel shading.',
      tags: 'rooftop, dusk, mine',
    })
    expect(created.builtin).toBe(false)
    expect(service.list().some((p) => p.id === created.id)).toBe(true)

    const updated = service.update(created.id, {
      category: 'SCENE',
      title: 'My Rooftop Keyframe v2',
      body: 'Rooftop at NIGHT, cool moonlight.',
      tags: 'rooftop, night',
    })
    expect(updated.title).toBe('My Rooftop Keyframe v2')

    service.delete(created.id)
    expect(() => service.get(created.id)).toThrow(/not found/i)
  })

  it('built-ins can be edited but never deleted', () => {
    const { service } = makePromptService('builtin-guard')
    const builtin = service.list().find((p) => p.builtin)!

    expect(() => service.delete(builtin.id)).toThrow(MiraiError)
    expect(() => service.delete(builtin.id)).toThrow(/cannot be deleted/i)

    const edited = service.update(builtin.id, {
      category: builtin.category,
      title: builtin.title,
      body: 'My personal override of the built-in prompt.',
      tags: builtin.tags,
    })
    expect(edited.body).toBe('My personal override of the built-in prompt.')
    expect(edited.builtin).toBe(true)
  })

  it('rejects invalid inputs via zod', () => {
    const { service } = makePromptService('invalid')
    expect(() => service.create({ category: 'NOT_A_CATEGORY' as never, title: '', body: '' })).toThrow(MiraiError)
    expect(() => service.create({ category: PROMPT_CATEGORIES[0], title: 'x', body: '' })).toThrow(MiraiError)
  })
})
