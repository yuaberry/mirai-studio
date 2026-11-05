/**
 * Google Translate speech — instant, KEYLESS text-to-speech.
 *
 * WHY THIS EXISTS
 * ---------------
 * Voice acting is the one leg of the anime pipeline that a fresh install
 * cannot run: every OpenAI-compatible speech endpoint (OpenAI, Pollinations,
 * Azure, ElevenLabs proxies…) asks for an API key. This adapter speaks to
 * Google Translate's own speech endpoint, which serves a real MP3 with no
 * account at all — so a brand-new user can dub a shot immediately.
 *
 * HONEST LIMITATIONS (surfaced in the UI and in the Marketplace card):
 *   - ONE voice per language: the character list cannot be truly distinct.
 *     The adapter differentiates voices by locale (pt-BR / pt-PT / en-US…)
 *     and by speed, which is enough to tell speakers apart audibly;
 *   - the endpoint is undocumented and rate-limited;
 *   - long text is split into chunks (the endpoint rejects very long input).
 *
 * The endpoint returns raw MP3 frames; chunks are concatenated as MPEG audio
 * frames, which every player and FFmpeg reads as one continuous stream.
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike, FetchResponse } from './types'

/** Google rejects inputs beyond ~200 characters — split well below that. */
const CHUNK_LIMIT = 180

export interface GoogleTtsOptions {
  /** Language/locale code, e.g. 'pt-BR', 'pt-PT', 'en-US'. */
  lang: string
  text: string
  /** Speech rate (0.5 – 2.0). Used to differentiate voices. */
  speed?: number
  signal?: AbortSignal
}

export interface GoogleTtsResult {
  bytes: Buffer
  mimeType: string
}

/**
 * Maps a voice id to what the endpoint understands.
 *
 * The app stores a voice id per character (Characters → voice). For this
 * provider the id is read as a locale when it looks like one, and the
 * trailing digits are read as a speed multiplier — so "pt-BR-1" is Brazilian
 * Portuguese at normal speed and "pt-BR-2" is the same voice faster.
 */
export function parseGoogleVoice(voice: string | undefined): { lang: string; speed: number } {
  const raw = (voice ?? '').trim()
  if (!raw) return { lang: 'pt-BR', speed: 1 }
  const parts = raw.split(/[-_]/).filter(Boolean)
  const langPart = parts.slice(0, 2).join('-')
  const lang = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(langPart) ? langPart : 'pt-BR'
  const speedHint = Number(parts[2] ?? '')
  const speed = Number.isFinite(speedHint) && speedHint >= 0.5 && speedHint <= 2 ? speedHint : 1
  return { lang, speed }
}

export class GoogleTranslateTtsProvider {
  readonly id = 'google-translate-tts'

  constructor(
    private readonly opts: {
      baseUrl?: string
      fetchFn: FetchLike
      timeoutMs?: number
    },
  ) {}

  async speak(options: GoogleTtsOptions): Promise<GoogleTtsResult> {
    const chunks = splitText(options.text, CHUNK_LIMIT)
    if (chunks.length === 0) {
      throw new MiraiError('VALIDATION_ERROR', 'There is no text to speak.', { retryable: false })
    }
    const parts: Buffer[] = []
    for (const chunk of chunks) {
      parts.push(await this.speakChunk(chunk, options))
    }
    return { bytes: Buffer.concat(parts), mimeType: 'audio/mpeg' }
  }

  private async speakChunk(text: string, options: GoogleTtsOptions): Promise<Buffer> {
    const base = (this.opts.baseUrl ?? 'https://translate.google.com').replace(/\/$/, '')
    const url = new URL(`${base}/translate_tts`)
    url.searchParams.set('ie', 'UTF-8')
    url.searchParams.set('client', 'tw-ob')
    url.searchParams.set('tl', options.lang)
    url.searchParams.set('q', text)
    if (options.speed && options.speed !== 1) {
      url.searchParams.set('ttsspeed', String(options.speed))
    }

    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          // The endpoint only answers a browser-like client.
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        },
        signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not reach the voice provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
    if (!response.ok) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        response.status === 429
          ? 'The voice provider is rate-limiting — wait a moment and retry.'
          : `Voice provider error (HTTP ${response.status}).`,
        { retryable: response.status === 429 || response.status >= 500 },
      )
    }
    if (!response.arrayBuffer) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'The voice provider returned no binary body.', {
        retryable: false,
      })
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'The voice provider returned empty audio.', {
        retryable: true,
      })
    }
    return bytes
  }
}

/** Splits on sentence boundaries first, then hard-splits what is left. */
export function splitText(text: string, limit: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return []
  const out: string[] = []
  let rest = clean
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const cut = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf(', '),
      window.lastIndexOf(' '),
    )
    const at = cut > 40 ? cut + 1 : limit
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest.length > 0) out.push(rest)
  return out.filter((c) => c.length > 0)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
