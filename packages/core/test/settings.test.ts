import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError, AppSettingsPatch } from '@mirai/shared'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { APP_DB_MIGRATIONS } from '../src/db/migrations'
import { CredentialStore, SettingsService } from '../src/settings/settingsService'
import { plaintextCodec } from '../src/types'
import { makeClock, fakeSecureCodec } from './helpers'

function makeDb(name: string) {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), `mirai-settings-${name}-`)), 'app.sqlite'))
  runMigrations(db, APP_DB_MIGRATIONS)
  return db
}

describe('SettingsService', () => {
  it('returns defaults when nothing is stored', () => {
    const db = makeDb('defaults')
    const settings = new SettingsService(db).get()
    expect(settings.general.locale).toBe('en')
    expect(settings.general.autosaveIntervalMs).toBe(5_000)
    expect(settings.ai.temperature).toBe(0.7)
    expect(settings.ai.streaming).toBe(true)
    db.close()
  })

  it('persists updates and survives a restart (same DB)', () => {
    const db = makeDb('persist')
    const service = new SettingsService(db)
    const current = service.get()
    service.update({ ...current, ai: { ...current.ai, temperature: 0.2, maxTokens: 8_192 } })

    const reloaded = new SettingsService(db).get()
    expect(reloaded.ai.temperature).toBe(0.2)
    expect(reloaded.ai.maxTokens).toBe(8_192)
    expect(reloaded.general.locale).toBe('en')
    db.close()
  })

  it('falls back to defaults on corrupted stored JSON', () => {
    const db = makeDb('corrupt')
    db.prepare("INSERT INTO settings (key, value) VALUES ('app-settings', 'not json')").run()
    expect(new SettingsService(db).get().general.locale).toBe('en')
    db.close()
  })

  it('rejects invalid settings via zod', () => {
    const db = makeDb('invalid')
    const service = new SettingsService(db)
    const current = service.get()
    expect(() =>
      service.update({ ...current, general: { ...current.general, autosaveIntervalMs: 1 } }),
    ).toThrow()
    db.close()
  })

  it('patch() never clobbers sections it does not touch (license survival)', () => {
    const db = makeDb('patch-protects')
    const service = new SettingsService(db)

    // "Activate" a license the way license:activate does (full write).
    const withLicense = service.get()
    const license = {
      v: 1 as const,
      holder: 'yuaberry — Mirai Studio Founder',
      tier: 'pro' as const,
      features: ['mature'] as ['mature'],
      iat: 1_791_584_273,
      exp: 2_106_944_273,
    }
    service.update({
      ...withLicense,
      content: { licenseKey: 'founder-key', license, matureEnabled: true, matureConfirmedAt: '2026-10-11T18:10:36.728Z' },
    })

    // A STALE renderer saves General — patch sends ONLY general+appearance.
    // The old full-object writer would have wiped the license to defaults.
    service.patch({
      general: { ...withLicense.general, locale: 'pt-BR' },
      appearance: { ...withLicense.appearance, uiScale: 1.1 },
    })

    const after = service.get()
    expect(after.general.locale).toBe('pt-BR')
    expect(after.appearance.uiScale).toBe(1.1)
    expect(after.content.licenseKey).toBe('founder-key') // SURVIVED ✓
    expect(after.content.matureEnabled).toBe(true) // SURVIVED ✓
    expect(after.content.license?.holder).toBe(license.holder)

    // The patch schema itself refuses/ignores content — the renderer cannot
    // even express a content write through settings:update.
    const patched = AppSettingsPatch.safeParse({ content: { licenseKey: 'hacked' } })
    expect(patched.success).toBe(true)
    if (patched.success) expect('content' in patched.data).toBe(false)
    db.close()
  })

  it('persists every theme (v0.17) and the custom accent color', () => {
    const db = makeDb('themes')
    const service = new SettingsService(db)
    for (const theme of ['dark', 'black', 'light', 'sakura', 'custom'] as const) {
      service.patch({
        appearance: {
          ...service.get().appearance,
          theme,
          customAccent: theme === 'custom' ? '#22d3ee' : null,
        },
      })
      const after = service.get()
      expect(after.appearance.theme).toBe(theme)
      expect(after.appearance.customAccent).toBe(theme === 'custom' ? '#22d3ee' : null)
    }
    // Invalid hex rejected by the schema -> patch refuses the whole write.
    expect(() =>
      service.patch({ appearance: { ...service.get().appearance, theme: 'custom', customAccent: 'blue' } }),
    ).toThrow()
    db.close()
  })

  it('patch() persists session state across a restart (same DB)', () => {
    const db = makeDb('patch-session')
    const service = new SettingsService(db)
    service.patch({
      session: {
        lastViewByProject: { proj_1: 'timeline', proj_2: 'production' },
        lastProjectPath: '/home/user/MiraiProjects/demo',
      },
    })

    // "Restart" — a fresh service over the same DB.
    const reloaded = new SettingsService(db).get()
    expect(reloaded.session.lastViewByProject['proj_1']).toBe('timeline')
    expect(reloaded.session.lastViewByProject['proj_2']).toBe('production')
    expect(reloaded.session.lastProjectPath).toBe('/home/user/MiraiProjects/demo')

    // A patch on ANOTHER section leaves session untouched.
    service.patch({ general: { ...reloaded.general, locale: 'pt-BR' } })
    const final = new SettingsService(db).get()
    expect(final.session.lastProjectPath).toBe('/home/user/MiraiProjects/demo')
    expect(final.session.lastViewByProject).toEqual({ proj_1: 'timeline', proj_2: 'production' })
    db.close()
  })
})

describe('CredentialStore', () => {
  it('stores, reads and clears a credential through a secure codec', () => {
    const db = makeDb('secure')
    const store = new CredentialStore(db, fakeSecureCodec, makeClock())
    expect(store.get('openrouter')).toBeNull()

    const { secure } = store.set('openrouter', 'sk-or-test-123')
    expect(secure).toBe(true)
    expect(store.get('openrouter')).toBe('sk-or-test-123')

    const raw = db
      .prepare('SELECT data FROM credentials WHERE key = ?')
      .get('openrouter') as { data: Buffer }
    expect(raw.data.toString('utf8')).not.toContain('sk-or-test-123')

    store.clear('openrouter')
    expect(store.get('openrouter')).toBeNull()
    db.close()
  })

  it('reports status for all known keys, never the value', () => {
    const db = makeDb('status')
    const store = new CredentialStore(db, fakeSecureCodec, makeClock())
    store.set('openrouter', 'value')
    const status = store.status()
    expect(status).toEqual([
      { key: 'openrouter', configured: true, secure: true },
      { key: 'nvidia', configured: false, secure: false },
      { key: 'image', configured: false, secure: false },
      { key: 'videogen', configured: false, secure: false },
      { key: 'tts', configured: false, secure: false },
    ])
    db.close()
  })

  it('flags plaintext fallback storage as insecure', () => {
    const db = makeDb('insecure')
    const store = new CredentialStore(db, plaintextCodec, makeClock())
    const { secure } = store.set('openrouter', 'v')
    expect(secure).toBe(false)
    expect(store.status()[0]?.secure).toBe(false)
    db.close()
  })

  it('throws a MiraiError when decryption fails', () => {
    const db = makeDb('decrypt-fail')
    const store = new CredentialStore(db, fakeSecureCodec, makeClock())
    store.set('openrouter', 'will-be-corrupted')
    db.prepare('UPDATE credentials SET data = ? WHERE key = ?').run(Buffer.from('garbage'), 'openrouter')
    expect(() => store.get('openrouter')).toThrow(MiraiError)
    db.close()
  })
})
