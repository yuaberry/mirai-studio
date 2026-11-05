/**
 * v0.30 — AI voice acting: REAL TTS bytes → real voice assets on shots,
 * and the per-character TTS voice (migration 0018). The provider itself
 * is tested in packages/ai/test/tts.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MiraiError } from '@mirai/shared'
import { CreativeService } from '../src/creative/creativeService'
import { StoryboardService } from '../src/storyboard/storyboardService'
import { openDatabase } from '../src/db/connection'
import { runMigrations } from '../src/db/migrator'
import { PROJECT_DB_MIGRATIONS } from '../src/db/migrations'
import { makeClock } from './helpers'

function makeEnv(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `mirai-v30-${name}-`))
  const db = openDatabase(join(dir, 'project.sqlite'))
  runMigrations(db, PROJECT_DB_MIGRATIONS)
  const clock = makeClock()
  const creative = new CreativeService(db, clock)
  const storyboard = new StoryboardService(db, clock, dir)
  return { dir, db, clock, creative, storyboard }
}

/** Minimal WAV header + payload — real bytes a TTS endpoint could return. */
function fakeWav(bytes = 4_000): Buffer {
  const header = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAKoKCAA', 'base64')
  return Buffer.concat([header, Buffer.alloc(bytes, 1)])
}


describe('registerGeneratedVoice (real asset pipeline)', () => {
  it('stores REAL TTS bytes as the shot voice, replacing + pruning the previous', () => {
    const env = makeEnv('voice-asset')
    const ep = env.creative.createEpisode({ season: 1, number: 1, title: 'P' })
    const scene = env.creative.createScene(ep.id, { title: 'S' })
    const shot = env.storyboard.createShot(scene.id, { title: 'Sh', durationSeconds: 3 })

    const first = env.storyboard.registerGeneratedVoice(shot.id, fakeWav(2_000), 'audio/wav')
    expect(env.storyboard.getShotById(shot.id).voiceAssetId).toBe(first.id)
    expect(existsSync(join(env.dir, 'audio', 'voice', `${first.id}.wav`))).toBe(true)

    // replace prunes the previous (nothing else referenced it)
    const second = env.storyboard.registerGeneratedVoice(shot.id, fakeWav(3_000), 'audio/wav')
    expect(env.storyboard.getShotById(shot.id).voiceAssetId).toBe(second.id)
    expect(existsSync(join(env.dir, 'audio', 'voice', `${first.id}.wav`))).toBe(false)
    expect(readFileSync(join(env.dir, 'audio', 'voice', `${second.id}.wav`)).length).toBeGreaterThanOrEqual(3_000)
  })
})

describe('character TTS voice (migration 0018)', () => {
  it('persists the voice id through the REAL character service', () => {
    const env = makeEnv('char-voice')
    const ayaka = env.creative.createCharacter({
      name: 'Ayaka',
      role: 'PROTAGONIST',
      ttsVoice: 'ayaka-soft',
    })
    expect(ayaka.ttsVoice).toBe('ayaka-soft')

    const updated = env.creative.updateCharacter(ayaka.id, {
      name: 'Ayaka',
      role: 'PROTAGONIST',
      voice: 'calm alto',
      ttsVoice: 'ayaka-calm',
    })
    expect(updated.ttsVoice).toBe('ayaka-calm')

    // clearing works too
    const cleared = env.creative.updateCharacter(ayaka.id, { name: 'Ayaka', role: 'PROTAGONIST' })
    expect(cleared.ttsVoice).toBeUndefined()
    expect(() => env.creative.createCharacter({ name: 'X', role: 'SUPPORTING', ttsVoice: 'x'.repeat(201) })).toThrow(MiraiError)
  })
})
