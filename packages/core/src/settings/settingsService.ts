/**
 * SettingsService (kv-backed, default-merging) and CredentialStore
 * (encrypted at rest via the injected SecureCodec — spec §15).
 */
import {
  AppSettings,
  CREDENTIAL_KEYS,
  DEFAULT_APP_SETTINGS,
  MiraiError,
  type AppSettings as AppSettingsType,
  type CredentialKey,
} from '@mirai/shared'
import type { Database } from '../db/connection'
import { type Clock, type SecureCodec } from '../types'

const SETTINGS_KEY = 'app-settings'

export class SettingsService {
  constructor(private readonly db: Database) {}

  get(): AppSettingsType {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string } | undefined
    if (!row) return DEFAULT_APP_SETTINGS
    try {
      return AppSettings.parse(JSON.parse(row.value))
    } catch {
      // Corrupted settings fall back to defaults instead of breaking the app.
      return DEFAULT_APP_SETTINGS
    }
  }

  update(settings: AppSettingsType): AppSettingsType {
    const parsed = AppSettings.parse(settings)
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTINGS_KEY, JSON.stringify(parsed))
    return parsed
  }
}

export interface CredentialStatus {
  key: CredentialKey
  configured: boolean
  /** True when stored encrypted via OS-backed secure storage. */
  secure: boolean
}

interface CredentialRow {
  key: string
  data: Buffer
  secure: number
  created_at: string
  updated_at: string
}

/**
 * Stores secrets encrypted. The raw value NEVER crosses IPC — the renderer
 * only ever sees `CredentialStatus` (spec §15 "Nunca expor API keys").
 */
export class CredentialStore {
  constructor(
    private readonly db: Database,
    private readonly codec: SecureCodec,
    private readonly clock: Clock,
  ) {}

  set(key: CredentialKey, value: string): { secure: boolean } {
    const now = this.clock.isoNow()
    const encrypted = this.codec.encrypt(value)
    this.db
      .prepare(
        `INSERT INTO credentials (key, data, secure, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           data = excluded.data,
           secure = excluded.secure,
           updated_at = excluded.updated_at`,
      )
      .run(key, encrypted, this.codec.isSecure ? 1 : 0, now, now)
    return { secure: this.codec.isSecure }
  }

  /** Plaintext access — main-process internal use only (AI providers). */
  get(key: CredentialKey): string | null {
    const row = this.db
      .prepare('SELECT data FROM credentials WHERE key = ?')
      .get(key) as Pick<CredentialRow, 'data'> | undefined
    if (!row) return null
    try {
      return this.codec.decrypt(row.data)
    } catch {
      throw new MiraiError('CREDENTIALS_UNAVAILABLE', `Stored credential "${key}" could not be decrypted.`)
    }
  }

  clear(key: CredentialKey): void {
    this.db.prepare('DELETE FROM credentials WHERE key = ?').run(key)
  }

  status(): CredentialStatus[] {
    const rows = this.db
      .prepare('SELECT key, secure FROM credentials')
      .all() as Array<Pick<CredentialRow, 'key' | 'secure'>>
    const configured = new Map(rows.map((row) => [row.key, row.secure === 1]))
    return CREDENTIAL_KEYS.map((key) => ({
      key,
      configured: configured.has(key),
      secure: configured.get(key) === true,
    }))
  }
}
