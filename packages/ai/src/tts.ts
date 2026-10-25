/**
 * OpenAITtsProvider — AI voice acting against ANY OpenAI-audio-compatible
 * endpoint (`POST {baseUrl}/audio/speech`), the ElevenLabs-recipe piece
 * of the AI-anime pipeline: dialogue text + a voice id → REAL audio
 * bytes that flow through the existing voice/mixer/render pipeline.
 *
 * Transport is injected (FetchLike) — fully testable offline.
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike, FetchResponse } from './types'

export interface TtsOptions {
  model: string
  /** The text to speak (the shot's dialogue, cleaned). */
  input: string
  /** The character's voice id (or the project default). */
  voice: string
  /** Response format we ask for — wav flows into FFmpeg natively. */
  responseFormat?: 'wav' | 'mp3'
  /** Optional speed hint (0.25–4.0). */
  speed?: number
  /** Cooperative abort. */
  signal?: AbortSignal
}

export interface TtsResult {
  bytes: Buffer
  mimeType: string
  model: string
  voice: string
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function ttsError(response: FetchResponse): Promise<MiraiError> {
  let detail = `HTTP ${response.status}`
  try {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      if (parsed.error?.message) detail = parsed.error.message
    } catch {
      if (text.trim().length > 0 && text.length < 400) detail = text.trim()
    }
  } catch {
    /* body already consumed */
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500
  return new MiraiError('AI_PROVIDER_ERROR', `Voice provider error: ${detail}`, { retryable })
}

export class OpenAITtsProvider {
  readonly id = 'openai-tts'

  constructor(
    private readonly opts: {
      apiKey: string
      baseUrl: string
      fetchFn: FetchLike
      timeoutMs?: number
    },
  ) {}

  async speak(options: TtsOptions): Promise<TtsResult> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const format = options.responseFormat ?? 'wav'
    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(`${base}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          input: options.input,
          voice: options.voice,
          response_format: format,
          ...(options.speed !== undefined ? { speed: options.speed } : {}),
        }),
        signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not reach the voice provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
    if (!response.ok) throw await ttsError(response)

    const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
    if (typeof response.arrayBuffer !== 'function') {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Voice provider response has no audio body.', {
        retryable: false,
      })
    }
    let buffer: ArrayBuffer
    try {
      buffer = await response.arrayBuffer()
    } catch (err) {
      throw new MiraiError('AI_PROVIDER_ERROR', `Voice audio failed to read: ${errorMessage(err)}`, {
        retryable: false,
      })
    }
    if (buffer.byteLength === 0) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Voice provider returned empty audio.', { retryable: true })
    }
    return {
      bytes: Buffer.from(buffer),
      mimeType: mime,
      model: options.model,
      voice: options.voice,
    }
  }
}
