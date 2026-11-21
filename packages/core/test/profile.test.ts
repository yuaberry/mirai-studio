/**
 * ProfileService — who is making the anime (v2.1).
 *
 * The contract that matters:
 *   1. A FRESH install has a profile, not an error — a newcomer is a state,
 *      not a failure.
 *   2. A PATCH MERGES: an omitted field keeps its value (lesson 18 — never
 *      blind defaults on update paths).
 *   3. The AVATAR is a REAL FILE, validated for type and size BEFORE writing,
 *      and replacing one orphans nothing.
 *   4. The public card carries no internal ids.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MiraiError, UserProfile, preferredName } from '@mirai/shared'
import { ProfileService, MAX_AVATAR_BYTES } from '../src/profile/profileService'
import { APP_DB_MIGRATIONS } from '../src/db/migrations'
import { runMigrations } from '../src/db/migrator'

const clock = { isoNow: () => '2026-11-21T00:00:00.000Z', now: () => new Date('2026-11-21T00:00:00.000Z') }

/** A 1x1 PNG (real bytes — the service checks the decoded length). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function makeService() {
  const db = new Database(':memory:')
  runMigrations(db, APP_DB_MIGRATIONS)
  const profileDir = mkdtempSync(join(tmpdir(), 'mirai-profile-'))
  const service = new ProfileService(db, { profileDir, clock })
  return { service, db, profileDir }
}

describe('ProfileService', () => {
  let dirs: Array<{ service: ProfileService; db: Database.Database; profileDir: string }> = []

  const fresh = () => {
    const made = makeService()
    dirs.push(made)
    return made
  }

  beforeEach(() => {
    dirs = []
  })

  afterEach(() => {
    for (const d of dirs) {
      d.db.close()
      rmSync(d.profileDir, { recursive: true, force: true })
    }
  })

  it('a fresh install HAS a profile — a newcomer is a state, not an error', () => {
    const { service } = fresh()
    const profile = service.get()
    expect(profile.id).toBe('local-user')
    expect(profile.displayName).toBe('Newcomer')
    expect(UserProfile.parse(profile)).toEqual(profile)
  })

  it('a patch MERGES — an omitted field keeps its value', () => {
    const { service } = fresh()
    service.patch({ displayName: 'Haruka', bio: 'Makes sports anime.' })
    const after = service.patch({ socialName: 'Haru' })
    // The bio was NOT reset by the second patch — this is the lesson 18 bug.
    expect(after.displayName).toBe('Haruka')
    expect(after.bio).toBe('Makes sports anime.')
    expect(after.socialName).toBe('Haru')
  })

  it('stores an avatar as a real file and reports its name', () => {
    const { service, profileDir } = fresh()
    const after = service.setAvatar(PNG, 'selfie.png')

    expect(after.avatarPath).toBe('avatar.png')
    expect(existsSync(join(profileDir, 'avatar.png'))).toBe(true)
    expect(readFileSync(join(profileDir, 'avatar.png'))).toEqual(PNG)
    expect(service.avatarBytes()).toEqual(PNG)
    expect(service.avatarAbsolutePath()).toBe(join(profileDir, 'avatar.png'))
  })

  it('rejects an avatar with an unsupported type BEFORE writing anything', () => {
    const { service, profileDir } = fresh()
    try {
      service.setAvatar(PNG, 'photo.svg')
      expect.unreachable()
    } catch (err) {
      expect((err as MiraiError).code).toBe('VALIDATION_ERROR')
    }
    // Nothing was created — a rejected upload must not leave a file behind.
    expect(existsSync(join(profileDir, 'avatar.svg'))).toBe(false)
    expect(service.get().avatarPath).toBe('')
  })

  it('rejects an oversized avatar with the real limit in the message', () => {
    const { service } = fresh()
    const tooBig = Buffer.alloc(MAX_AVATAR_BYTES + 1)
    try {
      service.setAvatar(tooBig, 'big.png')
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toContain('8 MB')
    }
  })

  it('replacing an avatar orphans nothing', () => {
    const { service, profileDir } = fresh()
    service.setAvatar(PNG, 'first.png')
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=', 'base64')
    const after = service.setAvatar(jpeg, 'second.jpg')

    expect(after.avatarPath).toBe('avatar.jpg')
    expect(existsSync(join(profileDir, 'avatar.png'))).toBe(false)
    expect(existsSync(join(profileDir, 'avatar.jpg'))).toBe(true)
    // Exactly one avatar on disk.
    expect(readFileSync(join(profileDir, 'avatar.jpg'))).toEqual(jpeg)
  })

  it('the public card carries no internal ids and never throws', () => {
    const { service } = fresh()
    service.patch({ displayName: 'Zey', companyName: 'Hashimoto Studio', pronouns: 'she/her' })
    const card = service.publicCard()
    expect(card.displayName).toBe('Zey')
    expect(card.companyName).toBe('Hashimoto Studio')
    expect(Object.keys(card)).not.toContain('id')
    expect(JSON.stringify(card)).not.toContain('local-user')
  })

  it('survives a missing avatar folder (the row and the file disagree)', () => {
    const { service, profileDir } = fresh()
    service.setAvatar(PNG, 'a.png')
    rmSync(profileDir, { recursive: true, force: true })
    // The DB still names the file, but it is gone: honest null, not a crash.
    expect(service.avatarBytes()).toBeNull()
    expect(service.avatarAbsolutePath()).toBeNull()
  })
})

describe('preferredName', () => {
  // A stored record always has timestamps; the patch omits them. So a valid
  // base for these assertions carries the two the schema requires.
  const base = UserProfile.parse({ createdAt: '2026-11-21T00:00:00.000Z', updatedAt: '2026-11-21T00:00:00.000Z' })

  it('prefers the company name, then the social name, then the display name', () => {
    expect(preferredName({ ...base, displayName: 'Zey', socialName: 'Z', companyName: 'Studio' })).toBe('Studio')
    expect(preferredName({ ...base, displayName: 'Zey', socialName: 'Z' })).toBe('Z')
    expect(preferredName({ ...base, displayName: 'Zey' })).toBe('Zey')
    expect(preferredName({ ...base, displayName: '' })).toBe('Newcomer')
  })
})