/**
 * ProfileService — who is making the anime (v2.1).
 *
 * Lives in the App DB (global), same discipline as credentials: it is identity,
 * not project data, so it survives creating/deleting projects and travels with
 * backups.
 *
 * The avatar is stored as a REAL FILE in the profile folder, not a base64 blob
 * in SQLite: a database is a bad place for megabytes of pixels, and a file can
 * be revealed/replaced without rewriting the row.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import {
  MiraiError,
  UserProfile,
  UserProfilePatch,
  type UserProfile as UserProfileType,
} from '@mirai/shared'
import type { Clock } from '../types'

/** Hard ceiling on an avatar — a selfie, not a magazine scan. */
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024
const AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const

/** Options of the ProfileService. */
export interface ProfileServiceOptions {
  /** Where avatars are stored as real files. */
  profileDir: string
  clock: Clock
}

interface ProfileRow {
  id: string
  display_name: string
  social_name: string
  company_name: string
  maker: string
  gender: string
  pronouns: string
  bio: string
  location: string
  website: string
  social: string
  avatar_path: string
  created_at: string
  updated_at: string
}

export class ProfileService {
  constructor(
    private readonly db: Database,
    private readonly opts: ProfileServiceOptions,
  ) {}

  /** The folder avatars live in — created on demand. */
  get dir(): string {
    return this.opts.profileDir
  }

  /**
   * The profile, created on first read. A fresh install must never be a
   * "no profile" error — the user has simply not filled it in yet.
   */
  get(): UserProfileType {
    const row = this.db.prepare('SELECT * FROM user_profile WHERE id = ?').get('local-user') as
      | ProfileRow
      | undefined
    if (!row) return this.create()
    return this.toProfile(row)
  }

  /** Creates the initial row for this machine (idempotent). */
  private create(): UserProfileType {
    const now = this.opts.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO user_profile
           (id, display_name, social_name, company_name, maker, gender, pronouns,
            bio, location, website, social, avatar_path, created_at, updated_at)
         VALUES (?, 'Newcomer', '', '', 'solo', '', '', '', '', '', '{}', '', ?, ?)`,
      )
      .run('local-user', now, now)
    return this.get()
  }

  /** Applies a patch; unknown fields are ignored, never stored. */
  patch(patch: UserProfilePatch): UserProfileType {
    const current = this.get()
    // Merge over defaults so an omitted field keeps its value — NEVER blind
    // defaults on update paths (lesson 18).
    const merged = UserProfile.parse({
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      id: 'local-user',
      createdAt: current.createdAt,
      updatedAt: this.opts.clock.isoNow(),
    })
    this.db
      .prepare(
        `UPDATE user_profile SET display_name = ?, social_name = ?, company_name = ?, maker = ?,
           gender = ?, pronouns = ?, bio = ?, location = ?, website = ?, social = ?,
           avatar_path = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        merged.displayName,
        merged.socialName,
        merged.companyName,
        merged.maker,
        merged.gender,
        merged.pronouns,
        merged.bio,
        merged.location,
        merged.website,
        JSON.stringify(merged.social),
        merged.avatarPath,
        merged.updatedAt,
        'local-user',
      )
    return merged
  }

  /**
   * Stores an avatar as a REAL file and returns its name.
   *
   * Validates the extension and the size BEFORE writing, replaces any previous
   * avatar, and orphans nothing: the old file is deleted only after the new one
   * is on disk.
   */
  setAvatar(bytes: Buffer, fileName: string): UserProfileType {
    if (bytes.byteLength === 0) throw new MiraiError('VALIDATION_ERROR', 'The avatar file is empty.')
    if (bytes.byteLength > MAX_AVATAR_BYTES) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `The avatar is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_AVATAR_BYTES / 1024 / 1024} MB.`,
      )
    }
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    if (!AVATAR_EXTENSIONS.includes(ext as (typeof AVATAR_EXTENSIONS)[number])) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Unsupported avatar type "${ext || '(none)'}" — use PNG, JPG, WebP or GIF.`,
      )
    }
    mkdirSync(this.opts.profileDir, { recursive: true })
    // A stable name per extension makes the row's avatar_path deterministic.
    const target = join(this.opts.profileDir, `avatar${ext}`)
    const previous = this.get().avatarPath
    writeFileSync(target, bytes)
    if (previous && previous !== `avatar${ext}`) {
      const oldFile = join(this.opts.profileDir, previous)
      if (existsSync(oldFile)) {
        try {
          unlinkSync(oldFile)
        } catch {
          // A leftover avatar must never break the update.
        }
      }
    }
    return this.patch({ avatarPath: `avatar${ext}` })
  }

  /** Absolute path of the avatar file — used by the asset protocol. */
  avatarAbsolutePath(): string | null {
    const rel = this.get().avatarPath
    if (!rel) return null
    const abs = join(this.opts.profileDir, rel)
    return existsSync(abs) && statSync(abs).isFile() ? abs : null
  }

  /** The avatar bytes, or null when the user has none. */
  avatarBytes(): Buffer | null {
    const abs = this.avatarAbsolutePath()
    return abs ? readFileSync(abs) : null
  }

  /** The PUBLIC card — no internal ids, safe to show anywhere. */
  publicCard() {
    const p = this.get()
    return {
      displayName: p.displayName,
      socialName: p.socialName,
      companyName: p.companyName,
      maker: p.maker,
      pronouns: p.pronouns,
      bio: p.bio,
      avatarPath: p.avatarPath,
    }
  }

  private toProfile(row: ProfileRow): UserProfileType {
    return UserProfile.parse({
      id: row.id,
      displayName: row.display_name,
      socialName: row.social_name,
      companyName: row.company_name,
      maker: row.maker,
      gender: row.gender,
      pronouns: row.pronouns,
      bio: row.bio,
      location: row.location,
      website: row.website,
      social: JSON.parse(row.social || '{}'),
      avatarPath: row.avatar_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  }
}