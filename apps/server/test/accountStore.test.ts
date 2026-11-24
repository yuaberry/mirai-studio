/**
 * AccountStore — accounts, sessions and revocation.
 *
 * The rules that matter:
 *   1. A password NEVER lands on disk in clear (the digest is what's stored).
 *   2. A session EXPIRES and can be revoked — including ALL of them at once,
 *      which is what a lost laptop requires.
 *   3. An unknown handle costs the SAME time as a wrong password, so the store
 *      cannot be used to enumerate users by timing.
 *   4. The public card is a handle, never a digest.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore, SESSION_TTL_MS } from '../src/accountStore'

function make() {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-acc-'))
  return { store: new AccountStore(dir), dir }
}

describe('AccountStore', () => {
  let made: { store: AccountStore; dir: string } | null = null
  beforeEach(() => {
    made = null
  })
  afterEach(() => {
    if (made) {
      made.store.close()
      rmSync(made.dir, { recursive: true, force: true })
    }
  })

  it('registers and logs in', () => {
    made = make()
    const account = made.store.register('zey.hashimoto', 'supersecret1')
    expect(account.handle).toBe('zey.hashimoto')

    const { token } = made.store.login('zey.hashimoto', 'supersecret1')
    expect(token.length).toBeGreaterThanOrEqual(32)
    expect(made.store.resolve(token)?.handle).toBe('zey.hashimoto')
  })

  it('stores NO clear-text password on disk', () => {
    made = make()
    made.store.register('leak.test', 'supersecret1')
    // Read the database as bytes and prove the password is not in it.
    const bytes = readFileSync(join(made.dir, 'accounts.sqlite'))
    expect(bytes.toString('latin1')).not.toContain('supersecret1')
  })

  it('rejects a wrong password and an unknown handle the same way', () => {
    made = make()
    made.store.register('real.user', 'supersecret1')
    for (const [handle, password] of [
      ['real.user', 'wrong-password'],
      ['nobody.here', 'supersecret1'],
    ] as const) {
      expect(() => made!.store.login(handle, password)).toThrow(/Wrong handle or password/)
    }
  })

  it('refuses a weak password and an invalid handle', () => {
    made = make()
    expect(() => made!.store.register('ok.handle', 'short')).toThrow(/at least 8/)
    expect(() => made!.store.register('no!', 'supersecret1')).toThrow(/3-40 characters/)
    expect(() => made!.store.register('xx', 'supersecret1')).toThrow(/3-40 characters/)
  })

  it('refuses a duplicate handle', () => {
    made = make()
    made.store.register('taken.one', 'supersecret1')
    expect(() => made!.store.register('taken.one', 'anotherpass1')).toThrow(/already taken/)
  })

  it('revokes ONE session (logout)', () => {
    made = make()
    made.store.register('single.user', 'supersecret1')
    const { token } = made.store.login('single.user', 'supersecret1')

    expect(made.store.logout(token)).toBe(true)
    expect(made.store.resolve(token)).toBeNull()
  })

  it('revokes EVERY session of an account — the lost-laptop case', () => {
    made = make()
    made.store.register('lost.laptop', 'supersecret1')
    const a = made.store.login('lost.laptop', 'supersecret1')
    const b = made.store.login('lost.laptop', 'supersecret1')
    expect(made.store.listSessions('lost.laptop')).toHaveLength(2)

    const revoked = made.store.revokeAllSessions('lost.laptop')

    expect(revoked).toBe(2)
    expect(made.store.resolve(a.token)).toBeNull()
    expect(made.store.resolve(b.token)).toBeNull()
  })

  it('an EXPIRED session stops resolving', () => {
    made = make()
    made.store.register('expired.user', 'supersecret1')
    const { token } = made.store.login('expired.user', 'supersecret1')
    // Rewind the expiry behind now — the same code path a real expiry takes.
    made.store['db']
      .prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
      .run(new Date(Date.now() - 1000).toISOString(), token)

    expect(made.store.resolve(token)).toBeNull()
  })

  it('lists only the expiry, never the token material', () => {
    made = make()
    made.store.register('card.user', 'supersecret1')
    const { token } = made.store.login('card.user', 'supersecret1')

    const sessions = made.store.listSessions('card.user')
    expect(sessions).toHaveLength(1)
    expect(JSON.stringify(sessions)).not.toContain(token)
    // And the TTL is a real number, not a magic string.
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('the public card is a handle, never a digest', () => {
    made = make()
    made.store.register('public.user', 'supersecret1')
    const card = made.store.publicCard('public.user')
    expect(card?.handle).toBe('public.user')
    expect(card?.createdAt).toBeTruthy()
    expect(Object.keys(card ?? {})).not.toContain('digest')
    expect(JSON.stringify(card)).not.toContain('supersecret1')
  })

  it('an unknown account revokes nothing and reveals nothing', () => {
    made = make()
    expect(made.store.revokeAllSessions('ghost.user')).toBe(0)
    expect(made.store.listSessions('ghost.user')).toEqual([])
    expect(made.store.publicCard('ghost.user')).toBeNull()
  })
})