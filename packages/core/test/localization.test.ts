/**
 * v0.29 — Localization Lab (§18): per-scene translations with UNIQUE
 * (scene, language), statuses, coverage counts, the glossary term base
 * (UNIQUE source+language), the honest EPUB fallback, and the AI draft
 * schema at the boundary. All REAL round-trips.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError, SceneTranslationDraft, zLanguageTag } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { LocalizationService } from '../src/localization/localizationService'
import { EpubService } from '../src/production/epubService'
import { readZipEntries } from '../src/import/zip'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v29-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const localization = new LocalizationService(db, clock)
  const epub = new EpubService(dir, clock)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'Pilot' })
  return { dir, db, clock, creative, localization, epub, episode }
}

describe('translations (§18)', () => {
  it('upserts per (scene, language), updates in place, rejects bad input', () => {
    const env = makeEnv('crud')
    const scene = env.creative.createScene(env.episode.id, { title: 'Shrine' })

    const first = env.localization.upsertTranslation(scene.id, {
      language: 'pt-BR',
      screenplay: 'AYAKA\n"Você viu aquilo?"',
    })
    expect(first.status).toBe('DRAFT')

    // same language again = UPDATE, not a duplicate row
    const updated = env.localization.upsertTranslation(scene.id, {
      language: 'pt-BR',
      screenplay: 'AYAKA\n"Você viu isso?"',
      status: 'APPROVED',
    })
    expect(updated.screenplay).toContain('isso')
    expect(updated.status).toBe('APPROVED')
    expect(env.localization.listTranslations(scene.id)).toHaveLength(1)

    // second language coexists
    env.localization.upsertTranslation(scene.id, { language: 'ja', screenplay: 'アヤカ\n「見た？」' })
    expect(env.localization.listTranslations(scene.id)).toHaveLength(2)

    // validation: empty screenplay / bad language / bad status
    expect(() => env.localization.upsertTranslation(scene.id, { language: 'pt-BR', screenplay: '' })).toThrow(MiraiError)
    expect(() => env.localization.upsertTranslation(scene.id, { language: 'portuguese!', screenplay: 'x' })).toThrow(MiraiError)
    expect(() => env.localization.upsertTranslation(scene.id, { language: 'pt-BR', screenplay: 'x', status: 'MAYBE' as never })).toThrow(MiraiError)

    // delete is honest
    env.localization.deleteTranslation(scene.id, 'ja')
    expect(env.localization.listTranslations(scene.id)).toHaveLength(1)
    expect(() => env.localization.deleteTranslation(scene.id, 'ja')).toThrow(MiraiError)
  })

  it('cascades with the scene and reports coverage from live counts', () => {
    const env = makeEnv('coverage')
    const s1 = env.creative.createScene(env.episode.id, { title: 'a' })
    const s2 = env.creative.createScene(env.episode.id, { title: 'b' })
    env.localization.upsertTranslation(s1.id, { language: 'pt-BR', screenplay: 'traduzida' })
    env.localization.upsertTranslation(s2.id, { language: 'en-US', screenplay: 'translated' })

    const coverage = env.localization.coverage(2)
    expect(coverage).toEqual(
      expect.arrayContaining([
        { language: 'en-US', translated: 1, total: 2 },
        { language: 'pt-BR', translated: 1, total: 2 },
      ]),
    )
    expect(env.localization.listLanguages()).toEqual(['en-US', 'pt-BR'])

    // cascade: scene dies, translations die with it
    env.creative.deleteScene(s1.id)
    expect(env.localization.coverage(1).find((c) => c.language === 'pt-BR')).toBeUndefined()
  })

  it('effectiveScreenplay: translation when present, honest fallback otherwise', () => {
    const env = makeEnv('fallback')
    const translated = env.creative.createScene(env.episode.id, { title: 't', synopsis: 'original t' })
    const plain = env.creative.createScene(env.episode.id, { title: 'p', synopsis: 'original p' })
    env.localization.upsertTranslation(translated.id, { language: 'pt-BR', screenplay: 'TRADUZIDO' })

    const a = env.localization.effectiveScreenplay(translated.id, 'original t', 'pt-BR')
    expect(a).toEqual({ text: 'TRADUZIDO', translated: true })
    const b = env.localization.effectiveScreenplay(plain.id, 'original p', 'pt-BR')
    expect(b).toEqual({ text: 'original p', translated: false })
  })
})

describe('glossary (term base)', () => {
  it('upserts per (source, language) and keeps languages independent', () => {
    const env = makeEnv('glossary')
    const t1 = env.localization.upsertGlossary({ source: 'Lampião de Prata', target: 'Silver Lantern', language: 'en-US', notes: 'artifact name' })
    expect(t1.target).toBe('Silver Lantern')

    // same source + language = update
    const t2 = env.localization.upsertGlossary({ source: 'Lampião de Prata', target: 'The Silver Lamp', language: 'en-US' })
    expect(t2.id).toBe(t1.id)
    expect(t2.target).toBe('The Silver Lamp')
    expect(t2.notes).toBeNull() // omitted notes clear
    expect(env.localization.listGlossary('en-US')).toHaveLength(1)

    // same source, DIFFERENT language = separate term
    env.localization.upsertGlossary({ source: 'Lampião de Prata', target: 'ランプ', language: 'ja' })
    expect(env.localization.listGlossary()).toHaveLength(2)
    expect(env.localization.listGlossary('ja')).toHaveLength(1)

    expect(() => env.localization.upsertGlossary({ source: '', target: 'x', language: 'en-US' })).toThrow(MiraiError)
    env.localization.deleteGlossary(t2.id)
    expect(env.localization.listGlossary('en-US')).toHaveLength(0)
    expect(() => env.localization.deleteGlossary(t2.id)).toThrow(MiraiError)
  })
})

describe('translated EPUB export (integration)', () => {
  it('builds the book with translations and honest fallbacks', () => {
    const env = makeEnv('epub')
    const s1 = env.creative.createScene(env.episode.id, { title: 'Uma', synopsis: 'Texto original UM' })
    env.creative.createScene(env.episode.id, { title: 'Duas', synopsis: 'Texto original DOIS' })
    env.localization.upsertTranslation(s1.id, { language: 'pt-BR', screenplay: 'TRADUÇÃO UM', status: 'FINAL' })

    // the exact composition the IPC handler performs
    const chapters = env.creative.listEpisodes().map((ep) => {
      const sceneBodies = env.creative
        .listScenes(ep.id)
        .map((sc) => {
          const original = (sc.screenplay ?? sc.synopsis ?? '').trim()
          return env.localization.effectiveScreenplay(sc.id, original, 'pt-BR').text.trim()
        })
        .filter((b) => b.length > 0)
        .join('\n\n')
      return { title: `Capítulo ${ep.number}: ${ep.title}`, body: sceneBodies }
    })
    const result = env.epub.export({ title: 'Test Book (pt-BR)', author: 'A', language: 'pt-BR', chapters })

    expect(result.chapters).toBe(1)
    const byName = new Map(readZipEntries(readFileSync(result.path)).map((e) => [e.name, e.data.toString('utf8')]))
    const ch1 = byName.get('OEBPS/chapter1.xhtml')!
    expect(ch1).toContain('TRADUÇÃO UM') // the translation is used
    expect(ch1).toContain('Texto original DOIS') // the fallback is honest
    expect(ch1).not.toContain('Texto original UM') // original NOT used when translated
  })
})

describe('AI schema at the boundary', () => {
  it('SceneTranslationDraft accepts real translations only', () => {
    expect(SceneTranslationDraft.parse({ screenplay: 'AYAKA\n"Olá."' }).screenplay).toContain('Olá')
    expect(SceneTranslationDraft.safeParse({ screenplay: '' }).success).toBe(false)
    expect(SceneTranslationDraft.safeParse({}).success).toBe(false)
    expect(zLanguageTag.safeParse('pt-BR').success).toBe(true)
    expect(zLanguageTag.safeParse('pt BR!').success).toBe(false)
  })
})

