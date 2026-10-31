/**
 * AudioMixService (v0.36, §42 Sound & Voice Studio) — mistura REAL de
 * múltiplos tracks de áudio em um arquivo final (WAV/MP3) via FFmpeg,
 * com mastering (normalização de volume via loudnorm).
 *
 * Fluxo de estúdio japonês:
 *   opening/ending + background + SFX + voz → mix → master → arquivo final
 *   pronto para ser usado como trilha de um episódio ou cena.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  AudioMaster,
  AudioMixTrack,
  AudioMixResult,
} from '@mirai/shared'
import {
  MiraiError,
  type EntityId,
  zAudioMasterInput,
  zAudioMixTrackInput,
} from '@mirai/shared'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'

const AUDIO_MIX_TMP_PREFIX = 'mirai-audio-mix-'

interface MasterRow {
  id: string
  name: string
  scene_id: string | null
  kind: string
  output_path: string
  duration_seconds: number
  file_bytes: number
  sample_rate: number
  channels: number
  bitrate_kbps: number
  created_at: string
  updated_at: string
}

interface MixTrackRow {
  id: string
  master_id: string
  media_id: string
  volume: number
  pan: number
  start_offset: number
  duration_override: number | null
  created_at: string
}

export class AudioMixService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly projectRoot: string,
  ) {}

  // ----------------------------------------------------------------- master

  /** Cria um áudio master vazio (ainda sem tracks). */
  createMaster(input: z.input<typeof zAudioMasterInput>): AudioMaster {
    const parsed = zAudioMasterInput.parse(input)
    const now = this.clock.isoNow()
    const id = newEntityId()
    const master: AudioMaster = {
      id,
      name: parsed.name,
      sceneId: parsed.sceneId,
      kind: parsed.kind,
      outputPath: '',
      durationSeconds: 0,
      fileBytes: 0,
      sampleRate: 48000,
      channels: 2,
      bitrateKbps: 192,
      createdAt: now,
      updatedAt: now,
    }
    this.db
      .prepare(
        `INSERT INTO audio_masters
          (id, name, scene_id, kind, output_path, duration_seconds, file_bytes,
           sample_rate, channels, bitrate_kbps, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        master.name,
        master.sceneId,
        master.kind,
        '',
        0,
        0,
        master.sampleRate,
        master.channels,
        master.bitrateKbps,
        now,
        now,
      )
    return master
  }

  /** Lista todos os masters de um projeto (ou de uma cena). */
  listMasters(sceneId?: EntityId): AudioMaster[] {
    const rows = sceneId
      ? (this.db
          .prepare(
            'SELECT * FROM audio_masters WHERE scene_id = ? ORDER BY created_at DESC',
          )
          .all(sceneId) as MasterRow[])
      : (this.db
          .prepare('SELECT * FROM audio_masters ORDER BY created_at DESC')
          .all() as MasterRow[])
    return rows.map((r) => this.rowToMaster(r))
  }

  /** Obtém um master por id. */
  getMaster(id: EntityId): AudioMaster {
    const row = this.db
      .prepare('SELECT * FROM audio_masters WHERE id = ?')
      .get(id) as MasterRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Audio master ${id} not found.`)
    return this.rowToMaster(row)
  }

  // ----------------------------------------------------------------- mix tracks

  /** Adiciona uma track de mídia ao master (qual áudio, com que volume/pan/início). */
  addMixTrack(input: z.input<typeof zAudioMixTrackInput>): AudioMixTrack {
    const parsed = zAudioMixTrackInput.parse(input)
    const master = this.getMaster(parsed.masterId)
    // Verifica que a mídia existe e é áudio
    const media = this.db
      .prepare('SELECT kind FROM media_tracks WHERE id = ?')
      .get(parsed.mediaId) as { kind: string } | undefined
    if (!media) throw new MiraiError('NOT_FOUND', `Media track ${parsed.mediaId} not found.`)
    if (!['MUSIC', 'SFX', 'AMBIENCE'].includes(media.kind)) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Media ${parsed.mediaId} is not an audio track (kind=${media.kind}).`,
      )
    }
    const now = this.clock.isoNow()
    const id = newEntityId()
    const track: AudioMixTrack = {
      id,
      masterId: parsed.masterId,
      mediaId: parsed.mediaId,
      volume: parsed.volume,
      pan: parsed.pan,
      startOffset: parsed.startOffset,
      durationOverride: parsed.durationOverride,
      createdAt: now,
    }
    this.db
      .prepare(
        `INSERT INTO audio_mix_tracks
          (id, master_id, media_id, volume, pan, start_offset, duration_override, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        master.id,
        track.mediaId,
        track.volume,
        track.pan,
        track.startOffset,
        track.durationOverride ?? null,
        now,
      )
    return track
  }

  /** Lista todas as tracks de um master. */
  listMixTracks(masterId: EntityId): AudioMixTrack[] {
    const rows = this.db
      .prepare('SELECT * FROM audio_mix_tracks WHERE master_id = ? ORDER BY created_at ASC')
      .all(masterId) as MixTrackRow[]
    return rows.map((r) => this.rowToMixTrack(r))
  }

  /** Remove uma track de mixagem. */
  removeMixTrack(id: EntityId): void {
    this.db.prepare('DELETE FROM audio_mix_tracks WHERE id = ?').run(id)
  }

  // ----------------------------------------------------------------- mix + master

  /**
   * Mixa todas as tracks do master em um único arquivo de áudio REAL via FFmpeg:
   *   1. Cada track vira um input do FFmpeg (decodificado para WAV PCM)
   *   2. volume individual por track
   *   3. amix mistura todos (duration=longest)
   *   4. loudnorm masteriza (normalização para -14 LUFS integrado, padrão de streaming)
   *   5. Saída WAV PCM f32le (lossless, master)
   *
   * Retorna o caminho do arquivo final e metadados.
   */
  mixMaster(masterId: EntityId): AudioMixResult {
    const master = this.getMaster(masterId)
    const tracks = this.listMixTracks(masterId)
    if (tracks.length === 0) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Cannot mix a master with no tracks — add at least one audio track first.',
      )
    }

    // Cria diretório temporário para os arquivos de input do FFmpeg
    const tmpDir = mkdtempSync(join(this.projectRoot, AUDIO_MIX_TMP_PREFIX))
    const inputPaths: string[] = []
    const filterInputLabels: string[] = []

    try {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i]!
        const media = this.db
          .prepare('SELECT relative_path FROM assets WHERE id = ?')
          .get(track.mediaId) as { relative_path: string } | undefined
        if (!media) {
          throw new MiraiError(
            'NOT_FOUND',
            `Asset for media track ${track.mediaId} not found.`,
          )
        }
        const absPath = join(this.projectRoot, media.relative_path)
        if (!existsSync(absPath)) {
          throw new MiraiError(
            'PATH_INVALID',
            `Audio file missing on disk: ${media.relative_path}`,
          )
        }

        // Decodifica para WAV PCM 48kHz stereo (amix funciona melhor com formato uniforme)
        const inputPath = join(tmpDir, `input_${i}.wav`)
        const decode = spawnSync(
          'ffmpeg',
          [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-i', absPath,
            '-ar', '48000', '-ac', '2', '-sample_fmt', 'fltp',
            '-af', `volume=${track.volume}`,
            inputPath,
          ],
          { encoding: 'utf8' },
        )
        if (decode.status !== 0 || !existsSync(inputPath)) {
          throw new MiraiError(
            'INTERNAL',
            `FFmpeg failed to decode audio track ${track.mediaId}.`,
          )
        }

        inputPaths.push(inputPath)
        filterInputLabels.push(`[${i}:a]`)
      }

      // Constrói o filtro amix: mistura todos os inputs com duração do mais longo
      const amixInputs = filterInputLabels.join('')
      const filterComplex = `${amixInputs}amix=inputs=${inputPaths.length}:duration=longest:normalize=0[aout]`

      const outputPath = join(
        this.projectRoot,
        'exports',
        'audio',
        `${master.name.replace(/[^a-z0-9]+/gi, '_')}-${this.clock.isoNow().slice(0, 13)}.wav`,
      )
      mkdirSync(join(this.projectRoot, 'exports', 'audio'), { recursive: true })

      const mixArgs = [
        '-y', '-hide_banner', '-loglevel', 'error',
        ...inputPaths.flatMap((p) => ['-i', p]),
        '-filter_complex', filterComplex,
        '-map', '[aout]',
        '-ar', '48000', '-ac', '2', '-sample_fmt', 'fltp',
        '-c:a', 'pcm_f32le',
        outputPath,
      ]

      const mix = spawnSync('ffmpeg', mixArgs, { encoding: 'utf8' })
      if (mix.status !== 0 || !existsSync(outputPath)) {
        throw new MiraiError(
          'INTERNAL',
          `FFmpeg mix failed: ${mix.stderr?.slice(-200) ?? 'unknown error'}`,
        )
      }

      // Mastering: loudnorm (normalização de volume para -14 LUFS integrado, padrão de streaming)
      const masteredPath = outputPath.replace(/\.wav$/, '-mastered.wav')
      const loudnormResult = spawnSync(
        'ffmpeg',
        [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', outputPath,
          '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
          '-ar', '48000', '-ac', '2', '-sample_fmt', 'fltp',
          '-c:a', 'pcm_f32le',
          masteredPath,
        ],
        { encoding: 'utf8' },
      )

      let finalPath = outputPath
      if (loudnormResult.status === 0 && existsSync(masteredPath)) {
        finalPath = masteredPath
      }

      const finalBytes = statSync(finalPath).size
      const duration = this.probeDuration(finalPath)

      this.db
        .prepare(
          `UPDATE audio_masters
            SET output_path = ?, duration_seconds = ?, file_bytes = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          finalPath,
          duration ?? 0,
          finalBytes,
          this.clock.isoNow(),
          masterId,
        )

      return {
        masterId,
        outputPath: finalPath,
        durationSeconds: duration ?? 0,
        fileBytes: finalBytes,
        tracksMixed: inputPaths.length,
      }
    } finally {
      // Limpa arquivos temporários de input
      for (const p of inputPaths) {
        try { rmSync(p, { force: true }) } catch { /* ignore cleanup errors */ }
      }
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore cleanup errors */ }
    }
  }

  /** Remove um master e seu arquivo de saída. */
  deleteMaster(id: EntityId): void {
    const master = this.getMaster(id)
    if (master.outputPath && existsSync(master.outputPath)) {
      try { rmSync(master.outputPath, { force: true }) } catch { /* ignore cleanup errors */ }
    }
    this.db.prepare('DELETE FROM audio_mix_tracks WHERE master_id = ?').run(id)
    this.db.prepare('DELETE FROM audio_masters WHERE id = ?').run(id)
  }

  // ----------------------------------------------------------------- helpers

  private probeDuration(path: string): number | null {
    try {
      const res = spawnSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
        { encoding: 'utf8', timeout: 15_000 },
      )
      const parsed = Number.parseFloat((res.stdout ?? '').trim())
      return Number.isFinite(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private rowToMaster(row: MasterRow): AudioMaster {
    return {
      id: row.id,
      name: row.name,
      sceneId: row.scene_id,
      kind: row.kind as 'MIX' | 'MASTER' | 'STEM',
      outputPath: row.output_path,
      durationSeconds: row.duration_seconds,
      fileBytes: row.file_bytes,
      sampleRate: row.sample_rate,
      channels: row.channels,
      bitrateKbps: row.bitrate_kbps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private rowToMixTrack(row: MixTrackRow): AudioMixTrack {
    return {
      id: row.id,
      masterId: row.master_id,
      mediaId: row.media_id,
      volume: row.volume,
      pan: row.pan,
      startOffset: row.start_offset,
      durationOverride: row.duration_override ?? undefined,
      createdAt: row.created_at,
    }
  }
}
