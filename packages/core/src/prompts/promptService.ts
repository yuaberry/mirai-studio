/**
 * PromptService — the Prompt Library (spec §21/§31 emphasis on manga/anime
 * generation prompts). Curated, reusable, tag-searchable prompt cards.
 *
 * Every project ships with a set of well-crafted BUILT-IN prompts (manga
 * panels, character sheets, anime styles, negatives). Built-ins can be
 * edited (as personal overrides) but never deleted — they are seeded
 * idempotently on first use.
 */
import { z } from 'zod'
import {
  MiraiError,
  PromptInput,
  PromptRecord,
  type EntityId,
  type PromptCategory,
} from '@mirai/shared'
import { createHash } from 'node:crypto'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'

interface PromptRow {
  id: string
  category: string
  title: string
  body: string
  tags: string | null
  builtin: number
  created_at: string
  updated_at: string
}

/** Parse with zod, converting failures into a MiraiError (spec §26). */
function parsePromptInput(input: unknown) {
  const result = PromptInput.safeParse(input)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', 'Invalid prompt.', {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}

export class PromptService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {
    this.seedBuiltins()
  }

  list(): PromptRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM prompts ORDER BY builtin DESC, title ASC')
      .all() as PromptRow[]
    return rows.map(rowToPrompt)
  }

  get(id: EntityId): PromptRecord {
    const row = this.db
      .prepare('SELECT * FROM prompts WHERE id = ?')
      .get(id) as PromptRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Prompt ${id} not found.`)
    return rowToPrompt(row)
  }

  create(input: z.input<typeof PromptInput>): PromptRecord {
    const parsed = parsePromptInput(input)
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO prompts (id, category, title, body, tags, builtin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(id, parsed.category, parsed.title, parsed.body, parsed.tags ?? null, now, now)
    return this.get(id)
  }

  update(id: EntityId, input: z.input<typeof PromptInput>): PromptRecord {
    this.get(id)
    const parsed = parsePromptInput(input)
    this.db
      .prepare(
        `UPDATE prompts SET category = ?, title = ?, body = ?, tags = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.category,
        parsed.title,
        parsed.body,
        parsed.tags ?? null,
        this.clock.isoNow(),
        id,
      )
    return this.get(id)
  }

  delete(id: EntityId): void {
    const prompt = this.get(id)
    if (prompt.builtin) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Built-in prompts cannot be deleted — edit them to make them yours.',
      )
    }
    this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id)
  }

  /** Idempotent seeding of the built-in manga/anime library. */
  private seedBuiltins(): void {
    const tx = this.db.transaction(() => {
      for (const seed of BUILTIN_PROMPTS) {
        const id = builtinId(seed.id)
        const existing = this.db
          .prepare('SELECT id FROM prompts WHERE id = ?')
          .get(id) as { id: string } | undefined
        if (existing) continue
        const now = this.clock.isoNow()
        this.db
          .prepare(
            `INSERT INTO prompts (id, category, title, body, tags, builtin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(id, seed.category, seed.title, seed.body, seed.tags, now, now)
      }
    })
    tx()
  }
}

/**
 * Deterministic ULID-shaped id for built-in prompts (valid Crockford base32,
 * 26 chars) derived from the human-readable slug. Built-ins must be seeded
 * idempotently, so their ids cannot be random.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function builtinId(slug: string): string {
  const digest = createHash('sha256').update(`mirai:builtin:${slug}`).digest()
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of digest) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5 && out.length < 26) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]!
      bits -= 5
    }
    if (out.length >= 26) break
  }
  return out.padEnd(26, '0')
}

function rowToPrompt(row: PromptRow): PromptRecord {
  const parsed = PromptRecord.safeParse({
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    tags: row.tags ?? undefined,
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  if (!parsed.success) {
    throw new MiraiError('DB_ERROR', `Corrupted prompt record ${row.id}.`, {
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Built-in library — professional manga/anime generation prompts.
// These are living tools: the user is encouraged to edit/tune them.
// ---------------------------------------------------------------------------
interface BuiltinSeed {
  id: string
  category: PromptCategory
  title: string
  tags: string
  body: string
}

const BUILTIN_PROMPTS: BuiltinSeed[] = [
  {
    id: 'builtin:manga-panel-action',
    category: 'MANGA_PANEL',
    title: 'Manga Panel — Dynamic Action',
    tags: 'manga, panel, action, composition',
    body: `A single manga panel, black-and-white screentone art.
Composition: dynamic diagonal flow, extreme perspective (low or dutch angle), motion speed lines concentrated on the focal action.
Subject: [DESCRIBE ACTION HERE — e.g. "the swordswoman deflects a spell at full sprint"].
Inking: bold variable line weight, high contrast blacks, sparse halftone gradients on shadows, white paper preserved for impact.
Panel mood: tension, velocity, adrenaline.
Keep character on-model with the reference sheet. No text bubbles in the art.`,
  },
  {
    id: 'builtin:manga-panel-quiet',
    category: 'MANGA_PANEL',
    title: 'Manga Panel — Quiet Emotional Beat',
    tags: 'manga, panel, drama, closeup',
    body: `A single manga panel, black-and-white screentone art.
Composition: restrained, mostly static camera, generous negative space, one strong focal point (eyes, hand, falling petal).
Subject: [DESCRIBE THE BEAT — e.g. "Mio closes her phone and looks at the rain"].
Inking: thin delicate lines, soft halftone gradient sky, minimal detail — the emptiness carries the emotion.
Mood: melancholy, stillness, unsaid words.
No speech bubbles in the art.`,
  },
  {
    id: 'builtin:character-sheet-anime',
    category: 'CHARACTER',
    title: 'Character Sheet — Anime Reference (Turnaround)',
    tags: 'character, model sheet, turnaround, reference',
    body: `Full character reference sheet of [CHARACTER NAME], anime style, clean lineart.
Layout: front view, 3/4 view and side view (T-pose or relaxed), consistent proportions across all views; a head close-up with expression range (neutral, joy, anger, tears).
Character: [AGE/ROLE], [SILHOUETTE & HAIR DETAILS], [SIGNATURE OUTFIT PIECES], [COLOR PALETTE callouts with hex swatches].
Style: crisp cel lineart, flat shading, subtle rim light, neutral gray background, no text.
This sheet is the single source of visual truth for this character — prioritize reproducibility.`,
  },
  {
    id: 'builtin:character-expressions',
    category: 'CHARACTER',
    title: 'Character — Expression Study (6 Panel)',
    tags: 'character, expressions, emotions, study',
    body: `Expression study of [CHARACTER NAME] in a 2x3 grid of head-and-shoulders portraits.
Six emotions: subtle smile, open laughter, irritation, quiet tears, shocked realization, determined resolve.
The character's signature traits must stay identical in all six: [HAIR], [EYES], [ACCESSORIES].
Anime style, clean lineart, flat cel shading. Exaggerate with the mouth and brows, never break the character model.`,
  },
  {
    id: 'builtin:scene-anime-keyframe',
    category: 'SCENE',
    title: 'Anime Keyframe — Establishing Shot',
    tags: 'anime, background, establishing, keyframe',
    body: `Anime establishing keyframe of [LOCATION — e.g. "a hill overlooking the magic academy at dusk"].
Composition: wide cinematic framing, rule of thirds, layered depth (foreground silhouette / midground subject / background vista).
Lighting: golden-hour dusk with warm rim light, long soft shadows, atmospheric perspective haze on the background.
Style: painted anime background art (Makoto Shinkai school), clean shapes, luminous sky, no characters.
Mood: [TONE — e.g. "hopeful melancholy"].`,
  },
  {
    id: 'builtin:scene-anime-duo',
    category: 'SCENE',
    title: 'Anime Scene — Two-Shot with Emotion',
    tags: 'anime, two-shot, romance, cinematic',
    body: `Anime two-shot of [CHARACTER A] and [CHARACTER B] — [RELATION/DYNAMIC — e.g. "rivals who secretly trust each other"].
Framing: over-the-shoulder or mirrored profile composition; body language tells the relationship (distance, eye contact, hand tension).
Setting: [LOCATION + TIME OF DAY]; light that supports the mood: [e.g. "cold moonlight with warm window glow between them"].
Style: modern TV anime cel shading, cinematic composition, 16:9 keyframe, on-model characters per reference sheets.
Mood: [e.g. "fragile intimacy"].`,
  },
  {
    id: 'builtin:style-modern-anime',
    category: 'ANIME_STYLE',
    title: 'Style Anchor — Modern TV Anime',
    tags: 'style, anchor, consistent, tv anime',
    body: `STYLE ANCHOR (apply to every generation of this project):
Modern TV anime aesthetic. Clean confident lineart with variable weight; large expressive eyes with detailed highlights; hair drawn in soft silhouette shapes with 2–3 value bands; flat cel shading with one hard shadow edge; subtle gradients only on sky and ambience; color palette tuned for [PALETTE — e.g. "sakura pinks, dusk violets, cyan accents"]; overall luminosity high, blacks kept deep.
Consistency rules: same line weight language, same eye construction, same shading direction (top-left key light) across all shots.`,
  },
  {
    id: 'builtin:style-shoujo-manga',
    category: 'ANIME_STYLE',
    title: 'Style Anchor — Shoujo Manga Ink',
    tags: 'style, manga, shoujo, ink',
    body: `STYLE ANCHOR (apply to every manga panel of this project):
Shoujo manga ink aesthetic. Fine expressive linework; starry/sparkle highlights in eyes; flowing hair with graceful tapering strokes; delicate halftone screentone gradients; floral/shoujo sparkle accents in emotional beats; backgrounds dissolve into tone washes during interior moments.
Blacks reserved for impact: hair silhouettes and key shadows only. High page luminosity.`,
  },
  {
    id: 'builtin:negative-anime-clean',
    category: 'NEGATIVE',
    title: 'Negative Anchor — Clean Anime/Manga',
    tags: 'negative, quality, artifacts',
    body: `NEGATIVE PROMPT (pair with any generation):
extra fingers, deformed hands, twisted limbs, asymmetrical eyes, off-model character, melted face, duplicate heads, text, watermark, signature, speech bubbles, blurry lineart, jpeg artifacts, oversaturated colors, 3d render, photorealistic skin, mangled linework, cluttered composition, low contrast murk, loli sexualization, gore excess`,
  },
  {
    id: 'builtin:story-beat-sheet',
    category: 'STORY',
    title: 'Story — Episode Beat Sheet',
    tags: 'story, structure, episode, beats',
    body: `You are a professional anime episode writer. Produce a beat sheet for Episode [N] of [PROJECT] using this exact structure, 12–16 beats:
1. Cold open hook (visual, no exposition)
2. Scene sequence following the A-plot: setup → escalation → complication → false defeat
3. Interleaved B-plot beats (relationship development)
4. Midpoint turn that reframes the goal
5. Emotional peak born from the protagonist's flaw ([FLAW])
6. Payoff that honors an earlier setup
7. Cliffhanger or button that promises the next episode
Constraints: honor the Story Bible canon; each beat = one line + its purpose; mark the episode theme.`,
  },
  {
    id: 'builtin:utility-scene-dialogue',
    category: 'UTILITY',
    title: 'Utility — Scene Dialogue Punch-Up',
    tags: 'dialogue, screenplay, polish',
    body: `You are a dialogue editor for anime. Take the scene screenplay below and punch it up:
- Cut any line that only states what the audience already sees.
- Give each character a distinct voice: [CHARACTER VOICE NOTES].
- Replace on-the-nose emotion with subtext and physical beats.
- Keep lines short; respect Japanese honorific conventions where relevant ([SETTING]).
- Output the same screenplay format, then list what you changed and why (2–3 bullets).
SCREENPLAY:
[PASTE SCENE SCREENPLAY HERE]`,
  },
  {
    id: 'builtin:manga-page-flow',
    category: 'MANGA_PANEL',
    title: 'Manga Page — 4-Panel Flow Design',
    tags: 'manga, page, layout, flow',
    body: `Design a single manga page (B5, right-to-left reading) with 4 panels dramatizing this beat: [DESCRIBE BEAT].
For each panel specify: (1) shot size and angle, (2) what the reader sees in one sentence, (3) what it must make them FEEL, (4) panel size relative to the others (small/large/wide), (5) where the eye should flow from the previous panel.
End with the page's silhouette test: describe the black shapes distribution — a healthy page reads even when squinted.
The layout must serve pacing: big panel = emotional peak; small panels = velocity.`,
  },
]
