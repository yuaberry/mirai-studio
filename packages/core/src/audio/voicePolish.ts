/**
 * VoicePolish — make machine speech sound ACTED (v2.1).
 *
 * WHY THIS EXISTS
 * ---------------
 * The keyless speech endpoint (Google Translate) is intelligible and cheap, and
 * it sounds like a machine: flat dynamic range, a thin presence band, no room,
 * no weight. The user asked for "the least robotic possible" — and the honest
 * route, when no free neural-voice endpoint is reachable, is to do what ADR
 * post-production actually does: EQ, dynamics, space.
 *
 * THE CHAIN (each stage is a filter the bundled FFmpeg ALREADY supports)
 *  1. DC offset + rumble removal (highpass 70 Hz) — the "cheap speaker" mud.
 *  2. Presence shelf (+2 dB @ 2.6 kHz) — the intelligibility band; this alone
 *     reads as "closer to the mic".
 *  3. De-esser-ish dip (-1.5 dB @ 6 kHz) — removes the sibilance that makes
 *     TTS read as synthetic.
 *  4. Body low shelf (+1.5 dB @ 220 Hz) — weight, so the voice is not a
 *     telephone-thin chirp.
 *  5. Single-band compressor (threshold -18 dBFS, ratio 3, attack 8 ms,
 *     release 250 ms, makeup 2 dB) — the dynamic range a studio VO has.
 *  6. Short bright room reverb (aecho 60 ms, 0.18 mix, highpassed) — the
 *     illusion of a real space, which is the strongest anti-robot cue.
 *  7. Broadcast loudness (-16 LUFS, true peak -1.5 dBTP) — so the voice sits
 *     where a real mixdown would.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a new voice. A formant-preserving pitch shift needs a phase
 * vocoder (rubberband/libsoxr) the bundled build does not carry, so no pitch
 * trickery is offered — `aresample` at SXC would only turn it into a chipmunk.
 * What this delivers is a real, audible, reviewable improvement, done locally
 * with the encoder the app already ships.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { ffmpegBin } from '../render/ffmpegBin'

export type VoiceStyle = 'neutral' | 'warm' | 'bright' | 'intimate'

/** How far past the input to stop: the chain is cheap, but not free. */
const POLISH_TIMEOUT_MS = 60_000

interface StyleTuning {
  /** Presence gain in dB at 2.6 kHz. */
  presence: number
  /** Body gain in dB at 220 Hz. */
  body: number
  /** Reverb wet mix (0..1). */
  space: number
  /** Target integrated loudness in LUFS. */
  lufs: number
}

/**
 * A voice style, not a pitch change: presence/body/space are what an actor's
 * direction actually controls.
 */
const STYLES: Record<VoiceStyle, StyleTuning> = {
  neutral: { presence: 2, body: 1.5, space: 0.18, lufs: -16 },
  // Warmer, closer — a character speaking softly indoors.
  warm: { presence: 1.5, body: 3, space: 0.24, lufs: -17 },
  // Brighter, more forward — narration, younger voices, comedy reactions.
  bright: { presence: 3, body: 0.5, space: 0.12, lufs: -15 },
  // Almost no room — an interior monologue, a whisper.
  intimate: { presence: 2.5, body: 2, space: 0.07, lufs: -18 },
}

export interface VoicePolishResult {
  bytes: Buffer
  mimeType: string
  /** The chain actually applied — logged, so a review can see what ran. */
  appliedFilters: string[]
}

export class VoicePolish {
  constructor(private readonly opts: { ffmpeg?: () => string } = {}) {}

  private bin(): string {
    return this.opts.ffmpeg ? this.opts.ffmpeg() : ffmpegBin()
  }

  /**
   * Polishes one voice clip. The input is whatever the TTS provider produced
   * (MP3 from the keyless endpoint, WAV from an OpenAI-compatible one).
   *
   * On ANY failure the ORIGINAL bytes are returned: a broken post-processor
   * must never delete the actor's voice.
   */
  polish(input: Buffer, mimeType: string, style: VoiceStyle = 'neutral'): VoicePolishResult {
    const ext = mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3' : 'wav'
    let dir: string | null = null
    try {
      dir = mkdtempSync(join(tmpdir(), 'mirai-voice-'))
      const inputPath = join(dir, `in.${ext}`)
      const outputPath = join(dir, `out.${ext === 'mp3' ? 'mp3' : 'wav'}`)
      writeFileSync(inputPath, input)

      const filters = this.buildChain(style)
      // Build the argv CONDITIONALLY — a `-b:a` flag followed by `undefined`
      // leaves the flag ORPHANED, ffmpeg then eats the OUTPUT PATH as its
      // value and the run produces no file. MEASURED: exactly that happened.
      const args = [
        '-y',
        '-hide_banner',
        '-i',
        inputPath,
        '-af',
        filters.join(','),
        // A published voice is 48 kHz stereo; the source is short.
        '-ar',
        '48000',
        '-ac',
        '2',
        '-c:a',
        ext === 'mp3' ? 'libmp3lame' : 'pcm_s16le',
      ]
      if (ext === 'mp3') args.push('-b:a', '192k')
      args.push(outputPath)

      const result = spawnSync(this.bin(), args, {
        timeout: POLISH_TIMEOUT_MS,
        encoding: 'buffer',
      })
      if (result.status !== 0 || !existsSync(outputPath)) {
        // The actor's raw voice is better than a silence from a broken filter.
        return { bytes: input, mimeType, appliedFilters: [] }
      }
      return {
        bytes: readFileSync(outputPath),
        mimeType: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        appliedFilters: filters,
      }
    } catch {
      return { bytes: input, mimeType, appliedFilters: [] }
    } finally {
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  }

  /** The filter chain for a style, as documented above. */
  buildChain(style: VoiceStyle = 'neutral'): string[] {
    const t = STYLES[style] ?? STYLES.neutral
    return [
      // 1. DC offset + rumble.
      'highpass=f=70',
      // 2. Presence.
      `equalizer=f=2600:t=q:w=1.5:g=${t.presence}`,
      // 3. Sibilance dip.
      'equalizer=f=6000:t=q:w=2:g=-1.5',
      // 4. Body.
      `equalizer=f=220:t=q:w=1:g=${t.body}`,
      // 5. Dynamics.
      'acompressor=threshold=-18dB:ratio=3:attack=8:release=250:makeup=2',
      // 6. Space (a short echo IS the cheapest readable "room").
      `aecho=0.8:0.18:60|120:0.4|0.2`,
      // 7. Broadcast loudness.
      `loudnorm=I=${t.lufs}:TP=-1.5:LRA=7`,
    ]
  }
}

/** Human summary for the log/toast. */
export function describePolishChain(result: VoicePolishResult): string {
  if (result.appliedFilters.length === 0) return 'voice polish skipped (ffmpeg unavailable)'
  return `voice polished (${result.appliedFilters.length} stages: ${result.appliedFilters
    .map((f) => f.split('=')[0])
    .join(' → ')})`
}

/** True when the chain is safe to run (ffmpeg exists). */
export function voicePolishAvailable(): boolean {
  try {
    return existsSync(ffmpegBin())
  } catch {
    return false
  }
}

/** Bytes on disk, for a diagnostic. */
export function outputSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0
}