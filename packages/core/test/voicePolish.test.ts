/**
 * VoicePolish — the anti-robot chain, with the REAL bundled FFmpeg.
 *
 * What these tests prove is not "it sounds nicer" (that is your ears); it is
 * that the chain RUNS on real audio, produces a real file, and that a broken
 * chain degrades to the actor's original voice instead of silence.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { VoicePolish, describePolishChain, voicePolishAvailable } from '../src/audio/voicePolish'
import { ffmpegBin } from '../src/render/ffmpegBin'

/** A real 2-second silent-but-valid WAV (the input only needs to decode). */
function makeWav(dir: string): string {
  const path = join(dir, 'voice.wav')
  execFileSync(ffmpegBin(), [
    '-y', '-hide_banner',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=24000',
    '-ac', '1', '-ar', '24000', path,
  ])
  return path
}

const ffmpegReady = (() => {
  try {
    return existsSync(ffmpegBin())
  } catch {
    return false
  }
})()

describe('VoicePolish', () => {
  it('reports availability honestly instead of assuming ffmpeg', () => {
    // A boolean derived from the real binary, not a config flag.
    expect(typeof voicePolishAvailable()).toBe('boolean')
  })

  it('builds the documented chain for every style', () => {
    const polish = new VoicePolish()
    const chain = polish.buildChain('warm')
    // The stages the design promises, in order.
    expect(chain[0]).toContain('highpass=f=70')
    expect(chain.some((f) => f.startsWith('equalizer=f=2600'))).toBe(true)
    expect(chain.some((f) => f.startsWith('aecho='))).toBe(true)
    expect(chain.some((f) => f.startsWith('loudnorm='))).toBe(true)
    // Each style tunes something different — a style that changes nothing
    // would be a decorative select.
    const warm = polish.buildChain('warm').join('|')
    const bright = polish.buildChain('bright').join('|')
    const intimate = polish.buildChain('intimate').join('|')
    expect(new Set([warm, bright, intimate]).size).toBe(3)
  })

  it('describes the chain in words the log can carry', () => {
    const polish = new VoicePolish()
    const text = describePolishChain({ bytes: Buffer.alloc(0), mimeType: '', appliedFilters: polish.buildChain() })
    expect(text).toContain('highpass')
    expect(text).toContain('loudnorm')
    // And it says the honest thing when nothing ran.
    expect(describePolishChain({ bytes: Buffer.alloc(0), mimeType: '', appliedFilters: [] })).toMatch(/skipped/)
  })

  it('polishes a REAL wav into a REAL, decodable file', () => {
    if (!ffmpegReady) return
    const dir = mkdtempSync(join(tmpdir(), 'mirai-voice-'))
    try {
      const input = makeWav(dir)
      const polish = new VoicePolish()
      const result = polish.polish(readFileSync(input), 'audio/wav', 'warm')

      expect(result.appliedFilters.length).toBeGreaterThan(0)
      expect(result.bytes.byteLength).toBeGreaterThan(0)
      // The output must DECODE — a filter chain that produces garbage is worse
      // than none.
      const outPath = join(dir, 'out.wav')
      writeFileSync(outPath, result.bytes)
      const probe = spawnSync(ffmpegBin(), ['-v', 'error', '-i', outPath, '-f', 'null', '-'], { encoding: 'utf8' })
      expect(probe.status).toBe(0)
      expect(probe.stderr.length).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('degrades to the ORIGINAL voice when ffmpeg cannot run', () => {
    // A broken post-processor must never silence the actor.
    const polish = new VoicePolish({ ffmpeg: () => '/nonexistent/ffmpeg' })
    const input = Buffer.from('a real voice clip')
    const result = polish.polish(input, 'audio/mpeg', 'neutral')
    expect(result.bytes).toEqual(input)
    expect(result.appliedFilters).toEqual([])
    expect(describePolishChain(result)).toMatch(/skipped/)
  })
})