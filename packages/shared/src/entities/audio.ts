/**
 * Audio Mix & Master (v0.36, §42 Sound & Voice Studio) — mistura real de
 * múltiplos tracks de áudio em um arquivo final (WAV/MP3) via FFmpeg,
 * com mastering (normalização de volume, compressão simples).
 *
 * Usado para: trilha sonora completa (opening + ending + background),
 * mix de SFX, voz + música + ambiente, masterização de episódio.
 */
import { z } from 'zod'
import { zEntityId, zIsoDate } from '../ids'

/** Um áudio masterizado pronto para uso (episódio, cena, promo). */
export const zAudioMaster = z.object({
  id: zEntityId,
  name: z.string().min(1).max(200),
  /** Cena de origem (opcional — um mix pode ser independente). */
  sceneId: zEntityId.nullable(),
  kind: z.enum(['MIX', 'MASTER', 'STEM']).default('MIX'),
  /** Caminho do arquivo de saída real (exports/audio/). */
  outputPath: z.string().min(1),
  durationSeconds: z.number().min(0).default(0),
  fileBytes: z.number().int().min(0).default(0),
  sampleRate: z.number().int().min(8000).max(192000).default(48000),
  channels: z.number().int().min(1).max(8).default(2),
  bitrateKbps: z.number().int().min(32).max(320).default(192),
  createdAt: zIsoDate,
  updatedAt: zIsoDate,
})
export type AudioMaster = z.infer<typeof zAudioMaster>

export const zAudioMasterInput = z.object({
  name: z.string().min(1).max(200),
  sceneId: zEntityId.nullable().default(null),
  kind: z.enum(['MIX', 'MASTER', 'STEM']).default('MIX'),
})
export type zAudioMasterInput = z.infer<typeof zAudioMasterInput>

/** Uma track dentro de um áudio master — qual mídia toca, com que volume/pan/início. */
export const zAudioMixTrack = z.object({
  id: zEntityId,
  masterId: zEntityId,
  mediaId: zEntityId,
  volume: z.number().min(0).max(2).default(1),
  pan: z.number().min(-1).max(1).default(0),
  startOffset: z.number().min(0).default(0),
  durationOverride: z.number().min(0.01).optional(),
  createdAt: zIsoDate,
})
export type AudioMixTrack = z.infer<typeof zAudioMixTrack>

export const zAudioMixTrackInput = z.object({
  masterId: zEntityId,
  mediaId: zEntityId,
  volume: z.number().min(0).max(2).default(1),
  pan: z.number().min(-1).max(1).default(0),
  startOffset: z.number().min(0).default(0),
  durationOverride: z.number().min(0.01).optional(),
})
export type zAudioMixTrackInput = z.infer<typeof zAudioMixTrackInput>

/** Resultado de uma mixagem concluída. */
export const zAudioMixResult = z.object({
  masterId: zEntityId,
  outputPath: z.string(),
  durationSeconds: z.number(),
  fileBytes: z.number(),
  tracksMixed: z.number(),
})
export type AudioMixResult = z.infer<typeof zAudioMixResult>
