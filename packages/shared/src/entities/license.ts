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

/** The mature/adult block — hidden until Mature Content Mode (Pro) is on. */
export const MATURE_GENRES = [
  'Hentai',
  'Erotica',
  'Adult Drama',
  'Adult Romance',
  'Erotic Fantasy',
  'Erotic Drama',
  'Adult Comedy',
  'Adult Adventure',
  'Adult Fantasy',
  'Adult Isekai',
  'Adult Harem',
  'Adult Yuri',
  'Adult Yaoi',
  'Seduction',
  'Sensual Romance',
  'Explicit Romance',
  'Mature Themes',
  'Adult Horror',
  'Adult Sci-Fi',
  'Adult Thriller',
  'Bishoujo',
  'Biseinen',
  'Succubus',
  'Vampiric Romance',
] as const

/** Genres that require Mature Content Mode — filter against the setting. */
export function filterGenres(all: readonly string[], matureEnabled: boolean): string[] {
  const mature = new Set<string>(MATURE_GENRES)
  return all.filter((g) => matureEnabled || !mature.has(g))
}

/** True when a genre is part of the mature block (used for auto-rating hints). */
export function isMatureGenre(genre: string): boolean {
  return (MATURE_GENRES as readonly string[]).includes(genre)
}

/** Minimum rating treated as mature by the pipeline. */
export const MATURE_RATINGS: readonly string[] = ['18+']
export function isMatureRating(rating: string | null | undefined): boolean {
  return rating !== null && rating !== undefined && (MATURE_RATINGS as readonly string[]).includes(rating)
}


// ---------------------------------------------------------------- mature prompt pack

/** Built-in mature prompt entries — merged into the Prompt Library ONLY
 *  while Mature Content Mode is on. Adults-only policy applies to their use. */
export const MATURE_PROMPT_PACK: readonly {
  category: 'MANGA_PANEL' | 'CHARACTER' | 'SCENE' | 'ANIME_STYLE' | 'NEGATIVE' | 'STORY' | 'UTILITY'
  title: string
  body: string
  tags: string
}[] = [
  {
    category: 'ANIME_STYLE',
    title: 'Bishoujo sensual keyframe — adult heroine pinup',
    body: 'bishoujo adult heroine keyframe, sensual but tasteful framing, boudoir lighting, silk and lace costume details, soft rim light on skin, blush shading, inviting eye contact, romantic atmosphere, high-budget late-night anime aesthetic, all character design consistency rules apply',
    tags: 'mature, bishoujo, pinup, pro',
  },
  {
    category: 'SCENE',
    title: 'Intimate bedroom scene — emotional close-up',
    body: 'intimate scene, two adult characters, moonlit bedroom, tangled sheets, extreme close-up on intertwined fingers and lingering glances, warm skin tones against cool moonlight, slow breathing rhythm, tasteful framing focused on emotion over explicitness, cinematic depth of field',
    tags: 'mature, intimate, romance, pro',
  },
  {
    category: 'CHARACTER',
    title: 'Succubus character sheet — adult design',
    body: 'succubus character design sheet, adult woman, elegant horns and bat-wing motif, deep crimson and violet palette, corset and garter silhouette with high fantasy armor accents, confident smirk, tail curled playfully, three views (front, side, back), expression sheet, professional character design turnaround',
    tags: 'mature, succubus, character, pro',
  },
  {
    category: 'MANGA_PANEL',
    title: 'Seinen manga panel — adult drama beat',
    body: 'seinen manga panel, adult drama, high-contrast ink with dense screentone, two adults mid-argument in a rain-soaked alley, cigarette smoke curling through a streetlight, hard shadows on faces, dramatic low angle, seinen publication quality linework',
    tags: 'mature, seinen, drama, pro',
  },
  {
    category: 'NEGATIVE',
    title: 'Mature content negative — quality guard',
    body: 'negative prompt: childlike proportions, school uniforms in explicit contexts, deformed anatomy, extra limbs, watermark, text artifacts, plastic skin, uncanny eyes, oversaturated, jpeg artifacts',
    tags: 'mature, negative, quality, pro',
  },
  {
    category: 'STORY',
    title: 'Adult romance arc — confession & consequences',
    body: 'Outline an adult romance arc: two established adults with careers/lives, the confession scene as the mid-point pivot, one episode of slow-burn tension, a real obstacle (distance, rivalry, past), and an emotionally honest resolution. Keep every character explicitly adult and make the intimacy serve the character growth.',
    tags: 'mature, romance, story, pro',
  },
  {
    category: 'SCENE',
    title: 'Onsen episode — comedic sensuality',
    body: 'onsen bath scene, adult cast, steam curling over hot spring water, comedic timing with towel mishaps and strategic steam censorship, lantern glow at dusk, relaxed laughter, ecchi-comedy framing that stays playful, everyone visibly adult, evening anime episode aesthetic',
    tags: 'mature, onsen, ecchi, comedy, pro',
  },
  {
    category: 'UTILITY',
    title: 'Mature episode disclaimer template',
    body: 'This episode is intended for adult audiences (18+) and contains mature themes. All characters depicted are adults. Viewer discretion is advised.',
    tags: 'mature, disclaimer, utility, pro',
  },
]
