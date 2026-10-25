/**
 * Manga Pro entities (§8 of the expansion roadmap): comic/manga pages,
 * panels and lettering bubbles. Lettering is DATA — every bubble is a
 * typed record, so the lettering script export and future compositing
 * (slice 2) work from the same source of truth.
 */
import { z } from 'zod'
import { zTaskStatus } from '../status'
import { zEntityId, zIsoDate } from '../ids'

// ------------------------------------------------------------------ reading

export const READING_DIRECTIONS = ['RTL', 'LTR'] as const
export type ReadingDirection = (typeof READING_DIRECTIONS)[number]
export const zReadingDirection = z.enum(READING_DIRECTIONS)

// ------------------------------------------------------------------ bubbles

export const BUBBLE_KINDS = [
  'SPEECH',
  'THOUGHT',
  'SHOUT',
  'WHISPER',
  'NARRATION',
  'SFX',
  'CAPTION',
] as const
export type BubbleKind = (typeof BUBBLE_KINDS)[number]

export const BUBBLE_TAILS = [
  'BOTTOM_LEFT',
  'BOTTOM_CENTER',
  'BOTTOM_RIGHT',
  'TOP_LEFT',
  'TOP_CENTER',
  'TOP_RIGHT',
  'NONE',
] as const
export type BubbleTail = (typeof BUBBLE_TAILS)[number]

/**
 * One lettering element inside a panel. Positions are panel-relative
 * (0..1) — layout guidance for the artist/letterer, not compositing.
 */
export const BubbleInput = z.object({
  kind: z.enum(BUBBLE_KINDS),
  characterId: z.string().optional(),
  text: z.string().min(1, 'Bubble text is required').max(2_000),
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  width: z.number().min(0.05).max(1).default(0.35),
  tail: z.enum(BUBBLE_TAILS).default('BOTTOM_LEFT'),
  orderIndex: z.number().int().min(0).default(0),
})
export type BubbleInput = z.input<typeof BubbleInput>

export const Bubble = BubbleInput.extend({
  id: z.string(),
})
export type Bubble = z.infer<typeof Bubble>

// -------------------------------------------------------------------- pages

export const MangaPageInput = z.object({
  readingDirection: zReadingDirection.default('RTL'),
  layoutNotes: z.string().max(4_000).optional(),
  status: zTaskStatus.optional(),
})
export type MangaPageInput = z.input<typeof MangaPageInput>

export const MangaPageRecord = MangaPageInput.extend({
  id: zEntityId,
  episodeId: zEntityId,
  number: z.number().int().min(1),
  panelCount: z.number().int().min(0),
  status: zTaskStatus.default('TODO'),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type MangaPageRecord = z.infer<typeof MangaPageRecord>

// ------------------------------------------------------------------ panels

/**
 * Panel input: optional link to a storyboard shot (the visual reference
 * the panel adapts) and the lettering list. The panel image itself is
 * attached through the dedicated manga:panels:attachImage channel —
 * never part of plain updates.
 */
export const PanelCoords = z.object({
  /** Page-relative box (0..1). Omitted = auto-stack layout. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.05).max(1),
  h: z.number().min(0.05).max(1),
})

export const MangaPanelInput = z.object({
  shotId: z.string().optional(),
  lettering: z.array(BubbleInput).max(30).default([]),
  coords: PanelCoords.optional(),
})
export type MangaPanelInput = z.input<typeof MangaPanelInput>

/**
 * Panel records carry lettering WITH server-assigned bubble ids; the input
 * accepts the raw list (ids are (re)assigned on every save).
 */
export const MangaPanelRecord = z.object({
  shotId: z.string().optional(),
  lettering: z.array(Bubble).max(30),
  id: zEntityId,
  pageId: zEntityId,
  orderIndex: z.number().int().min(0),
  imageAssetId: zEntityId.nullable(),
  /** Manual layout box (null = auto-stack). */
  coords: PanelCoords.nullable(),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type MangaPanelRecord = z.infer<typeof MangaPanelRecord>

// ------------------------------------------------------------ RTL mirroring

/** Mirror a horizontal coordinate for right-to-left pages. */
export function mirrorX(x: number, width: number, rtl: boolean): number {
  return rtl ? 1 - x - width : x
}

const TAIL_MIRROR: Record<BubbleTail, BubbleTail> = {
  BOTTOM_LEFT: 'BOTTOM_RIGHT',
  BOTTOM_CENTER: 'BOTTOM_CENTER',
  BOTTOM_RIGHT: 'BOTTOM_LEFT',
  TOP_LEFT: 'TOP_RIGHT',
  TOP_CENTER: 'TOP_CENTER',
  TOP_RIGHT: 'TOP_LEFT',
  NONE: 'NONE',
}

/** Mirror a tail direction for right-to-left pages. */
export function mirrorTail(tail: BubbleTail, rtl: boolean): BubbleTail {
  return rtl ? TAIL_MIRROR[tail] : tail
}

// ------------------------------------------------- AI panel lettering draft

/** What the AI proposes for one panel (validated by zod at the boundary). */
export const PanelLetteringDraftBubble = z.object({
  kind: z.enum(BUBBLE_KINDS),
  characterName: z.string().max(120).optional(),
  text: z.string().min(1).max(2_000),
  tail: z.enum(BUBBLE_TAILS).optional(),
})
export const PanelLetteringDraft = z.object({
  bubbles: z.array(PanelLetteringDraftBubble).min(1).max(12),
})
export type PanelLetteringDraft = z.infer<typeof PanelLetteringDraft>
export type PanelLetteringDraftBubble = z.infer<typeof PanelLetteringDraftBubble>
