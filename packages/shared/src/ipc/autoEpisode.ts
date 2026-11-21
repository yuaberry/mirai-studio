/**
 * The ONE-CLICK EPISODE contract.
 *
 * The user fills the IP form once and presses one button per episode: the
 * studio creates the next episode slot, runs the Producer Agent on it and
 * assembles it (voices → clips → render). One job, so an interruption parks it
 * and a resume only completes what is missing.
 *
 * This is deliberately NOT a "generate the whole season" button: no video model
 * today makes long video, so promising a season in one press would be a lie the
 * user pays for. One honest episode per press is what the app really does.
 */
import { z } from 'zod'
import { zEntityId } from '../ids'

/** Mirrors AutoproduceOptions' limits (shared/entities/producer.ts). */
export const AutoEpisodeRequest = z.object({
  /** The anime idea, in the user's own words. */
  idea: z.string().min(10, 'Describe your idea in at least a few words.').max(6_000),
  /** Season to add the episode to (default 1). */
  season: z.number().int().min(1).max(100).optional(),
  /** Target runtime in MINUTES, from the IP form. */
  targetMinutes: z.number().int().min(1).max(240).optional(),
  /** Draw keyframes for framed shots (needs an image provider). */
  generateFrames: z.boolean().default(true),
  /** Run the assembly after planning (uncheck to plan only). */
  assemble: z.boolean().default(true),
})
export type AutoEpisodeRequest = z.infer<typeof AutoEpisodeRequest>

export const AutoEpisodeResult = z.object({
  episodeId: zEntityId,
  episodeNumber: z.number().int().min(0),
  season: z.number().int().min(1),
  production: z.object({
    charactersCreated: z.number().int().min(0),
    scenesCreated: z.number().int().min(0),
    screenplaysDrafted: z.number().int().min(0),
    shotsCreated: z.number().int().min(0),
    framesGenerated: z.number().int().min(0),
    timelinesBuilt: z.number().int().min(0),
    steps: z.array(z.object({ step: z.string(), detail: z.string(), ok: z.boolean() })),
  }),
  assembly: z
    .object({
      scenes: z.number().int().min(0),
      shots: z.number().int().min(0),
      framesGenerated: z.number().int().min(0),
      voicesGenerated: z.number().int().min(0),
      videosGenerated: z.number().int().min(0),
      skippedNoDialogue: z.number().int().min(0),
      skippedNoFrame: z.number().int().min(0),
      rendered: z.string().nullable(),
    })
    .nullable(),
})
export type AutoEpisodeResult = z.infer<typeof AutoEpisodeResult>