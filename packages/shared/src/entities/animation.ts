/**
 * Animation Pipeline (v0.34, §estúdio japonês) — o pipeline de produção
 * de animação no modelo dos estúdios japoneses (Toei, Kyoto Animation,
 * Wit Studio, etc.):
 *
 *   GENGA (key frames) → DOUGA (in-between/tweening) →
 *   SEITO (cleanup/line art) → TOSO (color) → SATSUEI (compositing)
 *
 * Cada etapa produz ativos reais no projeto, travados pelo ConsistencyLock
 * (model sheets + paleta + style bible) para que todo quadro tenha a
 * mesma aparência de um único estúdio.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

// ---------------------------------------------------------------- stages

export const ANIMATION_STAGES = [
  'KEYFRAME',
  'INBETWEEN',
  'CLEANUP',
  'COLOR',
  'COMPOSITING',
] as const
export type AnimationStage = (typeof ANIMATION_STAGES)[number]
export const zAnimationStage = z.enum(ANIMATION_STAGES)

export const zInbetweenEasing = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier'])
export type InbetweenEasing = z.infer<typeof zInbetweenEasing>

export const ANIMATION_STAGE_LABEL: Record<AnimationStage, string> = {
  KEYFRAME: 'Genga (Chave)',
  INBETWEEN: 'Douga (Intermediário)',
  CLEANUP: 'Seito (Limpeza)',
  COLOR: 'Toso (Coloração)',
  COMPOSITING: 'Satsuei (Filmagem)',
}

// ---------------------------------------------------------------- pipeline

/** Configuração do pipeline de animação de uma cena/episódio. */
export const zAnimationPipeline = z.object({
  sceneId: zEntityId,
  /** Target FPS — 24 é o padrão da animação japonesa TV. */
  fps: z.number().int().min(1).max(60).default(24),
  /** Quantos quadros intermediários gerar entre dois keyframes (0 = sem in-between). */
  inbetweenCount: z.number().int().min(0).max(20).default(2),
  /** Easing usado para interpolação de posição/escala entre keyframes. */
  inbetweenEasing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier']).default('easeInOut'),
  /** Quando verdadeiro, aplica o ConsistencyLock (paleta + model sheets) na coloração. */
  enforceConsistency: z.boolean().default(true),
  /** Etapa atual do pipeline. */
  currentStage: zAnimationStage.default('KEYFRAME'),
  /** Quadros produzidos por etapa. */
  framesByStage: z.record(zAnimationStage, z.number().int().min(0)).default({}),
  updatedAt: zIsoDate,
})
export type AnimationPipeline = z.infer<typeof zAnimationPipeline>

// ---------------------------------------------------------------- in-between

/** Especificação de tweening entre dois keyframes. */
export const zInbetweenSpec = z.object({
  fromKeyframeId: zEntityId,
  toKeyframeId: zEntityId,
  /** Fração do caminho (0 = from, 1 = to). */
  t: z.number().min(0).max(1),
  /** Valor interpolado para cada parâmetro da câmera. */
  interpolatedCamera: z.record(z.string(), z.number()),
})
export type InbetweenSpec = z.infer<typeof zInbetweenSpec>

// ---------------------------------------------------------------- cleanup

/** Resultado da limpeza de linha (line art) de um quadro. */
export const zCleanupPass = z.object({
  sourceFrameAssetId: zEntityId,
  outputFrameAssetId: zEntityId,
  /** Largura de linha aplicada (px). */
  lineWidth: z.number().min(0.5).max(10).default(2),
  /** Suavização da linha (0 = crua, 1 = muito suave). */
  lineSmoothness: z.number().min(0).max(1).default(0.5),
  notes: z.string().max(1_000).optional(),
})
export type CleanupPass = z.infer<typeof zCleanupPass>

// ---------------------------------------------------------------- color

/** Resultado da coloração de um quadro. */
export const zColorPass = z.object({
  sourceFrameAssetId: zEntityId,
  outputFrameAssetId: zEntityId,
  /** Paleta aplicada (hex → elemento). */
  palette: z.array(z.object({
    element: z.string().min(1).max(60),
    hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })),
  /** Quando verdadeiro, a paleta veio do ConsistencyLock. */
  consistencyLocked: z.boolean().default(false),
  notes: z.string().max(1_000).optional(),
})
export type ColorPass = z.infer<typeof zColorPass>

// ---------------------------------------------------------------- compositing

/** Resultado da filmagem/compositing de um quadro. */
export const zCompositingPass = z.object({
  sourceFrameAssetId: zEntityId,
  outputFrameAssetId: zEntityId,
  /** Blend mode aplicado. */
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'difference']).default('normal'),
  /** Opacidade da camada sobreposta. */
  opacity: z.number().min(0).max(1).default(1),
  /** Câmera aplicada (zoom/x/y/rotação/opacidade). */
  camera: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    scale: z.number().min(0.1).max(10).default(1),
    rotation: z.number().default(0),
    opacity: z.number().min(0).max(1).default(1),
  }).default({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }),
  notes: z.string().max(1_000).optional(),
})
export type CompositingPass = z.infer<typeof zCompositingPass>

// ---------------------------------------------------------------- frame

/** Um quadro produzido no pipeline de animação. */
export const zAnimationFrame = z.object({
  id: zEntityId,
  sceneId: zEntityId,
  /** Segundo na cena (clip-local). */
  atSec: z.number().min(0),
  /** Etapa que produziu este quadro. */
  stage: zAnimationStage,
  /** Ativo de imagem real (frames/ ou exports/). */
  assetId: zEntityId,
  /** Keyframe de origem (quando é in-between/cleanup/color/compositing). */
  sourceKeyframeId: zEntityId.nullable(),
  /** Especificação de interpolação (quando é in-between). */
  inbetweenSpec: zInbetweenSpec.nullable(),
  createdAt: zIsoDate,
})
export type AnimationFrame = z.infer<typeof zAnimationFrame>
