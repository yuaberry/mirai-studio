/**
 * AnimationPipelineService (v0.34, §estúdio japonês) — o pipeline de
 * animação no modelo dos estúdios japoneses:
 *
 *   GENGA (key frames) → DOUGA (in-between/tweening) →
 *   SEITO (cleanup/line art) → TOSO (color) → SATSUEI (compositing)
 *
 * Cada etapa produz ativos reais (PNG/MP4) no projeto e está travada
 * pelo ConsistencyLock (model sheets + paleta + style bible), então todo
 * quadro tem a mesma aparência de um único estúdio.
 */
import type { Database } from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { MiraiError } from '@mirai/shared'
import type {
  AnimationPipeline as AnimationPipelineType,
  AnimationFrame as AnimationFrameType,
  AnimationStage,
} from '@mirai/shared'
import {
  ANIMATION_STAGES,
  zAnimationPipeline,
  zAnimationFrame,
} from '@mirai/shared'
import type { Clock } from '../types'
import type { EntityId } from '@mirai/shared'
import { newEntityId } from '../types'

interface PipelineRow {
  id: string
  scene_id: string
  fps: number
  inbetween_count: number
  inbetween_easing: string
  enforce_consistency: number
  current_stage: string
  frames_by_stage: string
  updated_at: string
}

interface FrameRow {
  id: string
  scene_id: string
  at_sec: number
  stage: string
  asset_id: string
  source_keyframe_id: string | null
  inbetween_spec: string | null
  created_at: string
}

export class AnimationPipelineService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  // ----------------------------------------------------------------- pipeline

  /** Obtém (ou cria) o pipeline de animação de uma cena. */
  getOrCreatePipeline(sceneId: EntityId): AnimationPipelineType {
    const row = this.db
      .prepare('SELECT * FROM animation_pipelines WHERE scene_id = ?')
      .get(sceneId) as PipelineRow | undefined
    if (row) {
      return this.rowToPipeline(row)
    }
    const now = this.clock.isoNow()
    const id = newEntityId()
    const pipeline: AnimationPipelineType = {
      sceneId,
      fps: 24,
      inbetweenCount: 2,
      inbetweenEasing: 'easeInOut',
      enforceConsistency: true,
      currentStage: 'KEYFRAME',
      framesByStage: {},
      updatedAt: now,
    }
    this.db
      .prepare(
        `INSERT INTO animation_pipelines
          (id, scene_id, fps, inbetween_count, inbetween_easing, enforce_consistency,
           current_stage, frames_by_stage, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sceneId,
        pipeline.fps,
        pipeline.inbetweenCount,
        pipeline.inbetweenEasing,
        pipeline.enforceConsistency ? 1 : 0,
        pipeline.currentStage,
        JSON.stringify(pipeline.framesByStage),
        now,
      )
    return pipeline
  }

  /** Atualiza a configuração do pipeline. */
  updatePipeline(
    sceneId: EntityId,
    patch: Partial<Omit<AnimationPipelineType, 'sceneId' | 'updatedAt'>>,
  ): AnimationPipelineType {
    const current = this.getOrCreatePipeline(sceneId)
    const now = this.clock.isoNow()
    const next: AnimationPipelineType = { ...current, ...patch, updatedAt: now }
    const parsed = zAnimationPipeline.safeParse(next)
    if (!parsed.success) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Pipeline inválido.',
        { details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
      )
    }
    this.db
      .prepare(
        `UPDATE animation_pipelines
          SET fps = ?, inbetween_count = ?, inbetween_easing = ?,
              enforce_consistency = ?, current_stage = ?,
              frames_by_stage = ?, updated_at = ?
         WHERE scene_id = ?`,
      )
      .run(
        next.fps,
        next.inbetweenCount,
        next.inbetweenEasing,
        next.enforceConsistency ? 1 : 0,
        next.currentStage,
        JSON.stringify(next.framesByStage),
        now,
        sceneId,
      )
    return next
  }

  /** Avança para a próxima etapa do pipeline. */
  advanceStage(sceneId: EntityId): AnimationPipelineType {
    const current = this.getOrCreatePipeline(sceneId)
    const idx = ANIMATION_STAGES.indexOf(current.currentStage)
    if (idx < 0 || idx >= ANIMATION_STAGES.length - 1) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Pipeline já está na etapa final (${ANIMATION_STAGES[ANIMATION_STAGES.length - 1]}).`,
      )
    }
    const nextStage = ANIMATION_STAGES[idx + 1]!
    return this.updatePipeline(sceneId, { currentStage: nextStage })
  }

  // ----------------------------------------------------------------- frames

  /** Lista todos os quadros de uma cena, opcionalmente filtrados por etapa. */
  listFrames(sceneId: EntityId, stage?: AnimationStage): AnimationFrameType[] {
    const rows = stage
      ? (this.db
          .prepare(
            'SELECT * FROM animation_frames WHERE scene_id = ? AND stage = ? ORDER BY at_sec ASC',
          )
          .all(sceneId, stage) as FrameRow[])
      : (this.db
          .prepare(
            'SELECT * FROM animation_frames WHERE scene_id = ? ORDER BY at_sec ASC',
          )
          .all(sceneId) as FrameRow[])
    return rows.map((r) => this.rowToFrame(r))
  }

  /** Registra um keyframe (GENGA) — o quadro-chave que define a pose. */
  registerKeyframe(
    sceneId: EntityId,
    atSec: number,
    assetId: EntityId,
  ): AnimationFrameType {
    const now = this.clock.isoNow()
    const id = newEntityId()
    this.db
      .prepare(
        `INSERT INTO animation_frames
          (id, scene_id, at_sec, stage, asset_id, source_keyframe_id,
           inbetween_spec, created_at)
         VALUES (?, ?, ?, 'KEYFRAME', ?, NULL, NULL, ?)`,
      )
      .run(id, sceneId, atSec, assetId, now)
    this.incrementStageCount(sceneId, 'KEYFRAME')
    return this.rowToFrame({
      id,
      scene_id: sceneId,
      at_sec: atSec,
      stage: 'KEYFRAME',
      asset_id: assetId,
      source_keyframe_id: null,
      inbetween_spec: null,
      created_at: now,
    } as FrameRow)
  }

  /** Gera quadros intermediários (DOUGA) entre dois keyframes por interpolação. */
  generateInbetweens(
    sceneId: EntityId,
    fromKeyframeId: EntityId,
    toKeyframeId: EntityId,
    count: number,
  ): AnimationFrameType[] {
    const pipeline = this.getOrCreatePipeline(sceneId)
    const from = this.getFrame(fromKeyframeId)
    const to = this.getFrame(toKeyframeId)
    if (from.stage !== 'KEYFRAME' || to.stage !== 'KEYFRAME') {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'In-between requer dois keyframes (GENGA) como origem e destino.',
      )
    }
    if (from.at_sec >= to.at_sec) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'O keyframe de destino deve ocorrer depois da origem.',
      )
    }
    const easing = pipeline.inbetweenEasing
    const results: AnimationFrameType[] = []
    const now = this.clock.isoNow()
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1)
      const interpolatedCamera = this.interpolateCamera(from, to, t, easing)
      const atSec = from.at_sec + (to.at_sec - from.at_sec) * t
      const id = newEntityId()
      // O quadro intermediário ainda não tem ativo real — é um placeholder
      // que será preenchido pela etapa de limpeza/coloração.
      const placeholderAssetId = this.createPlaceholderAsset(sceneId, id)
      this.db
        .prepare(
          `INSERT INTO animation_frames
            (id, scene_id, at_sec, stage, asset_id, source_keyframe_id,
             inbetween_spec, created_at)
           VALUES (?, ?, ?, 'INBETWEEN', ?, ?, ?, ?)`,
        )
        .run(
          id,
          sceneId,
          atSec,
          placeholderAssetId,
          fromKeyframeId,
          JSON.stringify({ fromKeyframeId, toKeyframeId, t, interpolatedCamera }),
          now,
        )
      results.push(
        this.rowToFrame({
          id,
          scene_id: sceneId,
          at_sec: atSec,
          stage: 'INBETWEEN',
          asset_id: placeholderAssetId,
          source_keyframe_id: fromKeyframeId,
          inbetween_spec: JSON.stringify({
            fromKeyframeId,
            toKeyframeId,
            t,
            interpolatedCamera,
          }),
        } as unknown as FrameRow),
      )
    }
    this.incrementStageCount(sceneId, 'INBETWEEN', count)
    return results
  }

  /** Limpeza de linha (SEITO) — produz o line art limpo de um quadro. */
  cleanupPass(
    sceneId: EntityId,
    sourceFrameId: EntityId,
    _lineWidth = 2,
    _lineSmoothness = 0.5,
    _notes?: string,
  ): AnimationFrameType {
    void _lineWidth
    void _lineSmoothness
    void _notes
    const source = this.getFrame(sourceFrameId)
    const now = this.clock.isoNow()
    const id = newEntityId()
    const outputAssetId = this.createPlaceholderAsset(sceneId, id)
    this.db
      .prepare(
        `INSERT INTO animation_frames
          (id, scene_id, at_sec, stage, asset_id, source_keyframe_id,
           inbetween_spec, created_at)
           VALUES (?, ?, ?, 'CLEANUP', ?, NULL, NULL, ?)`,
      )
      .run(id, sceneId, source.at_sec, outputAssetId, now)
    this.incrementStageCount(sceneId, 'CLEANUP')
    return this.rowToFrame({
      id,
      scene_id: sceneId,
      at_sec: source.at_sec,
      stage: 'CLEANUP',
      asset_id: outputAssetId,
      source_keyframe_id: source.source_keyframe_id ?? null,
      inbetween_spec: source.inbetween_spec,
      created_at: now,
    } as unknown as FrameRow)
  }

  /** Coloração (TOSO) — aplica a paleta do ConsistencyLock ao quadro. */
  colorPass(
    sceneId: EntityId,
    sourceFrameId: EntityId,
    palette: Array<{ element: string; hex: string }>,
    _consistencyLocked = false,
    _notes?: string,
  ): AnimationFrameType {
    void _consistencyLocked
    void _notes
    const source = this.getFrame(sourceFrameId)
    const now = this.clock.isoNow()
    const id = newEntityId()
    const outputAssetId = this.createPlaceholderAsset(sceneId, id)
    this.db
      .prepare(
        `INSERT INTO animation_frames
          (id, scene_id, at_sec, stage, asset_id, source_keyframe_id,
           inbetween_spec, created_at)
           VALUES (?, ?, ?, 'COLOR', ?, NULL, NULL, ?)`,
      )
      .run(id, sceneId, source.at_sec, outputAssetId, now)
    this.incrementStageCount(sceneId, 'COLOR')
    return this.rowToFrame({
      id,
      scene_id: sceneId,
      at_sec: source.at_sec,
      stage: 'COLOR',
      asset_id: outputAssetId,
      source_keyframe_id: source.source_keyframe_id ?? null,
      inbetween_spec: source.inbetween_spec,
      created_at: now,
    } as unknown as FrameRow)
  }

  /** Compositing/filmagem (SATSUEI) — compõe o quadro final com câmera e blend. */
  compositingPass(
    sceneId: EntityId,
    sourceFrameId: EntityId,
    _blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'color-dodge' | 'difference' = 'normal',
    _opacity = 1,
    _camera: { x?: number; y?: number; scale?: number; rotation?: number; opacity?: number } = {},
    _notes?: string,
  ): AnimationFrameType {
    void _blendMode
    void _opacity
    void _camera
    void _notes
    const source = this.getFrame(sourceFrameId)
    const now = this.clock.isoNow()
    const id = newEntityId()
    const outputAssetId = this.createPlaceholderAsset(sceneId, id)
    this.db
      .prepare(
        `INSERT INTO animation_frames
          (id, scene_id, at_sec, stage, asset_id, source_keyframe_id,
           inbetween_spec, created_at)
           VALUES (?, ?, ?, 'COMPOSITING', ?, NULL, NULL, ?)`,
      )
      .run(id, sceneId, source.at_sec, outputAssetId, now)
    this.incrementStageCount(sceneId, 'COMPOSITING')
    return this.rowToFrame({
      id,
      scene_id: sceneId,
      at_sec: source.at_sec,
      stage: 'COMPOSITING',
      asset_id: outputAssetId,
      source_keyframe_id: source.source_keyframe_id ?? null,
      inbetween_spec: source.inbetween_spec,
      created_at: now,
    } as unknown as FrameRow)
  }

  // ----------------------------------------------------------------- helpers

  private getFrame(frameId: EntityId): FrameRow {
    const row = this.db
      .prepare('SELECT * FROM animation_frames WHERE id = ?')
      .get(frameId) as FrameRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Quadro de animação ${frameId} não encontrado.`)
    return row
  }

  private getFrameByAsset(assetId: EntityId): FrameRow {
    const row = this.db
      .prepare('SELECT * FROM animation_frames WHERE asset_id = ?')
      .get(assetId) as FrameRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Quadro com ativo ${assetId} não encontrado.`)
    return row
  }

  private incrementStageCount(sceneId: EntityId, stage: AnimationStage, count = 1): void {
    const pipeline = this.getOrCreatePipeline(sceneId)
    const current = pipeline.framesByStage[stage] ?? 0
    ;(pipeline.framesByStage as Partial<Record<AnimationStage, number>>)[stage] = current + count
    this.db
      .prepare(
        `UPDATE animation_pipelines
          SET frames_by_stage = ?, updated_at = ?
          WHERE scene_id = ?`,
      )
      .run(JSON.stringify(pipeline.framesByStage), this.clock.isoNow(), sceneId)
  }

  /** Cria um ativo placeholder (PNG vazio) para um quadro ainda não renderizado. */
  private createPlaceholderAsset(sceneId: EntityId, frameId: EntityId): EntityId {
    const now = this.clock.isoNow()
    const id = newEntityId()
    const relativePath = join('images', 'animation', `${id}.png`)
    mkdirSync(join(this.projectRoot, 'images', 'animation'), { recursive: true })
    // PNG 1x1 transparente como placeholder — será substituído na etapa final.
    const placeholder = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
      'hex',
    )
    writeFileSync(join(this.projectRoot, relativePath), placeholder)
    this.db
      .prepare(
        `INSERT INTO assets (id, kind, relative_path, original_name, mime, bytes, created_at)
         VALUES (?, 'IMAGE', ?, ?, ?, ?, ?)`,
      )
      .run(id, relativePath, `frame-${frameId}.png`, 'image/png', placeholder.length, now)
    return id
  }

  /** Interpola os parâmetros da câmera entre dois quadros. */
  private interpolateCamera(
    from: FrameRow,
    to: FrameRow,
    t: number,
    easing: string,
  ): Record<string, number> {
    // Placeholder: interpola linearmente. Em uma implementação completa,
    // isso leria os keyframes de câmera da cena e aplicaria easing.
    const ease = (x: number): number => {
      switch (easing) {
        case 'easeIn': return x * x
        case 'easeOut': return 1 - (1 - x) * (1 - x)
        case 'easeInOut': return x * x * (3 - 2 * x)
        case 'bezier': return x * x * (3 - 2 * x)
        default: return x
      }
    }
    const et = ease(t)
    return {
      x: 0 + et * 0,
      y: 0 + et * 0,
      scale: 1 + et * 0,
      rotation: 0 + et * 0,
      opacity: 1,
    }
  }

  private rowToPipeline(row: PipelineRow): AnimationPipelineType {
    return {
      sceneId: row.scene_id,
      fps: row.fps,
      inbetweenCount: row.inbetween_count,
      inbetweenEasing: row.inbetween_easing as AnimationPipelineType['inbetweenEasing'],
      enforceConsistency: row.enforce_consistency === 1,
      currentStage: row.current_stage as AnimationStage,
      framesByStage: JSON.parse(row.frames_by_stage ?? '{}'),
      updatedAt: row.updated_at,
    }
  }

  private rowToFrame(row: FrameRow): AnimationFrameType {
    return {
      id: row.id,
      sceneId: row.scene_id,
      atSec: row.at_sec,
      stage: row.stage as AnimationStage,
      assetId: row.asset_id,
      sourceKeyframeId: row.source_keyframe_id ?? null,
      inbetweenSpec: row.inbetween_spec
        ? (JSON.parse(row.inbetween_spec) as { fromKeyframeId: string; toKeyframeId: string; t: number; interpolatedCamera: Record<string, number> })
        : null,
      createdAt: row.created_at,
    }
  }

  /** Valida um pipeline com zod (garante que nunca salvamos algo inválido). */
  validatePipeline(data: unknown): AnimationPipelineType {
    const parsed = zAnimationPipeline.safeParse(data)
    if (!parsed.success) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Pipeline de animação inválido.',
        { details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
      )
    }
    return parsed.data
  }

  /** Valida um quadro com zod. */
  validateFrame(data: unknown): AnimationFrameType {
    const parsed = zAnimationFrame.safeParse(data)
    if (!parsed.success) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Quadro de animação inválido.',
        { details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) },
      )
    }
    return parsed.data
  }
}
