/**
 * Visual Consistency (v0.33, §estúdio japonês) — o que torna uma
 * produção de anime parecer feita por UM estúdio com UM estilo.
 *
 * Travamos três âncoras que NUNCA variam entre frames de um mesmo projeto:
 * 1. MODEL SHEETS — cada personagem tem turnaround (frente/lado/costas)
 *    e expressões canônicas; toda geração de imagem deve referenciá-los.
 * 2. PALETTE LOCK — cores hex extraídas da Bíblia de Estilo + Moodboard;
 *    nenhuma geração foge dessa paleta.
 * 3. LIGHTING + LINEART — iluminação e traço consistentes cena a cena.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

// -------------------------------------------------------- palette lock

/** Uma cor travada: hex + qual elemento ela controla (cabelo, pele, olho, etc.). */
export const zPaletteLock = z.object({
  characterId: zEntityId.optional(), // null = cena/background global
  element: z.string().min(1).max(60), // 'hair', 'skin', 'eye', 'uniform', 'background'
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Hex inválido (ex: #F472B6)'),
  label: z.string().max(100).optional(),
})
export type PaletteLock = z.infer<typeof zPaletteLock>

/** A paleta travada de um projeto: extraída da Bíblia de Estilo + Moodboard. */
export const zPaletteLockList = z.object({
  projectId: zEntityId,
  locks: z.array(zPaletteLock),
  source: z.enum(['style_bible', 'moodboard', 'both']),
  updatedAt: zIsoDate,
})
export type PaletteLockList = z.infer<typeof zPaletteLockList>

// -------------------------------------------------------- model sheet

/** Um ângulo de turnaround de um personagem (frente / lado / costas / expressão). */
export const zModelSheetView = z.object({
  view: z.enum(['front', 'side', 'back', '3/4', 'expression']),
  expression: z.string().max(40).optional(), // 'neutral', 'smile', 'cry', 'angry'…
  description: z.string().max(500),
})
export type ModelSheetView = z.infer<typeof zModelSheetView>

/** A model sheet completa de um personagem. */
export const zCharacterModelSheet = z.object({
  characterId: zEntityId,
  characterName: z.string().min(1).max(80),
  referenceAssetId: zEntityId.nullable(), // o arquivo da reference sheet
  views: z.array(zModelSheetView).min(1),
  canonAppearance: z.string().max(4_000).optional(), // 'cabelo prata, olhos âmbar, casaco escolar'
  updatedAt: zIsoDate,
})
export type CharacterModelSheet = z.infer<typeof zCharacterModelSheet>

// -------------------------------------------------------- consistency lock

/** O 'lock' completo de consistência que toda geração de imagem/vídeo
 * deve respeitar. Gerado pelo VisualConsistencyService. */
export const zConsistencyLock = z.object({
  projectId: zEntityId,
  /** Prompt fragment injetado em CADA geração (style bible + paleta + model sheets). */
  promptFragment: z.string().min(1),
  /** Paletas travadas por personagem/cena. */
  palette: z.array(zPaletteLock),
  /** Model sheets dos personagens presentes nesta cena/episódio. */
  modelSheets: z.array(zCharacterModelSheet),
  /** Iluminação de referência (do Style Bibles.lighting). */
  lighting: z.string().max(2_000).optional(),
  /** Line art / traço de referência (do Style Bibles.lineart). */
  lineart: z.string().max(2_000).optional(),
  /** Sombreamento (cel shading, etc). */
  shading: z.string().max(2_000).optional(),
  /** Proporções / design de referência. */
  proportions: z.string().max(2_000).optional(),
  /** Cabelos e olhos (canon). */
  eyesAndHair: z.string().max(2_000).optional(),
  /** Fundo/cenário de referência. */
  backgrounds: z.string().max(2_000).optional(),
  /** Linguagem de câmera do estilo. */
  cameraLanguage: z.string().max(2_000).optional(),
  updatedAt: zIsoDate,
})
export type ConsistencyLock = z.infer<typeof zConsistencyLock>

// -------------------------------------------------------- validation

/** Resultado de validação de consistência de um frame gerado. */
export const zConsistencyCheck = z.object({
  frameAssetId: zEntityId,
  consistent: z.boolean(),
  score: z.number().min(0).max(100), // 0-100 de consistência com o lock
  issues: z.array(z.string()).optional(), // 'personagem X não tem o cabelo da model sheet'
  suggestions: z.array(z.string()).optional(),
})
export type ConsistencyCheck = z.infer<typeof zConsistencyCheck>

// -------------------------------------------------------- prompt fragment

/** Monta o fragmento de prompt de consistência a partir de um lock. */
export function consistencyPromptFragment(lock: ConsistencyLock): string {
  const sections: string[] = []
  sections.push('STYLE BIBLE (honor every detail — studio consistency lock):')
  if (lock.lineart) sections.push(`LINEART: ${lock.lineart}`)
  if (lock.shading) sections.push(`SHADING: ${lock.shading}`)
  if (lock.lighting) sections.push(`LIGHTING: ${lock.lighting}`)
  if (lock.proportions) sections.push(`PROPORTIONS: ${lock.proportions}`)
  if (lock.eyesAndHair) sections.push(`EYES_AND_HAIR: ${lock.eyesAndHair}`)
  if (lock.backgrounds) sections.push(`BACKGROUNDS: ${lock.backgrounds}`)
  if (lock.cameraLanguage) sections.push(`CAMERA_LANGUAGE: ${lock.cameraLanguage}`)

  if (lock.palette.length > 0) {
    sections.push('\nPALETTE LOCK (use EXACTLY these hex colors — no deviations):')
    for (const p of lock.palette) {
      const who = p.characterId ? `character ${p.characterId}` : 'scene/global'
      sections.push(`- ${p.element} (${who}): ${p.hex}${p.label ? ` — ${p.label}` : ''}`)
    }
  }

  if (lock.modelSheets.length > 0) {
    sections.push('\nCHARACTER MODEL SHEETS (honor every turnaround view — same person in all frames):')
    for (const sheet of lock.modelSheets) {
      sections.push(`\n${sheet.characterName} (${sheet.characterId}):`)
      sections.push(`Canon: ${sheet.canonAppearance ?? '—'}`)
      for (const view of sheet.views) {
        sections.push(`- ${view.view}${view.expression ? ` (${view.expression})` : ''}: ${view.description}`)
      }
    }
  }

  sections.push('\nRULE: The character design, hair color, eye color, outfit, proportions and lighting '
    + 'must be IDENTICAL across every frame of this project. Never invent new colors outside the palette.')

  return sections.join('\n')
}
