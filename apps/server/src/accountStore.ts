/**
 * AccountStore — who may publish, and what they may revoke.
 *
 * The first collaboration release proved the pipeline: publish, browse,
 * download, import. What it could NOT do was answer "who did this?" or "take
 * my projects down". That is what this adds.
 *
 * DESIGN HONESTY
 * --------------
 * · Passwords are stored with scrypt + a per-account salt, NEVER in clear.
 *   The digest never leaves the store.
 * · Sessions are opaque random tokens with an EXPIRY, stored server-side, so a
 *   user can revoke them (logout, revoke all) — which is the whole point of
 *   having accounts instead of the per-project token from v2.1.
 * · The legacy per-project token STILL WORKS: it is now a second, independent
 *   credential. Breaking existing published projects to add accounts would be
 *   a needless migration for a beta.
 * · Publishing still does not require an account: an anonymous maker keeps
 *   their project. Accounts add OWNERSHIP and REVOCATION, not a gate.
 */
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const HANDLE_RE = /^[a-zA-Z0-9_.-]{3,40}$/

export interface AccountRow {
  id: string
  handle: string
  createdAt: string
}

export interface SessionRow {
  token: string
  accountId: string
  createdAt: string
  expiresAt: string
}

export class AccountStore {
  private readonly db: DatabaseSync

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'accounts.sqlite'))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL,
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);
    `)
  }

  get path(): string {
    return this.dir
  }

  /** Registers an account. The password is hashed before it touches disk. */
  register(handle: string, password: string): { id: string; handle: string } {
    const trimmed = handle.trim()
    if (!HANDLE_RE.test(trimmed)) {
      throw new Error(
        'A handle needs 3-40 characters: letters, numbers, dot, dash or underscore.',
      )
    }
    if (password.length < 8) {
      throw new Error('A password needs at least 8 characters.')
    }
    const salt = randomBytes(16).toString('hex')
    const digest = this.hashPassword(password, salt)
    const id = randomId()
    try {
      this.db
        .prepare('INSERT INTO accounts (id, handle, salt, digest, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, trimmed, salt, digest, new Date().toISOString())
    } catch {
      throw new Error(`The handle "${trimmed}" is already taken.`)
    }
    return { id, handle: trimmed }
  }

  /** Verifies credentials and opens a session, or throws. */
  login(handle: string, password: string): { token: string; handle: string } {
    const row = this.db
      .prepare('SELECT id, handle, salt, digest FROM accounts WHERE handle = ?')
      .get(handle.trim()) as
      | { id: string; handle: string; salt: string; digest: string }
      | undefined
    // Always run the hash, even for an unknown handle, so a missing account
    // costs the same time as a wrong password (no user enumeration by timing).
    const salt = row?.salt ?? 'x'.repeat(32)
    const expected = row?.digest ?? 'y'.repeat(64)
    const actual = this.hashPassword(password, salt)
    if (!row || !constantEqual(expected, actual)) {
      throw new Error('Wrong handle or password.')
    }
    const token = randomBytes(32).toString('hex')
    const now = Date.now()
    this.db
      .prepare(
        'INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        token,
        row.id,
        new Date(now).toISOString(),
        new Date(now + SESSION_TTL_MS).toISOString(),
      )
    return { token, handle: row.handle }
  }

  /** Resolves a token to an account, or null when it is expired/unknown. */
  resolve(token: string): AccountRow | null {
    if (typeof token !== 'string' || token.length === 0) return null
    const row = this.db
      .prepare(
        `SELECT s.token, s.account_id, s.expires_at, a.handle, a.created_at
           FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ?`,
      )
      .get(token) as { token: string; account_id: string; expires_at: string; handle: string; created_at: string } | undefined
    if (!row) return null
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
      return null
    }
    return { id: row.account_id, handle: row.handle, createdAt: row.created_at }
  }

  /** Closes ONE session. */
  logout(token: string): boolean {
    if (!token) return false
    const result = this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return Number(result.changes) > 0
  }

  /**
   * Closes EVERY session of an account — the revocation a user asks for when
   * a laptop is lost. Returns how many were closed.
   */
  revokeAllSessions(handle: string): number {
    const row = this.db.prepare('SELECT id FROM accounts WHERE handle = ?').get(handle.trim()) as
      | { id: string }
      | undefined
    if (!row) return 0
    const result = this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(row.id)
    return Number(result.changes)
  }

  /** Lists sessions of an account (no token material — just expiry). */
  listSessions(handle: string): Array<{ expiresAt: string }> {
    const row = this.db.prepare('SELECT id FROM accounts WHERE handle = ?').get(handle.trim()) as
      | { id: string }
      | undefined
    if (!row) return []
    const rows = this.db
      .prepare('SELECT expires_at FROM sessions WHERE account_id = ? ORDER BY expires_at DESC')
      .all(row.id) as Array<{ expires_at: string }>
    return rows.map((r) => ({ expiresAt: r.expires_at }))
  }

  /** The public card — a handle, never a password digest. */
  publicCard(handle: string): { handle: string; createdAt: string } | null {
    const row = this.db
      .prepare('SELECT handle, created_at FROM accounts WHERE handle = ?')
      .get(handle.trim()) as { handle: string; created_at: string } | undefined
    return row ? { handle: row.handle, createdAt: row.created_at } : null
  }

  close(): void {
    this.db.close()
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex')
  }
}

function randomId(): string {
  return randomBytes(12).toString('hex')
}

function constantEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  let diff = 0
  for (let i = 0; i < bufA.length; i += 1) diff |= bufA[i]! ^ bufB[i]!
  return diff === 0
}