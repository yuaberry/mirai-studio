/**
 * License entities (Pro subscription) — offline, Ed25519-signed license keys.
 *
 * A license key is `base64url(payloadJSON).base64url(signature)`:
 * the app embeds only the PUBLIC key and validates locally (local-first,
 * no server round-trip). The developer keeps the private key OFF the repo
 * and mints keys with `scripts/licensegen.mjs`.
 *
 * Feature flags gate premium capabilities — today: `mature` (the Mature
 * Content Mode). The license NEVER gates the core storytelling flow.
 */
import { z } from 'zod'

export const LICENSE_FEATURES = ['mature'] as const
export type LicenseFeature = (typeof LICENSE_FEATURES)[number]

/** Feature-flag description shown in the activation UI. */
export const FEATURE_LABEL: Record<LicenseFeature, string> = {
  mature: 'Mature Content Mode (R-18 storytelling tools)',
}

export const LICENSE_TIERS = ['pro'] as const
export type LicenseTier = (typeof LICENSE_TIERS)[number]

/** The signed payload (canonical JSON). */
export const LicensePayload = z.object({
  /** Format version. */
  v: z.literal(1),
  /** Who the key was minted for (email or name). */
  holder: z.string().min(1).max(120),
  tier: z.enum(LICENSE_TIERS),
  features: z.array(z.enum(LICENSE_FEATURES)).max(10),
  /** Issued-at / expiry as unix seconds (null = lifetime). */
  iat: z.number().int(),
  exp: z.number().int().nullable(),
})
export type LicensePayload = z.infer<typeof LicensePayload>

export const LicenseStatus = z.object({
  valid: z.boolean(),
  /** Human-readable reason when invalid. */
  reason: z.string().nullable(),
  payload: LicensePayload.nullable(),
  /** Whether a specific premium feature is unlocked. */
  hasFeature: z.function().returns(z.boolean()).optional(),
})
export type LicenseStatus = z.infer<typeof LicenseStatus>

/** App-level content settings (stored in AppSettings, defaults-safe). */
export const ContentSettings = z
  .object({
    /** The raw license key (validated on set; kept for re-validation on boot). */
    licenseKey: z.string().max(1_500).nullable().default(null),
    /** Last validated payload — null when not activated/expired. */
    license: LicensePayload.nullable().default(null),
    /** Mature Content Mode switch — only togglable with a valid `mature` license. */
    matureEnabled: z.boolean().default(false),
    /** When the user confirmed the 18+ responsibility notice (ISO date). */
    matureConfirmedAt: z.string().nullable().default(null),
  })
  .default({})
export type ContentSettings = z.infer<typeof ContentSettings>

/** Mature/18+ anime taxonomy additions (only visible with Mature Mode ON). */
export const MATURE_GENRES = ['Hentai', 'Erotica', 'Adult Drama'] as const

/** Genres that require Mature Content Mode — filter against the setting. */
export function filterGenres(all: readonly string[], matureEnabled: boolean): string[] {
  const mature = new Set<string>(MATURE_GENRES)
  return all.filter((g) => matureEnabled || !mature.has(g))
}

/** Minimum rating treated as mature by the pipeline. */
export const MATURE_RATINGS: readonly string[] = ['18+']
export function isMatureRating(rating: string | null | undefined): boolean {
  return rating !== null && rating !== undefined && (MATURE_RATINGS as readonly string[]).includes(rating)
}
