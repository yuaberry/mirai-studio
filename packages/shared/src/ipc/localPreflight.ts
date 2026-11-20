/**
 * Local-generation preflight — the answer to "will my machine die trying this?".
 *
 * The app reads the local backend's GPU inventory and reports, in GIB, whether
 * the machine can actually do the job. An unusable GPU is diagnosed BEFORE the
 * user waits an hour and finds out through a frozen laptop.
 *
 * This is a MIRAI contract, not a vendor one: the shape is owned here and the
 * main process fills it in, so the renderer never parses a vendor's JSON.
 */
import { z } from 'zod'

/** The minimum VRAM the app considers usable for each capability. */
export const LOCAL_MIN_VRAM_IMAGE_GIB = 6
export const LOCAL_MIN_VRAM_VIDEO_GIB = 12

export const LocalPreflightResult = z.object({
  /** `false` = the app REFUSES, and `reason` says exactly what to do. */
  ok: z.boolean(),
  capability: z.enum(['image', 'video']),
  /** Total VRAM of the best GPU in bytes; `null` when the backend cannot report it. */
  vramTotalBytes: z.number().int().nonnegative().nullable().default(null),
  vramFreeBytes: z.number().int().nonnegative().nullable().default(null),
  /** GPU model as the driver names it, when the backend exposes it. */
  gpuName: z.string().nullable().default(null),
  /** How many bytes this capability needs. */
  requiredBytes: z.number().int().positive(),
  /** Measured checkpoint names the local backend has installed (A1111). */
  checkpoints: z.array(z.string()).default([]),
  reachable: z.boolean().default(false),
  reason: z.string().nullable().default(null),
})

export type LocalPreflightResult = z.infer<typeof LocalPreflightResult>