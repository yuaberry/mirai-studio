/**
 * Episode runtime planner — the bridge between "how long is this episode?"
 * (the IP form) and "how many scenes and shots must the studio actually build?".
 *
 * WHY IT IS A PURE FUNCTION
 * -------------------------
 * This is the promise the IP form makes: the user types the episode length and
 * the studio produces something that fills it. If this math lived inside the
 * producer, it would only be verifiable by running a real (slow, rate-limited)
 * generation. As a pure function it is unit-tested and the answer is visible.
 *
 * THE HONEST CONSTRAINT (measured, not assumed)
 * ---------------------------------------------
 * No AI video model generates long video today: every backend this app drives
 * produces 3–15 second clips. So "a 24-minute episode" is *not* one
 * generation — it is ~100–200 clips, each animated, then stitched losslessly by
 * the app's existing renderer. This module says how many, so the UI can tell
 * the user the truth BEFORE they click generate.
 */

/** Average seconds of screen time one boarded shot carries. */
export const SECONDS_PER_SHOT = 8
/** Shots per scene in a normal broadcast rhythm (setup/detail/reaction/close). */
export const SHOTS_PER_SCENE = 4
/** Longest clip any video backend this app drives will produce. */
export const MAX_CLIP_SECONDS = 15

/** The hard ceiling on how much the Producer will build in ONE episode pass. */
export const MAX_AUTOPRODUCE_SCENES = 40
export const MAX_AUTOPRODUCE_SHOTS = 240

export interface EpisodePlan {
  /** Scenes the producer should create to fill the runtime. */
  scenesCount: number
  /** Shots per scene. */
  shotsPerScene: number
  /** Total shots across the episode. */
  shotsTotal: number
  /** Runtime the plan actually adds up to, in seconds. */
  estimatedSeconds: number
  /** Runtime the plan adds up to, in minutes (rounded, for display). */
  estimatedMinutes: number
  /**
   * How many separate VIDEO clips the episode needs, given that no backend
   * generates more than MAX_CLIP_SECONDS. This is the honest cost: the app
   * reports it so the user knows what they are asking for.
   */
  clipsNeeded: number
  /** True when the target was clamped because it exceeded the per-pass ceiling. */
  clamped: boolean
  /** The ceiling that clamped this plan, when `clamped` is true. */
  clampReason: string | null
}

/**
 * Plans scene/shot counts for a target runtime.
 *
 * `totalShotSeconds` is the sum of the durations the storyboard AI assigns
 * (0.5–30 s per shot); when it is unknown, SECONDS_PER_SHOT is used.
 */
export function planEpisodeFromRuntime(targetMinutes: number, totalShotSeconds?: number): EpisodePlan {
  const targetSeconds = Math.max(1, Math.min(240 * 60, Math.round(targetMinutes * 60)))

  // Shots needed = the runtime divided by what one shot carries.
  const perShot = totalShotSeconds && totalShotSeconds > 0 ? totalShotSeconds : SECONDS_PER_SHOT
  const wantedShots = Math.ceil(targetSeconds / perShot)
  const wantedScenes = Math.ceil(wantedShots / SHOTS_PER_SCENE)

  const shotsTotal = Math.min(wantedShots, MAX_AUTOPRODUCE_SHOTS)
  const scenesCount = Math.min(wantedScenes, MAX_AUTOPRODUCE_SCENES)
  const clamped = scenesCount < wantedScenes || shotsTotal < wantedShots

  // Recompute the real runtime of the CLAMPED plan.
  const shotsInPlan = Math.min(shotsTotal, scenesCount * SHOTS_PER_SCENE)
  const estimatedSeconds = Math.round(shotsInPlan * perShot)

  return {
    scenesCount,
    shotsPerScene: SHOTS_PER_SCENE,
    shotsTotal: shotsInPlan,
    estimatedSeconds,
    estimatedMinutes: Math.max(1, Math.round(estimatedSeconds / 60)),
    // Each shot of N seconds costs ceil(N / MAX_CLIP_SECONDS) clips.
    clipsNeeded: shotsInPlan * Math.ceil(perShot / MAX_CLIP_SECONDS),
    clamped,
    clampReason: clamped
      ? `The studio builds up to ${MAX_AUTOPRODUCE_SCENES} scenes / ${MAX_AUTOPRODUCE_SHOTS} shots per ` +
        `episode pass. ${wantedScenes} scenes were requested — the plan is capped, so this pass ` +
        `covers ${Math.round(estimatedSeconds / 60)} minutes. Re-run on the same episode for the rest, ` +
        `or split the episode into parts.`
      : null,
  }
}

/** A human summary the UI can print verbatim. */
export function describeEpisodePlan(plan: EpisodePlan): string {
  const minutes = Math.floor(plan.estimatedSeconds / 60)
  const seconds = plan.estimatedSeconds % 60
  return (
    `${plan.scenesCount} scenes · ${plan.shotsTotal} shots · ~${minutes}m${String(seconds).padStart(2, '0')}s of screen time ` +
    `· ${plan.clipsNeeded} video clips to animate` +
    (plan.clamped ? ` · CAPPED: ${plan.clampReason}` : '')
  )
}