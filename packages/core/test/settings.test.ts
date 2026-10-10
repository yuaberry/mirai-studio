import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
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
