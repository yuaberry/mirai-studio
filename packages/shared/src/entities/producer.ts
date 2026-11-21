/**
 * Producer Agent entities (v0.10) — the autopilot that takes a one-line
 * anime idea and produces a full episode: bible → characters → scenes →
 * screenplays → storyboard shots → (frames) → timelines.
 */
import { z } from 'zod'
import { CHARACTER_ROLES, TIMES_OF_DAY } from './creative'
import { SHOT_TYPES, LENS_PRESETS as LENSES, CAMERA_MOVEMENTS } from './storyboard'

export const AutoproduceOptions = z.object({
  /** The user's anime idea, in their own words. */
  idea: z.string().min(10, 'Describe your idea in at least a few words.').max(6_000),
  /**
   * Scenes to plan for the episode.
   *
   * The ceiling is 12, not 8: one "episode pass" must be able to fill a
   * meaningful chunk of the `episodeLengthMinutes` the IP form promises. A
   * 12-scene × 4-shot pass is ~6.4 minutes of screen time — enough to be
   * useful, and small enough that ONE planning call still fits a free-tier
   * model's output budget (lesson: a bigger scene list truncates the JSON and
   * the whole pass fails).
   */
  scenesCount: z.number().int().min(2).max(12).default(4),
  /** Shots per scene (2-8). */
  shotsPerScene: z.number().int().min(2).max(8).default(4),
  /**
   * Target episode runtime in MINUTES, from the IP form
   * (`episodeLengthMinutes`).
   *
   * When present and `scenesCount` was not given explicitly, the studio
   * derives the scene count that fills it (see `planEpisodeFromRuntime`) —
   * so filling the IP form is enough; the user never counts scenes by hand.
   */
  targetMinutes: z.number().int().min(1).max(240).optional(),
  /** Also generate keyframes per shot when an image provider is configured. */
  generateFrames: z.boolean().default(false),
  /** Episode number to produce into (defaults to the next free slot). */
  episodeNumber: z.number().int().min(0).max(10_000).optional(),
})
export type AutoproduceOptions = z.infer<typeof AutoproduceOptions>

// ------------------------------------------------------------- model plans

export const BibleDraftPlan = z.object({
  premise: z.string().min(1).max(4_000),
  themes: z.array(z.string().max(200)).max(10),
  tone: z.string().max(2_000),
  message: z.string().max(2_000),
  genreNotes: z.string().max(2_000),
})
export type BibleDraftPlan = z.infer<typeof BibleDraftPlan>

export const CharacterPlan = z.object({
  name: z.string().min(1).max(80),
  role: z.enum(CHARACTER_ROLES).catch('SUPPORTING'),
  age: z.string().max(40),
  appearance: z.string().max(4_000),
  personality: z.string().max(4_000),
  goals: z.string().max(4_000),
  voice: z.string().max(2_000),
})
export type CharacterPlan = z.infer<typeof CharacterPlan>

export const CharacterPlanList = z
  .object({ characters: z.array(CharacterPlan).min(1).max(8) })
  .transform((v) => v.characters)

export const ScenePlan = z.object({
  title: z.string().min(1).max(160),
  synopsis: z.string().max(2_000),
  timeOfDay: z.enum(TIMES_OF_DAY).catch('UNSPECIFIED'),
  locationName: z.string().max(120),
  castNames: z.array(z.string().max(80)).max(8).default([]),
})
export type ScenePlan = z.infer<typeof ScenePlan>

/**
 * The scene-plan the storyboard/director model returns.
 *
 * The cap is 12, and it MUST match `AutoproduceOptions.scenesCount`'s cap: the
 * runtime planner can ask for up to 12 scenes, and a model that obeys would be
 * rejected by a smaller ceiling here. MEASURED: the one-click episode E2E
 * failed exactly this way ("Array must contain at most 8 element(s)") when the
 * two limits disagreed.
 */
export const ScenePlanList = z
  .object({ scenes: z.array(ScenePlan).min(1).max(12) })
  .transform((v) => v.scenes)

/** v0.18: full-season episode plan extracted from the author's document. */
export const SeasonEpisodePlan = z.object({
  number: z.number().int().min(1).max(200),
  title: z.string().min(1).max(160),
  synopsis: z.string().min(1).max(1_200),
})
export type SeasonEpisodePlan = z.infer<typeof SeasonEpisodePlan>

export const SeasonPlanList = z
  .object({ episodes: z.array(SeasonEpisodePlan).min(1).max(24) })
  .transform((v) => v.episodes)

export const ShotPlan = z.object({
  title: z.string().min(1).max(160),
  shotType: z.enum(SHOT_TYPES).catch('MEDIUM'),
  lens: z.enum(LENSES).catch('50mm'),
  cameraMovement: z.enum(CAMERA_MOVEMENTS).catch('STATIC'),
  durationSeconds: z.number().min(0.5).max(30).catch(3),
  dialogue: z.string().max(4_000).optional(),
})
export type ShotPlan = z.infer<typeof ShotPlan>

export const ShotPlanList = z
  .object({ shots: z.array(ShotPlan).min(1).max(10) })
  .transform((v) => v.shots)

// ------------------------------------------------------------- result

export const AutoproduceSummary = z.object({
  bibleDrafted: z.boolean(),
  charactersCreated: z.number().int(),
  scenesCreated: z.number().int(),
  screenplaysDrafted: z.number().int(),
  shotsCreated: z.number().int(),
  framesGenerated: z.number().int(),
  timelinesBuilt: z.number().int(),
  episodeTitle: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      detail: z.string().max(500),
      ok: z.boolean(),
    }),
  ).max(30),
})
export type AutoproduceSummary = z.infer<typeof AutoproduceSummary>
