/**
 * TimelineService (Phase 5) — the per-scene editing timeline.
 *
 * Tracks are lanes (VIDEO/VOICE/MUSIC/SFX/AMBIENCE); clips reference real
 * sources (shots or media-library tracks). Overlaps on the same track are
 * rejected, moves across tracks validate kind compatibility, splits preserve
 * the source in-point, and ripple delete shifts the rest of the timeline.
 *
 * `buildFromScene` assembles a real timeline from the scene's shots (video +
 * voice) and its assigned media — no mock data, everything resolvable.
 */
import {
  AUDIO_TRACK_KINDS,
  ClipCreateInput,
  ClipPatch,
  MiraiError,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
  TrackPatch,
  TRACK_KIND_LABEL,
  type BlendMode,
  type ClipEffects,
  type ClipSourceType,
  type EntityId,
  type TimelineBundle as TimelineBundleType,
  type TrackKind,
} from '@mirai/shared'
import type { z } from 'zod'
import type { Database } from '../db/connection'
import type { Clock } from '../types'
import { newEntityId } from '../types'
import { KeyframeService } from './keyframeService'

const MIN_CLIP_SEC = 0.05

interface TrackRow {
  id: string
  scene_id: string
  kind: string
  name: string
  order_index: number
  muted: number
  solo: number
  volume: number
  pan: number
  created_at: string
  updated_at: string
}

interface ClipRow {
  id: string
  track_id: string
  source_type: string
  source_id: string
  label: string
  start_sec: number
  duration_sec: number
  in_offset_sec: number
  volume: number
  opacity: number
  blend: string
  effects: string | null
  created_at: string
  updated_at: string
}

interface MarkerRow {
  id: string
  scene_id: string
  at_sec: number
  label: string
  created_at: string
}

interface ShotSourceRow {
  id: string
  title: string
  frame_asset_id: string | null
  audio_asset_id: string | null
  video_asset_id: string | null
  duration_seconds: number
  shot_type: string
  camera_movement: string
  dialogue: string | null
}

interface MediaSourceRow {
  id: string
  title: string
  asset_id: string
  kind: string
}

export class TimelineService {
  readonly keyframes: KeyframeService

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {
    this.keyframes = new KeyframeService(db, clock)
  }

  // ----------------------------------------------------------------- bundle

  /** Full timeline state for a scene: tracks, clips, markers, resolved sources. */
  getTimeline(sceneId: EntityId): TimelineBundleType {
    this.requireScene(sceneId)
    const trackRows = this.db
      .prepare('SELECT * FROM timeline_tracks WHERE scene_id = ? ORDER BY order_index ASC')
      .all(sceneId) as TrackRow[]
    const tracks = trackRows.map(rowToTrack)
    const clipRows =
      trackRows.length === 0
        ? []
        : (this.db
            .prepare(
              `SELECT tc.* FROM timeline_clips tc
               JOIN timeline_tracks tt ON tt.id = tc.track_id
               WHERE tt.scene_id = ?
               ORDER BY tc.start_sec ASC`,
            )
            .all(sceneId) as ClipRow[])
    const clips = clipRows.map((row) => rowToClip(row))
    const markers = (this.db
      .prepare('SELECT * FROM timeline_markers WHERE scene_id = ? ORDER BY at_sec ASC')
      .all(sceneId) as MarkerRow[]).map(rowToMarker)

    const shotIds = new Set(
      clips.filter((c) => c.sourceType === 'SHOT').map((c) => c.sourceId),
    )
    const mediaIds = new Set(
      clips.filter((c) => c.sourceType === 'MEDIA').map((c) => c.sourceId),
    )
    const sources: TimelineBundleType['sources'] = {}
    for (const shotId of shotIds) {
      const row = this.db
        .prepare(
          `SELECT id, title, frame_asset_id, audio_asset_id, video_asset_id, duration_seconds,
                  shot_type, camera_movement, dialogue
           FROM shots WHERE id = ?`,
        )
        .get(shotId) as ShotSourceRow | undefined
      if (!row) continue
      sources[shotId] = {
        type: 'SHOT',
        shotId: row.id,
        title: row.title,
        frameAssetId: row.frame_asset_id,
        audioAssetId: row.audio_asset_id,
        videoAssetId: row.video_asset_id,
        durationSec: row.duration_seconds,
        shotType: row.shot_type,
        cameraMovement: row.camera_movement,
        dialogue: row.dialogue,
      }
    }
    for (const mediaId of mediaIds) {
      const row = this.db
        .prepare('SELECT id, title, asset_id, kind FROM media_tracks WHERE id = ?')
        .get(mediaId) as MediaSourceRow | undefined
      if (!row) continue
      sources[mediaId] = {
        type: 'MEDIA',
        mediaId: row.id,
        assetId: row.asset_id,
        title: row.title,
        mediaKind: row.kind,
      }
    }

    const durationSec = clips.reduce((max, c) => Math.max(max, c.startSec + c.durationSec), 0)
    return { sceneId, durationSec, tracks, clips, markers, sources }
  }

  /**
   * Auto-assemble the scene's timeline from its real content:
   * one VIDEO clip per shot, VOICE clips for shots with audio, and one clip
   * per assigned media track spanning the scene.
   */
  buildFromScene(sceneId: EntityId, reset = true): TimelineBundleType {
    this.requireScene(sceneId)
    const existing = this.db
      .prepare('SELECT COUNT(*) AS n FROM timeline_tracks WHERE scene_id = ?')
      .get(sceneId) as { n: number }
    if (existing.n > 0 && !reset) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'Timeline already has tracks — reset it first or pass reset=true.',
      )
    }
    if (reset) this.resetScene(sceneId)

    const shots = (this.db
      .prepare(
        `SELECT id, title, frame_asset_id, audio_asset_id, duration_seconds
         FROM shots WHERE scene_id = ? ORDER BY order_index ASC`,
      )
      .all(sceneId) as Array<{
        id: string
        title: string
        frame_asset_id: string | null
        audio_asset_id: string | null
        duration_seconds: number
      }>)

    const media = this.db
      .prepare(
        `SELECT mt.id, mt.title, mt.kind FROM scene_media sm
         JOIN media_tracks mt ON mt.id = sm.media_id
         WHERE sm.scene_id = ? ORDER BY sm.rowid ASC`,
      )
      .all(sceneId) as Array<{ id: string; title: string; kind: string }>

    // Scene runtime from shots (fallback 1s when the scene has none yet).
    const runtime = shots.reduce((sum, s) => sum + s.duration_seconds, 0)
    const totalSec = Math.max(runtime, 1)

    const videoTrack = this.createTrack(sceneId, 'VIDEO')
    const voiceTrack = this.createTrack(sceneId, 'VOICE')

    let cursor = 0
    for (const shot of shots) {
      const dur = Math.max(shot.duration_seconds, MIN_CLIP_SEC)
      this.insertClipRaw({
        trackId: videoTrack.id,
        sourceType: 'SHOT',
        sourceId: shot.id,
        label: shot.title,
        startSec: cursor,
        durationSec: dur,
      })
      if (shot.audio_asset_id) {
        this.insertClipRaw({
          trackId: voiceTrack.id,
          sourceType: 'SHOT',
          sourceId: shot.id,
          label: `${shot.title} — voice`,
          startSec: cursor,
          durationSec: dur,
        })
      }
      cursor += dur
    }

    for (const m of media) {
      if ((TRACK_KIND_LABEL as Record<string, string>)[m.kind] === undefined) continue
      const track = this.ensureTrack(sceneId, m.kind as TrackKind)
      this.insertClipRaw({
        trackId: track.id,
        sourceType: 'MEDIA',
        sourceId: m.id,
        label: m.title,
        startSec: 0,
        durationSec: Math.max(totalSec, MIN_CLIP_SEC),
      })
    }

    return this.getTimeline(sceneId)
  }

  resetScene(sceneId: EntityId): void {
    this.requireScene(sceneId)
    const tx = this.db.transaction(() => {
      const trackIds = (this.db
        .prepare('SELECT id FROM timeline_tracks WHERE scene_id = ?')
        .all(sceneId) as Array<{ id: string }>).map((r) => r.id)
      for (const trackId of trackIds) {
        this.keyframes.deleteAll('MIXER', trackId)
        const clips = this.db
          .prepare('SELECT id FROM timeline_clips WHERE track_id = ?')
          .all(trackId) as Array<{ id: string }>
        for (const clip of clips) this.keyframes.deleteAll('CLIP', clip.id)
      }
      this.db.prepare('DELETE FROM timeline_tracks WHERE scene_id = ?').run(sceneId)
      this.db.prepare('DELETE FROM timeline_markers WHERE scene_id = ?').run(sceneId)
    })
    tx()
  }

  // ----------------------------------------------------------------- tracks

  createTrack(sceneId: EntityId, kind: TrackKind, name?: string): TimelineTrack {
    this.requireScene(sceneId)
    const id = newEntityId()
    const now = this.clock.isoNow()
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS max FROM timeline_tracks WHERE scene_id = ?')
      .get(sceneId) as { max: number }
    const label = name ?? TRACK_KIND_LABEL[kind]
    this.db
      .prepare(
        `INSERT INTO timeline_tracks
         (id, scene_id, kind, name, order_index, muted, solo, volume, pan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, 1.0, 0.0, ?, ?)`,
      )
      .run(id, sceneId, kind, label, maxRow.max + 1, now, now)
    return this.getTrack(id)
  }

  getTrack(id: EntityId): TimelineTrack {
    const row = this.db
      .prepare('SELECT * FROM timeline_tracks WHERE id = ?')
      .get(id) as TrackRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Timeline track ${id} not found.`)
    return rowToTrack(row)
  }

  updateTrack(id: EntityId, patch: z.input<typeof TrackPatch>): TimelineTrack {
    const parsed = parseOrThrow(TrackPatch, patch, 'Invalid track patch.')
    this.getTrack(id)
    const sets: string[] = []
    const args: unknown[] = []
    if (parsed.name !== undefined) {
      sets.push('name = ?')
      args.push(parsed.name)
    }
    if (parsed.muted !== undefined) {
      sets.push('muted = ?')
      args.push(parsed.muted ? 1 : 0)
    }
    if (parsed.solo !== undefined) {
      sets.push('solo = ?')
      args.push(parsed.solo ? 1 : 0)
    }
    if (parsed.volume !== undefined) {
      sets.push('volume = ?')
      args.push(parsed.volume)
    }
    if (parsed.pan !== undefined) {
      sets.push('pan = ?')
      args.push(parsed.pan)
    }
    if (sets.length === 0) return this.getTrack(id)
    sets.push('updated_at = ?')
    args.push(this.clock.isoNow(), id)
    this.db.prepare(`UPDATE timeline_tracks SET ${sets.join(', ')} WHERE id = ?`).run(...args)
    return this.getTrack(id)
  }

  deleteTrack(id: EntityId): void {
    this.getTrack(id)
    const tx = this.db.transaction(() => {
      const clips = this.db
        .prepare('SELECT id FROM timeline_clips WHERE track_id = ?')
        .all(id) as Array<{ id: string }>
      for (const clip of clips) this.keyframes.deleteAll('CLIP', clip.id)
      this.keyframes.deleteAll('MIXER', id)
      this.db.prepare('DELETE FROM timeline_tracks WHERE id = ?').run(id)
    })
    tx()
  }

  moveTrack(id: EntityId, toIndex: number): void {
    const track = this.getTrack(id)
    const rows = this.db
      .prepare('SELECT id FROM timeline_tracks WHERE scene_id = ? ORDER BY order_index ASC')
      .all(track.sceneId) as Array<{ id: string }>
    const ids = rows.map((r) => r.id).filter((i) => i !== id)
    const clamped = Math.max(0, Math.min(toIndex, ids.length))
    ids.splice(clamped, 0, id)
    const tx = this.db.transaction(() => {
      const update = this.db.prepare(
        'UPDATE timeline_tracks SET order_index = ?, updated_at = ? WHERE id = ?',
      )
      const now = this.clock.isoNow()
      ids.forEach((trackId, index) => update.run(index, now, trackId))
    })
    tx()
  }

  // ----------------------------------------------------------------- clips

  createClip(input: z.input<typeof ClipCreateInput>): TimelineClip {
    const parsed = parseOrThrow(
      ClipCreateInput,
      input,
      'Invalid clip.',
    )
    const track = this.getTrack(parsed.trackId)
    this.validateSourceForTrack(track, parsed.sourceType, parsed.sourceId)
    this.validateNoOverlap(track.id, null, parsed.startSec, parsed.durationSec)
    return this.insertClipRaw({
      trackId: track.id,
      sourceType: parsed.sourceType,
      sourceId: parsed.sourceId,
      label: parsed.label ?? this.defaultLabel(parsed.sourceType, parsed.sourceId),
      startSec: parsed.startSec,
      durationSec: parsed.durationSec,
      inOffsetSec: parsed.inOffsetSec,
    })
  }

  updateClip(id: EntityId, patch: z.input<typeof ClipPatch>): TimelineClip {
    const parsed = parseOrThrow(ClipPatch, patch, 'Invalid clip patch.')
    const clip = this.getClip(id)
    const startSec = parsed.startSec ?? clip.startSec
    const durationSec = parsed.durationSec ?? clip.durationSec
    const inOffsetSec = parsed.inOffsetSec ?? clip.inOffsetSec
    if (parsed.startSec !== undefined || parsed.durationSec !== undefined) {
      this.validateNoOverlap(clip.trackId, id, startSec, durationSec)
    }
    this.db
      .prepare(
        `UPDATE timeline_clips
         SET label = ?, start_sec = ?, duration_sec = ?, in_offset_sec = ?,
             volume = ?, opacity = ?, blend = ?, effects = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        parsed.label ?? clip.label,
        startSec,
        durationSec,
        inOffsetSec,
        parsed.volume ?? clip.volume,
        parsed.opacity ?? clip.opacity,
        parsed.blend ?? clip.blend,
        JSON.stringify(parsed.effects ?? clip.effects),
        this.clock.isoNow(),
        id,
      )
    return this.getClip(id)
  }

  moveClip(id: EntityId, toTrackId: EntityId | undefined, startSec: number): TimelineClip {
    const clip = this.getClip(id)
    const targetTrackId = toTrackId ?? clip.trackId
    const target = this.getTrack(targetTrackId)
    this.validateSourceForTrack(target, clip.sourceType, clip.sourceId)
    this.validateNoOverlap(targetTrackId, id, startSec, clip.durationSec)
    this.db
      .prepare('UPDATE timeline_clips SET track_id = ?, start_sec = ?, updated_at = ? WHERE id = ?')
      .run(targetTrackId, startSec, this.clock.isoNow(), id)
    return this.getClip(id)
  }

  /** Split at an absolute timeline position — the in-point math is real. */
  splitClip(id: EntityId, atSec: number): { left: TimelineClip; right: TimelineClip } {
    const clip = this.getClip(id)
    if (atSec <= clip.startSec + MIN_CLIP_SEC || atSec >= clip.startSec + clip.durationSec - MIN_CLIP_SEC) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `Split point must be inside the clip (${clip.startSec.toFixed(2)}s–${(clip.startSec + clip.durationSec).toFixed(2)}s).`,
      )
    }
    const leftDur = atSec - clip.startSec
    const rightDur = clip.startSec + clip.durationSec - atSec
    const right = this.insertClipRaw({
      trackId: clip.trackId,
      sourceType: clip.sourceType,
      sourceId: clip.sourceId,
      label: clip.label,
      startSec: atSec,
      durationSec: rightDur,
      inOffsetSec: clip.inOffsetSec + leftDur,
    })
    // Preserve per-clip settings on the new right part.
    this.db
      .prepare(
        'UPDATE timeline_clips SET volume = ?, opacity = ?, blend = ?, effects = ? WHERE id = ?',
      )
      .run(clip.volume, clip.opacity, clip.blend, JSON.stringify(clip.effects), right.id)
    this.db
      .prepare('UPDATE timeline_clips SET duration_sec = ?, updated_at = ? WHERE id = ?')
      .run(leftDur, this.clock.isoNow(), clip.id)
    return { left: this.getClip(clip.id), right: this.getClip(right.id) }
  }

  /** Delete a clip; when `ripple`, later clips across ALL tracks shift left. */
  deleteClip(id: EntityId, ripple = false): void {
    const clip = this.getClip(id)
    const tx = this.db.transaction(() => {
      this.keyframes.deleteAll('CLIP', id)
      this.db.prepare('DELETE FROM timeline_clips WHERE id = ?').run(id)
      if (ripple) {
        const end = clip.startSec + clip.durationSec
        this.db
          .prepare(
            `UPDATE timeline_clips
             SET start_sec = MAX(0, start_sec - ?), updated_at = ?
             WHERE start_sec >= ?`,
          )
          .run(clip.durationSec, this.clock.isoNow(), end)
      }
    })
    tx()
  }

  getClip(id: EntityId): TimelineClip {
    const row = this.db
      .prepare('SELECT * FROM timeline_clips WHERE id = ?')
      .get(id) as ClipRow | undefined
    if (!row) throw new MiraiError('NOT_FOUND', `Timeline clip ${id} not found.`)
    return rowToClip(row)
  }

  /** Every keyframe relevant to a scene: camera of its shots + clip + mixer automation. */
  keyframesForScene(sceneId: EntityId): import('@mirai/shared').KeyframeRecord[] {
    this.requireScene(sceneId)
    const rows = this.db
      .prepare(
        `SELECT k.* FROM keyframes k
         WHERE
           (k.target_type = 'CAMERA' AND k.target_id IN (
             SELECT id FROM shots WHERE scene_id = ?))
           OR (k.target_type = 'CLIP' AND k.target_id IN (
             SELECT tc.id FROM timeline_clips tc
             JOIN timeline_tracks tt ON tt.id = tc.track_id
             WHERE tt.scene_id = ?))
           OR (k.target_type = 'MIXER' AND k.target_id IN (
             SELECT id FROM timeline_tracks WHERE scene_id = ?))
         ORDER BY k.at_sec ASC`,
      )
      .all(sceneId, sceneId, sceneId) as Array<{
      id: string
      target_type: string
      target_id: string
      param: string
      at_sec: number
      value: number
      easing: string
      bezier: string | null
      created_at: string
      updated_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      targetType: row.target_type as import('@mirai/shared').KeyframeTarget,
      targetId: row.target_id,
      param: row.param,
      atSec: row.at_sec,
      value: row.value,
      easing: row.easing as import('@mirai/shared').KeyframeEasing,
      bezier: row.bezier ? (JSON.parse(row.bezier) as [number, number, number, number]) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  // --------------------------------------------------------------- markers

  listMarkers(sceneId: EntityId): TimelineMarker[] {
    this.requireScene(sceneId)
    return (this.db
      .prepare('SELECT * FROM timeline_markers WHERE scene_id = ? ORDER BY at_sec ASC')
      .all(sceneId) as MarkerRow[]).map(rowToMarker)
  }

  createMarker(sceneId: EntityId, atSec: number, label = 'Marker'): TimelineMarker {
    this.requireScene(sceneId)
    const id = newEntityId()
    this.db
      .prepare('INSERT INTO timeline_markers (id, scene_id, at_sec, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, sceneId, atSec, label, this.clock.isoNow())
    return rowToMarker(
      this.db.prepare('SELECT * FROM timeline_markers WHERE id = ?').get(id) as MarkerRow,
    )
  }

  deleteMarker(id: EntityId): void {
    const res = this.db.prepare('DELETE FROM timeline_markers WHERE id = ?').run(id)
    if (res.changes === 0) throw new MiraiError('NOT_FOUND', `Marker ${id} not found.`)
  }

  // --------------------------------------------------------------- internals

  private insertClipRaw(input: {
    trackId: string
    sourceType: ClipSourceType
    sourceId: string
    label: string
    startSec: number
    durationSec: number
    inOffsetSec?: number
  }): TimelineClip {
    const id = newEntityId()
    const now = this.clock.isoNow()
    this.db
      .prepare(
        `INSERT INTO timeline_clips
         (id, track_id, source_type, source_id, label, start_sec, duration_sec,
          in_offset_sec, volume, opacity, blend, effects, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1.0, 1.0, 'normal', '{}', ?, ?)`,
      )
      .run(
        id,
        input.trackId,
        input.sourceType,
        input.sourceId,
        input.label,
        input.startSec,
        input.durationSec,
        input.inOffsetSec ?? 0,
        now,
        now,
      )
    return this.getClip(id)
  }

  /** Shot clips belong on VIDEO/VOICE tracks; MEDIA clips on matching audio tracks. */
  private validateSourceForTrack(track: TimelineTrack, sourceType: ClipSourceType, sourceId: EntityId): void {
    if (track.kind === 'VIDEO') {
      if (sourceType !== 'SHOT') {
        throw new MiraiError('VALIDATION_ERROR', 'Video tracks only accept shots.')
      }
      this.requireShot(sourceId)
      return
    }
    if (!AUDIO_TRACK_KINDS.includes(track.kind)) {
      throw new MiraiError('DB_ERROR', `Unknown track kind ${track.kind}.`)
    }
    if (sourceType === 'SHOT') {
      if (track.kind !== 'VOICE') {
        throw new MiraiError('VALIDATION_ERROR', 'Shots (voice) can only be placed on the Voice track.')
      }
      this.requireShot(sourceId)
      return
    }
    const media = this.db
      .prepare('SELECT kind FROM media_tracks WHERE id = ?')
      .get(sourceId) as { kind: string } | undefined
    if (!media) throw new MiraiError('NOT_FOUND', `Media track ${sourceId} not found.`)
    if (media.kind !== track.kind) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `A ${media.kind.toLowerCase()} clip can't live on a ${track.kind.toLowerCase()} track.`,
      )
    }
  }

  /** Clips on one track must never overlap (spec: real editor behaviour). */
  private validateNoOverlap(trackId: EntityId, excludeClipId: EntityId | null, startSec: number, durationSec: number): void {
    const rows = this.db
      .prepare('SELECT id, start_sec, duration_sec FROM timeline_clips WHERE track_id = ?')
      .all(trackId) as Array<{ id: string; start_sec: number; duration_sec: number }>
    const end = startSec + durationSec
    for (const row of rows) {
      if (excludeClipId && row.id === excludeClipId) continue
      const rowEnd = row.start_sec + row.duration_sec
      const overlaps = startSec < rowEnd - 1e-6 && end > row.start_sec + 1e-6
      if (overlaps) {
        throw new MiraiError(
          'VALIDATION_ERROR',
          `Clips can't overlap on the same track (conflicts with a clip at ${row.start_sec.toFixed(2)}s).`,
        )
      }
    }
  }

  private defaultLabel(sourceType: ClipSourceType, sourceId: EntityId): string {
    if (sourceType === 'SHOT') {
      const row = this.db
        .prepare('SELECT title FROM shots WHERE id = ?')
        .get(sourceId) as { title: string } | undefined
      return row?.title ?? 'Shot'
    }
    const row = this.db
      .prepare('SELECT title FROM media_tracks WHERE id = ?')
      .get(sourceId) as { title: string } | undefined
    return row?.title ?? 'Media'
  }

  private ensureTrack(sceneId: EntityId, kind: TrackKind): TimelineTrack {
    const row = this.db
      .prepare('SELECT id FROM timeline_tracks WHERE scene_id = ? AND kind = ?')
      .get(sceneId, kind) as { id: string } | undefined
    if (row) return this.getTrack(row.id)
    return this.createTrack(sceneId, kind)
  }

  private requireScene(sceneId: EntityId): void {
    const row = this.db.prepare('SELECT id FROM scenes WHERE id = ?').get(sceneId)
    if (!row) throw new MiraiError('NOT_FOUND', `Scene ${sceneId} not found.`)
  }

  private requireShot(shotId: EntityId): void {
    const row = this.db.prepare('SELECT id FROM shots WHERE id = ?').get(shotId)
    if (!row) throw new MiraiError('NOT_FOUND', `Shot ${shotId} not found.`)
  }
}

// ---------------------------------------------------------------- mappers

function rowToTrack(row: TrackRow): TimelineTrack {
  return {
    id: row.id,
    sceneId: row.scene_id,
    kind: row.kind as TrackKind,
    name: row.name,
    orderIndex: row.order_index,
    muted: row.muted === 1,
    solo: row.solo === 1,
    volume: row.volume,
    pan: row.pan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToClip(row: ClipRow): TimelineClip {
  let effects: ClipEffects
  try {
    // Old rows may carry partial `{}` payloads — merge over the defaults.
    effects = {
      brightness: 1,
      contrast: 1,
      saturate: 1,
      hue: 0,
      blur: 0,
      grayscale: 0,
      vignette: 0,
      ...(JSON.parse(row.effects ?? '{}') as Partial<ClipEffects>),
    }
  } catch {
    effects = {
      brightness: 1,
      contrast: 1,
      saturate: 1,
      hue: 0,
      blur: 0,
      grayscale: 0,
      vignette: 0,
    }
  }
  return {
    id: row.id,
    trackId: row.track_id,
    sourceType: row.source_type as ClipSourceType,
    sourceId: row.source_id,
    label: row.label,
    startSec: row.start_sec,
    durationSec: row.duration_sec,
    inOffsetSec: row.in_offset_sec,
    volume: row.volume,
    opacity: row.opacity,
    blend: row.blend as BlendMode,
    effects,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToMarker(row: MarkerRow): TimelineMarker {
  return {
    id: row.id,
    sceneId: row.scene_id,
    atSec: row.at_sec,
    label: row.label,
    createdAt: row.created_at,
  }
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new MiraiError('VALIDATION_ERROR', message, {
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return result.data
}
