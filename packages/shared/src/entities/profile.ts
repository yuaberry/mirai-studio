/**
 * User profiles (v2.1) — who is making the anime.
 *
 * The IP form describes a WORLD; this describes the PERSON behind it. The app
 * is local-first, so the profile lives in the App DB (global, not per project)
 * and travels with backups — the same discipline as credentials.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * This is the *identity layer*: name, social name, company name, gender,
 * pronouns, avatar, bio and links. It is the foundation a future collaboration
 * layer builds on (publishing projects, working together), and it is shipped
 * because pretending to ship the collaboration itself without a server would be
 * a fake button. The entity, service and UI are real and tested; the sync is
 * documented as the next step (see docs/profile.md).
 */
import { z } from 'zod'

/** Gender as the user states it — free text, never a closed enum. */
export const GENDER_OPTIONS = [
  'woman',
  'man',
  'non-binary',
  'transgender-woman',
  'transgender-man',
  'agender',
  'genderfluid',
  'intersex',
  'other',
  'prefer-not-to-say',
] as const

export const UserProfile = z.object({
  id: z.string().min(1).max(80).default('local-user'),
  /** The name the studio itself shows (can be a nickname). */
  displayName: z.string().min(1).max(80).default('Newcomer'),
  /** Social name — the name the person actually uses. Optional, never forced. */
  socialName: z.string().max(80).optional().default(''),
  /** Company / studio name — for professional work. */
  companyName: z.string().max(120).optional().default(''),
  /**
   * What kind of maker this is. Drives which name appears where:
   * 'solo' → displayName/socialName, 'studio' → companyName.
   */
  maker: z.enum(['solo', 'studio', 'collective']).default('solo'),
  gender: z.string().max(40).optional().default(''),
  pronouns: z.string().max(40).optional().default(''),
  /** One-line bio shown in the app's About/credits. */
  bio: z.string().max(1_000).optional().default(''),
  location: z.string().max(120).optional().default(''),
  /** Website / portfolio. */
  website: z.string().max(200).optional().default(''),
  /** Social handles as the user writes them (no URL guessing). */
  social: z.record(z.string().max(40), z.string().max(200)).optional().default({}),
  /** File name of the avatar INSIDE the profile folder (not a data URI). */
  avatarPath: z.string().max(200).optional().default(''),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
export type UserProfile = z.infer<typeof UserProfile>

/** What the user can actually change (ids and timestamps are server-owned). */
export const UserProfilePatch = UserProfile.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial()
export type UserProfilePatch = z.infer<typeof UserProfilePatch>

/** The public card — safe to show to anyone, no internal ids. */
export const PublicProfileCard = z.object({
  displayName: z.string(),
  socialName: z.string(),
  companyName: z.string(),
  maker: z.enum(['solo', 'studio', 'collective']),
  pronouns: z.string(),
  bio: z.string(),
  avatarPath: z.string(),
})
export type PublicProfileCard = z.infer<typeof PublicProfileCard>

/** How the studio addresses this person, in one function. */
export function preferredName(profile: UserProfile): string {
  if (profile.companyName.trim().length > 0) return profile.companyName.trim()
  if (profile.socialName.trim().length > 0) return profile.socialName.trim()
  return profile.displayName.trim() || 'Newcomer'
}