/**
 * MaturePolicy (Pro) — the hard safety rails of Mature Content Mode.
 *
 * The app's positioning is story-first: mature-rated projects unlock R-18
 * storytelling tools, but one line is enforced in CODE, not words:
 * explicit generation requires EVERY cast character to be an explicitly
 * stated adult. Minors and ambiguous ages never enter explicit contexts.
 */
import { MiraiError, isMatureRating, type CharacterRecord, type ProjectManifest } from '@mirai/shared'

const ADULT_KEYWORDS = ['adult', 'mature', 'of age', 'grown']
const MINOR_KEYWORDS = ['child', 'kid', 'minor', 'underage', 'loli', 'shota', 'toddler', 'teen', 'elementary', 'middle school', 'junior high', 'high school']

/** Parsed age outcome. */
export type AgeAssessment =
  | { kind: 'ADULT'; years: number | null }
  | { kind: 'MINOR'; years: number | null; reason: string }
  | { kind: 'AMBIGUOUS'; reason: string }

/** Assess a character's age string ("19", "17 anos", "adult", "unknown"). */
export function assessAge(age: string | null | undefined): AgeAssessment {
  const value = (age ?? '').trim().toLowerCase()
  if (value.length === 0) return { kind: 'AMBIGUOUS', reason: 'age not stated' }
  for (const kw of MINOR_KEYWORDS) {
    if (value.includes(kw)) return { kind: 'MINOR', years: null, reason: `states "${kw}"` }
  }
  const years = Array.from(value.matchAll(/\d+/g))
    .map((m) => Number(m[0]))
    .filter((n) => n > 0 && n < 200)
  if (years.length > 0) {
    const min = Math.min(...years)
    if (min < 18) return { kind: 'MINOR', years: min, reason: `age ${min}` }
    return { kind: 'ADULT', years: min }
  }
  for (const kw of ADULT_KEYWORDS) {
    if (value.includes(kw)) return { kind: 'ADULT', years: null }
  }
  return { kind: 'AMBIGUOUS', reason: `could not parse "${value}"` }
}

/**
 * Asserts that explicit (R-18) generation is allowed for the given cast.
 * Blocked when: no adult statement, a minor, or any ambiguous age.
 */
export function assertExplicitCastAllowed(cast: ReadonlyArray<CharacterRecord>): void {
  for (const character of cast) {
    const assessment = assessAge(character.age)
    if (assessment.kind === 'MINOR') {
      throw new MiraiError(
        'POLICY_VIOLATION',
        `Character "${character.name}" (${assessment.reason}) cannot appear in explicit content. This is a hard rule — mature mode is for adult stories, never minors.`,
      )
    }
    if (assessment.kind === 'AMBIGUOUS') {
      throw new MiraiError(
        'POLICY_VIOLATION',
        `Character "${character.name}" has no clearly adult age (${assessment.reason}). Set an explicit adult age (e.g. "21") on the character before generating explicit content.`,
      )
    }
  }
}

/** Whether the mature pipeline applies for a manifest + mature setting. */
export function maturePipelineActive(manifest: ProjectManifest, matureEnabled: boolean): boolean {
  return matureEnabled && isMatureRating(manifest.config.contentRating ?? null)
}
