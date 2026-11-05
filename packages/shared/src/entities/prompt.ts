/**
 * Prompt Library — curated, reusable generation prompts (manga panels,
 * character sheets, scenes, styles, negative prompts). Mangá/anime-focused:
 * this is the creative toolbox the user keeps, tweaks and reuses with the
 * AI Assist and (Phase 3+) image/video pipelines.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

export const PROMPT_CATEGORIES = [
  'MANGA_PANEL',
  'CHARACTER',
  'SCENE',
  'ANIME_STYLE',
  'NEGATIVE',
  'STORY',
  'UTILITY',
] as const
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number]
export const zPromptCategory = z.enum(PROMPT_CATEGORIES)

export const PROMPT_CATEGORY_LABEL: Record<PromptCategory, string> = {
  MANGA_PANEL: 'Manga Panel',
  CHARACTER: 'Character',
  SCENE: 'Scene',
  ANIME_STYLE: 'Anime Style',
  NEGATIVE: 'Negative',
  STORY: 'Story',
  UTILITY: 'Utility',
}

export const PromptInput = z.object({
  category: zPromptCategory,
  title: z.string().min(1, 'Title is required').max(120),
  body: z.string().min(1, 'Prompt body is required').max(20_000),
  tags: z.string().max(200).optional(),
})
export type PromptInput = z.input<typeof PromptInput>

export const PromptRecord = PromptInput.extend({
  id: zEntityId,
  /** Built-in seeds ship with every project and cannot be deleted. */
  builtin: z.boolean(),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type PromptRecord = z.infer<typeof PromptRecord>

export function promptTags(prompt: PromptRecord): string[] {
  return (prompt.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
}
