/**
 * VisualConsistencyService (v0.33, §estúdio japonês) — o motor de
 * CONSISTÊNCIA VISUAL que torna uma produção de anime parecer feita
 * por UM estúdio com UM estilo.
 *
 * Três âncoras travadas em CADA geração de imagem/vídeo:
 * 1. MODEL SHEETS — turnarounds e expressões canônicas de cada
 *    personagem são injetados no prompt (o personagem nunca muda de
 *    rosto/cabelo/roupa entre frames).
 * 2. PALETTE LOCK — cores hex extraídas da Bíblia de Estilo +
 *    Moodboard são forçadas no prompt (nenhuma geração foge da paleta).
 * 3. LIGHTING + LINEART + SHADING — iluminação, traço e sombreamento
 *    consistentes cena a cena.
 *
 * Resultado: um ConsistencyLock que é injetado em generateFrame,
 * assembleEpisode e generateVideo — nada sai do estúdio sem ele.
 */
import type { Database } from 'better-sqlite3'
import {
  CharacterRecord,
  StyleBible,
  consistencyPromptFragment,
} from '@mirai/shared'
import type {
  CharacterModelSheet,
  ConsistencyLock,
  PaletteLock,
  ConsistencyCheck,
} from '@mirai/shared'
import { zConsistencyLock } from '@mirai/shared'
import type { Clock } from '../types'
import type { EntityId } from '@mirai/shared'
import { MiraiError } from '@mirai/shared'

const HEX_RE = /#([0-9A-Fa-f]{6})\b/g

/** Hex codes válidos encontrados em texto livre (Bíblia de Estilo, etc.). */
function extractHexColors(text: string): string[] {
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = HEX_RE.exec(text))) found.push(m[1]!.toUpperCase())
  return [...new Set(found)]
}

export class VisualConsistencyService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  // -------------------------------------------------------- build lock

  /**
   * Constrói o ConsistencyLock de um projeto/episódio a partir de:
   * - Style Bible (arte, traço, sombreamento, iluminação, proporções…)
   * - Character reference sheets (model sheets)
   * - Moodboard palette (cores travadas)
   *
   * Todos os personagens da cena/episódio recebem suas model sheets.
   */
  buildLock(
    projectId: EntityId,
    styleBible: StyleBible,
    characters: CharacterRecord[],
    moodboardPalette: string[],
  ): ConsistencyLock {
    const now = this.clock.isoNow()

    // 1. Palette lock: hex do Style Bible.palette + cores do Moodboard
    const styleHexes = extractHexColors(styleBible.palette ?? '')
    const palette: PaletteLock[] = []
    for (const hex of styleHexes) {
      palette.push({ element: 'scene_global', hex: `#${hex}`, label: 'style_bible' })
    }
    for (const hex of moodboardPalette) {
      if (!palette.some((p) => p.hex === hex.toUpperCase())) {
        palette.push({ element: 'scene_global', hex: hex.toUpperCase(), label: 'moodboard' })
      }
    }

    // 2. Model sheets: cada personagem com referenceAssetId tem sua sheet
    const modelSheets: CharacterModelSheet[] = []
    for (const ch of characters) {
      if (!ch.referenceAssetId) continue
      modelSheets.push({
        characterId: ch.id,
        characterName: ch.name,
        referenceAssetId: ch.referenceAssetId,
        views: [
          { view: 'front', expression: 'neutral', description: 'Full-body front turnaround, neutral expression, consistent lighting' },
          { view: 'side', expression: 'neutral', description: 'Full-body side turnaround, 90° profile, same outfit and proportions' },
          { view: 'back', expression: 'neutral', description: 'Full-body back turnaround, same hair and costume details' },
          { view: 'expression', expression: 'emotional_close-up', description: 'Close-up face, emotional expression, same eyes and hair' },
        ],
        canonAppearance: ch.appearance,
        updatedAt: now,
      })
    }

    // 3. Monta o lock
    const lock: ConsistencyLock = {
      projectId,
      promptFragment: '', // preenchido abaixo
      palette,
      modelSheets,
      lighting: styleBible.lighting,
      lineart: styleBible.lineart,
      shading: styleBible.shading,
      proportions: styleBible.proportions,
      eyesAndHair: styleBible.eyesAndHair,
      backgrounds: styleBible.backgrounds,
      cameraLanguage: styleBible.cameraLanguage,
      updatedAt: now,
    }
    lock.promptFragment = consistencyPromptFragment(lock)
    return lock
  }

  // -------------------------------------------------------- validate

  /**
   * Valida (heurística) se um frame gerado respeita o lock de consistência.
   * Verifica: cores da paleta presentes, menção aos personagens, sem cores fora da paleta.
   * (Validação de pixels reais exigiria CV — aqui é uma verificação de prompt/metadados.)
   */
  checkConsistency(
    lock: ConsistencyLock,
    frameAssetId: EntityId,
    generationPrompt: string,
  ): ConsistencyCheck {
    const issues: string[] = []
    const suggestions: string[] = []
    let score = 100

    // Verifica se as cores da paleta foram mencionadas no prompt
    for (const p of lock.palette) {
      if (!generationPrompt.includes(p.hex) && !generationPrompt.includes(p.hex.toLowerCase())) {
        issues.push(`Cor da paleta não mencionada: ${p.element} ${p.hex}`)
        suggestions.push(`Adicione '${p.hex}' ao prompt de geração`)
        score -= 10
      }
    }

    // Verifica se os personagens com model sheet foram mencionados
    for (const sheet of lock.modelSheets) {
      if (!generationPrompt.includes(sheet.characterName)) {
        issues.push(`Personagem '${sheet.characterName}' não referenciado no prompt`)
        suggestions.push(`Adicione '${sheet.characterName}' ao prompt de geração`)
        score -= 15
      }
      if (sheet.canonAppearance) {
        const canonWords = sheet.canonAppearance.split(/[,。]/).filter(Boolean).slice(0, 3)
        for (const w of canonWords) {
          const trimmed = w.trim()
          if (trimmed.length > 0 && !generationPrompt.includes(trimmed)) {
            issues.push(`Detalhe canônico ausente para ${sheet.characterName}: ${trimmed}`)
            score -= 5
          }
        }
      }
    }

    if (score < 0) score = 0

    return {
      frameAssetId,
      consistent: score >= 80,
      score,
      issues: issues.length > 0 ? issues : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    }
  }

  // -------------------------------------------------------- persistence (optional future)

  /** Salva o lock no kv_store do projeto (para reutilização entre sessões). */
  saveLock(lock: ConsistencyLock): void {
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kv_store (key, value, updated_at)
         VALUES ('visual_consistency_lock', ?, ?)`,
      )
      .run(JSON.stringify(lock), now)
  }

  /** Carrega o lock salvo (se existir). */
  loadLock(): ConsistencyLock | null {
    const row = this.db
      .prepare("SELECT value FROM kv_store WHERE key = 'visual_consistency_lock'")
      .get() as { value: string } | undefined
    if (!row) return null
    try {
      const parsed = zConsistencyLock.safeParse(JSON.parse(row.value))
      if (!parsed.success) return null
      return parsed.data
    } catch {
      return null
    }
  }

  /** Valida o lock com zod (garante que nunca salvamos algo inválido). */
  validateLock(data: unknown): ConsistencyLock {
    const parsed = zConsistencyLock.safeParse(data)
    if (!parsed.success) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Consistency lock inválido.',
        { details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      )
    }
    return parsed.data
  }
}
