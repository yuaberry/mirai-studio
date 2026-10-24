/**
 * Visual Dev Lab (§7) — slice 1: the project MOODBOARD. Reference images
 * with captions and a user-picked palette color each; the board's color
 * strip IS the color script's first artifact. Images are real files in
 * the asset pipeline (mirai-asset:// previews).
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

export const MOODBOARD_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export const MoodboardItemInput = z.object({
  caption: z.string().max(500).optional(),
  /** Palette color (hex #rrggbb) — one swatch of the board's color script. */
  color: z
    .string()
    .regex(MOODBOARD_COLOR_RE, 'Color must be #rrggbb hex')
    .optional(),
})
export type MoodboardItemInput = z.input<typeof MoodboardItemInput>

export const MoodboardItem = z.object({
  id: zEntityId,
  imageAssetId: zEntityId,
  caption: z.string().nullable(),
  color: z.string().nullable(),
  orderIndex: z.number().int().min(0),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type MoodboardItem = z.infer<typeof MoodboardItem>
