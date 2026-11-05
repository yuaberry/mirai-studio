/**
 * Phase 5 — timeline & editing core: tracks, clips, collision rules, splits,
 * ripple delete, markers, keyframes and the shared interpolation math.
 */
import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CAMERA,
  MiraiError,
  easeProgress,
  sampleCamera,
  sampleCurve,
  type TimelineBundle,
} from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { MediaService } from '../src/media/mediaService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { TimelineService } from '../src/timeline/timelineService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-tl-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  const media = new MediaService(db, clock, dir)
  const timeline = new TimelineService(db, clock)
  const episode = creative.createEpisode({ season: 1, number: 1, title: 'Episode One' })
  const scene = creative.createScene(episode.id, { title: 'The rooftop promise' })
  return { dir, db, clock, creative, storyboard, media, timeline, scene }
}

function makeFakeAudio(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mirai-aud-'))
  const file = join(dir, name)
  writeFileSync(file, Buffer.alloc(2048, 0xff))
  return file
}

function seedScene(env: ReturnType<typeof makeEnv>) {
  const shotA = env.storyboard.createShot(env.scene.id, {
    title: 'Rooftop wide',
    shotType: 'WIDE',
    lens: '24mm',
    cameraMovement: 'STATIC',
    durationSeconds: 4,
  })
  const shotB = env.storyboard.createShot(env.scene.id, {
    title: 'Yuna close-up',
    shotType: 'CLOSE_UP',
    lens: '85mm',
    cameraMovement: 'DOLLY_IN',
    durationSeconds: 6,
  })
  return { shotA, shotB }
}

describe('buildFromScene', () => {
  it('assembles real tracks and clips from shots + voice + media', () => {
    const env = makeEnv('build')
    const { shotA } = seedScene(env)
    // Real voice on shot A.
    const voiceFile = makeFakeAudio('line.mp3')
    env.storyboard.importVoice(shotA.id, voiceFile)
    // Real music assigned to the scene.
    const music = env.media.import('MUSIC', makeFakeAudio('opening.mp3'), 'Opening Theme')
    env.media.assignToScene(env.scene.id, music.id, 'OPENING', 1)

    const bundle = env.timeline.buildFromScene(env.scene.id)

    // VIDEO + VOICE + MUSIC tracks.
    expect(bundle.tracks.map((t) => t.kind)).toEqual(['VIDEO', 'VOICE', 'MUSIC'])
    // Two video clips, sequential: 4s + 6s.
    const videoTrack = bundle.tracks[0]!
    const videoClips = bundle.clips.filter((c) => c.trackId === videoTrack.id)
    expect(videoClips).toHaveLength(2)
    expect(videoClips[0]!.startSec).toBeCloseTo(0)
    expect(videoClips[0]!.durationSec).toBeCloseTo(4)
    expect(videoClips[1]!.startSec).toBeCloseTo(4)
    expect(videoClips[1]!.durationSec).toBeCloseTo(6)
    expect(videoClips[0]!.sourceId).toBe(shotA.id)
    // Voice only for the shot that has audio.
    const voiceTrack = bundle.tracks[1]!
    const voiceClips = bundle.clips.filter((c) => c.trackId === voiceTrack.id)
    expect(voiceClips).toHaveLength(1)
    expect(voiceClips[0]!.sourceId).toBe(shotA.id)
    expect(voiceClips[0]!.startSec).toBeCloseTo(0)
    // Music clip spans the full scene at 0.
    const musicTrack = bundle.tracks[2]!
    const musicClips = bundle.clips.filter((c) => c.trackId === musicTrack.id)
    expect(musicClips).toHaveLength(1)
    expect(musicClips[0]!.startSec).toBeCloseTo(0)
    expect(musicClips[0]!.durationSec).toBeCloseTo(10)
    // Duration = end of last clip.
    expect(bundle.durationSec).toBeCloseTo(10)
    // Sources resolve (shot + media), with real asset ids.
    const shotSource = bundle.sources[shotA.id]!
    const mediaSource = bundle.sources[music.id]!
    expect(shotSource.type).toBe('SHOT')
    expect(mediaSource.type).toBe('MEDIA')
    if (shotSource.type === 'SHOT') {
      expect(shotSource.audioAssetId).not.toBeNull()
    }
    if (mediaSource.type === 'MEDIA') {
      expect(mediaSource.assetId).toBe(music.assetId)
    }
  })

  it('refuses to build on top of an existing timeline without reset', () => {
    const env = makeEnv('norereset')
    seedScene(env)
    env.timeline.buildFromScene(env.scene.id)
    expect(() => env.timeline.buildFromScene(env.scene.id, false)).toThrow(MiraiError)
    // With reset=true it rebuilds cleanly.
    const again = env.timeline.buildFromScene(env.scene.id, true)
    expect(again.tracks.length).toBeGreaterThan(0)
  })

  it('reset clears tracks, clips, markers and orphaned keyframes', () => {
    const env = makeEnv('reset')
    seedScene(env)
    const music = env.media.import('MUSIC', makeFakeAudio('bgm.mp3'), 'BGM')
    env.media.assignToScene(env.scene.id, music.id, 'BACKGROUND', 1)
    const bundle = env.timeline.buildFromScene(env.scene.id)
    const musicTrack = bundle.tracks.find((t) => t.kind === 'MUSIC')
    expect(musicTrack).toBeDefined()
    env.timeline.createMarker(env.scene.id, 2.5, 'beat')
    env.timeline.keyframes.upsert({ targetType: 'MIXER', targetId: musicTrack!.id, param: 'volume', atSec: 0, value: 0 })
    env.timeline.resetScene(env.scene.id)
    const cleared = env.timeline.getTimeline(env.scene.id)
    expect(cleared.tracks).toHaveLength(0)
    expect(cleared.clips).toHaveLength(0)
    expect(cleared.markers).toHaveLength(0)
    expect(env.timeline.keyframes.list('MIXER', musicTrack!.id)).toHaveLength(0)
  })
})

describe('tracks', () => {
  it('creates, patches, reorders and deletes tracks', () => {
    const env = makeEnv('tracks')
    const a = env.timeline.createTrack(env.scene.id, 'MUSIC', 'BGM A')
    const b = env.timeline.createTrack(env.scene.id, 'SFX', 'SFX A')
    expect(a.orderIndex).toBe(0)
    expect(b.orderIndex).toBe(1)
    expect(a.volume).toBeCloseTo(1)

    const patched = env.timeline.updateTrack(a.id, { muted: true, volume: 0.5, pan: -0.3 })
    expect(patched.muted).toBe(true)
    expect(patched.volume).toBeCloseTo(0.5)
    expect(patched.pan).toBeCloseTo(-0.3)

    env.timeline.moveTrack(b.id, 0)
    const bundle = env.timeline.getTimeline(env.scene.id)
    expect(bundle.tracks[0]!.id).toBe(b.id)
    expect(bundle.tracks[1]!.id).toBe(a.id)

    env.timeline.deleteTrack(b.id)
    expect(env.timeline.getTimeline(env.scene.id).tracks).toHaveLength(1)
  })

  it('rejects empty patches and unknown scenes', () => {
    const env = makeEnv('trackbad')
    const t = env.timeline.createTrack(env.scene.id, 'MUSIC')
    expect(() => env.timeline.updateTrack(t.id, {} as never)).toThrow(MiraiError)
    expect(() => env.timeline.getTimeline('01HZZZZZZZZZZZZZZZZZZZZZZZZ' as never)).toThrow(MiraiError)
  })
})

describe('clips', () => {
  function built(env: ReturnType<typeof makeEnv>) {
    const { shotA, shotB } = seedScene(env)
    const bundle = env.timeline.buildFromScene(env.scene.id)
    const videoTrack = bundle.tracks.find((t) => t.kind === 'VIDEO')!
    const music = env.media.import('MUSIC', makeFakeAudio('bgm.mp3'), 'BGM')
    return { shotA, shotB, bundle, videoTrack, music }
  }

  it('creates clips with resolved labels and rejects overlaps', () => {
    const env = makeEnv('clipcreate')
    const { shotA, shotB, videoTrack } = built(env)
    const clip = env.timeline.createClip({
      trackId: videoTrack.id,
      sourceType: 'SHOT',
      sourceId: shotB.id,
      startSec: 20,
      durationSec: 2,
    })
    expect(clip.label).toBe(shotB.title)
    expect(clip.inOffsetSec).toBeCloseTo(0)

    // Overlapping the existing 0–4s clip must fail.
    expect(() =>
      env.timeline.createClip({
        trackId: videoTrack.id,
        sourceType: 'SHOT',
        sourceId: shotA.id,
        startSec: 3.9,
        durationSec: 1,
      }),
    ).toThrow(MiraiError)
    // Touching edges (end == start) are allowed.
    const touch = env.timeline.createClip({
      trackId: videoTrack.id,
      sourceType: 'SHOT',
      sourceId: shotA.id,
      startSec: 22,
      durationSec: 1,
    })
    expect(touch.startSec).toBeCloseTo(22)
  })

  it('enforces kind compatibility across tracks', () => {
    const env = makeEnv('kinds')
    const { shotA, videoTrack, music } = built(env)
    // Media on a video track: rejected.
    expect(() =>
      env.timeline.createClip({
        trackId: videoTrack.id,
        sourceType: 'MEDIA',
        sourceId: music.id,
        startSec: 50,
        durationSec: 1,
      }),
    ).toThrow(MiraiError)
    // Shot on its own music track: rejected.
    const musicTrack = env.timeline.createTrack(env.scene.id, 'MUSIC')
    expect(() =>
      env.timeline.createClip({
        trackId: musicTrack.id,
        sourceType: 'SHOT',
        sourceId: shotA.id,
        startSec: 50,
        durationSec: 1,
      }),
    ).toThrow(MiraiError)
  })

  it('moves clips on the same track with collision protection', () => {
    const env = makeEnv('move')
    const { bundle, videoTrack } = built(env)
    const clips = bundle.clips.filter((c) => c.trackId === videoTrack.id)
    const first = clips[0]!
    // Move to a free span.
    const moved = env.timeline.moveClip(first.id, undefined, 30)
    expect(moved.startSec).toBeCloseTo(30)
    // Moving onto the other clip fails.
    expect(() => env.timeline.moveClip(first.id, undefined, 6)).toThrow(MiraiError)
    // Patching the start into the neighbour fails.
    expect(() => env.timeline.updateClip(first.id, { startSec: 9 })).toThrow(MiraiError)
    // Patching duration must respect the same rule (clip now sits at 30..32).
    expect(() => env.timeline.updateClip(first.id, { durationSec: 28 })).not.toThrow()
  })

  it('splits a clip preserving the in-point math', () => {
    const env = makeEnv('split')
    const { bundle, videoTrack } = built(env)
    const clip = bundle.clips.filter((c) => c.trackId === videoTrack.id)[0]!
    // 0–4s clip: trim 1s from the source first to make the math visible.
    const trimmed = env.timeline.updateClip(clip.id, {
      startSec: 0,
      durationSec: 4,
      inOffsetSec: 1,
    })
    expect(trimmed.inOffsetSec).toBeCloseTo(1)
    const { left, right } = env.timeline.splitClip(clip.id, 2.5)
    expect(left.startSec).toBeCloseTo(0)
    expect(left.durationSec).toBeCloseTo(2.5)
    expect(left.inOffsetSec).toBeCloseTo(1)
    expect(right.startSec).toBeCloseTo(2.5)
    expect(right.durationSec).toBeCloseTo(1.5)
    expect(right.inOffsetSec).toBeCloseTo(1 + 2.5)
    // Splitting outside the clip fails.
    expect(() => env.timeline.splitClip(clip.id, 99)).toThrow(MiraiError)
  })

  it('deletes plainly or with ripple shifting the whole timeline', () => {
    const env = makeEnv('ripple')
    const { shotA, bundle, videoTrack } = built(env)
    const clips = bundle.clips.filter((c) => c.trackId === videoTrack.id)
    const first = clips[0]! // 0..4 (shotA)
    const second = clips[1]! // 4..10 (shotB)
    // A music clip starting at 4s too.
    const musicTrack = env.timeline.createTrack(env.scene.id, 'MUSIC')
    const music = env.media.import('MUSIC', makeFakeAudio('m.mp3'), 'M')
    const aligned = env.timeline.createClip({
      trackId: musicTrack.id,
      sourceType: 'MEDIA',
      sourceId: music.id,
      startSec: 4,
      durationSec: 2,
    })
    // Ripple-deleting the FIRST clip shifts everything starting at/after its end.
    env.timeline.deleteClip(first.id, true)
    const after: TimelineBundle = env.timeline.getTimeline(env.scene.id)
    const moved = after.clips.find((c) => c.id === aligned.id)!
    expect(moved.startSec).toBeCloseTo(0)
    const shiftedSecond = after.clips.find((c) => c.id === second.id)!
    expect(shiftedSecond.startSec).toBeCloseTo(0)
    expect(after.clips.find((c) => c.sourceId === shotA.id && c.trackId === videoTrack.id)).toBeUndefined()
    // Plain delete leaves neighbours alone.
    env.timeline.deleteClip(moved.id, false)
    expect(env.timeline.getTimeline(env.scene.id).clips).not.toContainEqual(
      expect.objectContaining({ id: moved.id }),
    )
  })
})

describe('markers', () => {
  it('adds, lists and removes markers in order', () => {
    const env = makeEnv('markers')
    const m1 = env.timeline.createMarker(env.scene.id, 5, 'cut here')
    const m2 = env.timeline.createMarker(env.scene.id, 1.5, 'beat')
    const list = env.timeline.listMarkers(env.scene.id)
    expect(list.map((m) => m.atSec)).toEqual([1.5, 5])
    expect(m1.label).toBe('cut here')
    env.timeline.deleteMarker(m2.id)
    expect(env.timeline.listMarkers(env.scene.id)).toHaveLength(1)
    expect(() => env.timeline.deleteMarker(m2.id)).toThrow(MiraiError)
  })
})

describe('keyframes', () => {
  it('upserts with replace semantics and deletes by target', () => {
    const env = makeEnv('kf')
    const { shotA } = seedScene(env)
    const kf = env.timeline.keyframes.upsert({
      targetType: 'CAMERA',
      targetId: shotA.id,
      param: 'scale',
      atSec: 0,
      value: 1,
    })
    expect(kf.easing).toBe('linear')
    // Same (target, param, atSec) replaces instead of duplicating.
    const replaced = env.timeline.keyframes.upsert({
      targetType: 'CAMERA',
      targetId: shotA.id,
      param: 'scale',
      atSec: 0,
      value: 1.5,
      easing: 'easeOut',
    })
    const list = env.timeline.keyframes.list('CAMERA', shotA.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.value).toBeCloseTo(1.5)
    expect(replaced.id).not.toBe(kf.id)
    // Narrowing by param + deleteAll.
    env.timeline.keyframes.upsert({
      targetType: 'CAMERA',
      targetId: shotA.id,
      param: 'rotation',
      atSec: 0,
      value: 8,
    })
    expect(env.timeline.keyframes.list('CAMERA', shotA.id, 'rotation')).toHaveLength(1)
    env.timeline.keyframes.deleteAll('CAMERA', shotA.id, 'rotation')
    expect(env.timeline.keyframes.list('CAMERA', shotA.id, 'rotation')).toHaveLength(0)
    expect(env.timeline.keyframes.list('CAMERA', shotA.id, 'scale')).toHaveLength(1)
    env.timeline.keyframes.delete(replaced.id)
    expect(env.timeline.keyframes.list('CAMERA', shotA.id)).toHaveLength(0)
  })

  it('resolves all scene keyframes (camera + clip + mixer) in one query', () => {
    const env = makeEnv('scene-kf')
    const { shotA } = seedScene(env)
    // A real voice line guarantees a VOICE clip exists after the build.
    env.storyboard.importVoice(shotA.id, makeFakeAudio('line.mp3'))
    const music = env.media.import('MUSIC', makeFakeAudio('x.mp3'), 'X')
    env.media.assignToScene(env.scene.id, music.id, 'BACKGROUND', 1)
    const built = env.timeline.buildFromScene(env.scene.id)
    const voiceTrack = built.tracks.find((t) => t.kind === 'VOICE')!
    const voiceClip = built.clips.find((c) => c.trackId === voiceTrack.id)
    const kf = env.timeline.keyframes
    kf.upsert({ targetType: 'CAMERA', targetId: shotA.id, param: 'scale', atSec: 0, value: 1 })
    if (voiceClip) {
      kf.upsert({ targetType: 'CLIP', targetId: voiceClip.id, param: 'volume', atSec: 0, value: 0 })
    }
    kf.upsert({ targetType: 'MIXER', targetId: built.tracks.find((t) => t.kind === 'MUSIC')!.id, param: 'volume', atSec: 0, value: 0.5 })
    // A keyframe for a shot in ANOTHER scene must not leak in.
    const episode2 = env.creative.createEpisode({ season: 1, number: 2, title: 'Two' })
    const scene2 = env.creative.createScene(episode2.id, { title: 'Elsewhere' })
    const otherShot = env.storyboard.createShot(scene2.id, { title: 'Other', durationSeconds: 2 })
    kf.upsert({ targetType: 'CAMERA', targetId: otherShot.id, param: 'x', atSec: 0, value: 99 })

    const sceneKfs = env.timeline.keyframesForScene(env.scene.id)
    expect(sceneKfs.some((k) => k.targetType === 'CAMERA' && k.targetId === shotA.id)).toBe(true)
    expect(sceneKfs.some((k) => k.targetType === 'CLIP')).toBe(true)
    expect(sceneKfs.some((k) => k.targetType === 'MIXER')).toBe(true)
    expect(sceneKfs.some((k) => k.targetId === otherShot.id)).toBe(false)
  })

  it('rejects invalid keyframes and stores bezier control points', () => {
    const env = makeEnv('kfbad')
    expect(() =>
      env.timeline.keyframes.upsert({
        targetType: 'CAMERA',
        targetId: '01HZZZZZZZZZZZZZZZZZZZZZZZZ' as never,
        param: '',
        atSec: -1,
        value: 1,
      }),
    ).toThrow(MiraiError)
    const { shotA } = seedScene(env)
    const kf = env.timeline.keyframes.upsert({
      targetType: 'CAMERA',
      targetId: shotA.id,
      param: 'y',
      atSec: 1,
      value: 10,
      easing: 'bezier',
      bezier: [0.1, 0, 0.9, 1],
    })
    expect(kf.bezier).toEqual([0.1, 0, 0.9, 1])
  })
})

describe('interpolation math (shared)', () => {
  const curve = [
    { atSec: 0, value: 0, easing: 'linear' as const },
    { atSec: 1, value: 10, easing: 'easeIn' as const },
    { atSec: 2, value: 0, easing: 'easeOut' as const },
    { atSec: 3, value: 5, easing: 'linear' as const },
  ]

  it('clamps outside the curve and interpolates inside', () => {
    expect(sampleCurve([], 1)).toBeNull()
    expect(sampleCurve(curve, -1)).toBeCloseTo(0)
    expect(sampleCurve(curve, 99)).toBeCloseTo(5)
    // Linear segment: halfway of 0→10.
    expect(sampleCurve(curve, 0.5)).toBeCloseTo(5)
  })

  it('implements every easing preset exactly', () => {
    expect(easeProgress(0.5, 'linear')).toBeCloseTo(0.5)
    expect(easeProgress(0.5, 'easeIn')).toBeCloseTo(0.25)
    expect(easeProgress(0.5, 'easeOut')).toBeCloseTo(0.75)
    expect(easeProgress(0.5, 'easeInOut')).toBeCloseTo(0.5)
    expect(easeProgress(0.25, 'easeInOut')).toBeCloseTo(0.15625)
    // Bézier defaults ≈ CSS ease.
    const eased = easeProgress(0.5, 'bezier')
    expect(eased).toBeGreaterThan(0.45)
    expect(eased).toBeLessThan(0.58)
    // Endpoints are exact for every easing.
    for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier'] as const) {
      expect(easeProgress(0, easing)).toBeCloseTo(0)
      expect(easeProgress(1, easing)).toBeCloseTo(1)
    }
  })

  it('interpolates eased segments between keyframes', () => {
    // Segment 1→2 (10 → 0, easeIn): at 1.5 → 10 − 10×0.25 = 7.5.
    expect(sampleCurve(curve, 1.5)).toBeCloseTo(7.5)
    // Segment 2→3 (0 → 5, easeOut): at 2.25 → progress 0.25 → eased 0.4375 → 2.1875.
    expect(sampleCurve(curve, 2.25)).toBeCloseTo(2.1875)
  })

  it('samples full camera states with defaults for missing curves', () => {
    const env = makeEnv('cam')
    const { shotA: shot } = seedScene(env)
    env.timeline.keyframes.upsert({
      targetType: 'CAMERA',
      targetId: shot.id,
      param: 'scale',
      atSec: 0,
      value: 1,
      easing: 'easeInOut',
    })
    env.timeline.keyframes.upsert({
      targetType: 'CAMERA',
      targetId: shot.id,
      param: 'scale',
      atSec: 4,
      value: 2,
      easing: 'easeInOut',
    })
    const byParam = new Map(
      ['scale', 'x', 'y', 'rotation', 'opacity'].map((param) => [
        param,
        env.timeline.keyframes.list('CAMERA', shot.id, param),
      ]),
    )
    const state = sampleCamera(byParam, 2)
    expect(state.scale).toBeCloseTo(1.5)
    expect(state.x).toBeCloseTo(DEFAULT_CAMERA.x)
    expect(state.y).toBeCloseTo(DEFAULT_CAMERA.y)
    expect(state.rotation).toBeCloseTo(DEFAULT_CAMERA.rotation)
    expect(state.opacity).toBeCloseTo(DEFAULT_CAMERA.opacity)
  })
})
