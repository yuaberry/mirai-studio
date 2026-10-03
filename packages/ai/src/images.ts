/**
 * OpenAIImagesProvider — image generation against ANY OpenAI
 * Images-compatible endpoint (`POST {baseUrl}/images/generations`).
 *
 * Transport is injected (FetchLike) like the chat provider, so the whole
 * pipeline is testable offline. Works with whatever endpoint the user
 * configures in Settings → Providers (spec §38/§39: user-owned providers,
 * never hardcoded assumptions about a specific free model).
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike, FetchResponse } from './types'

export interface ImageOptions {
  model: string
  prompt: string
  /** e.g. '1344x768' (wide) | '1024x1024' | '768x1344'. */
  size: string
  signal?: AbortSignal
}

export interface ImageResult {
  /** Decoded PNG bytes, ready to be written to disk. */
  bytes: Buffer
  /** Provider-reported format — normalized (b64 vs url response shapes). */
  mimeType: string
}

interface ImagesApiResponse {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string }
}

export class OpenAIImagesProvider {
  readonly id = 'openai-images'

  constructor(
    private readonly opts: {
      apiKey: string
      baseUrl: string
      fetchFn: FetchLike
      timeoutMs?: number
    },
  ) {}

  async generate(options: ImageOptions): Promise<ImageResult> {
    const timeoutMs = this.opts.timeoutMs ?? 120_000
    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(`${this.opts.baseUrl.replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          prompt: options.prompt,
          size: options.size,
          n: 1,
          response_format: 'b64_json',
        }),
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not reach the image provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }

    if (!response.ok) {
      throw await providerImageError(response)
    }

    let payload: ImagesApiResponse
    try {
      payload = JSON.parse(await response.text()) as ImagesApiResponse
    } catch {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Image provider returned invalid JSON.', {
        retryable: false,
      })
    }
    if (payload.error) {
      throw new MiraiError('AI_PROVIDER_ERROR', payload.error.message ?? 'Image provider error.', {
        retryable: false,
      })
    }
    const entry = payload.data?.[0]
    if (!entry || typeof entry.b64_json !== 'string' || entry.b64_json.length === 0) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        'Image provider returned no image data (b64_json missing).',
        { retryable: false },
      )
    }
    return { bytes: Buffer.from(entry.b64_json, 'base64'), mimeType: 'image/png' }
  }
}

async function providerImageError(response: FetchResponse): Promise<never> {
  let message: string | null = null
  try {
    const payload = JSON.parse(await response.text()) as ImagesApiResponse
    message = payload.error?.message ?? null
  } catch {
    // non-JSON body
  }
  const retryable = response.status === 429 || response.status >= 500
  const friendly =
    response.status === 401
      ? 'Invalid image provider key — check it in Settings → Providers.'
      : response.status === 429
        ? 'Rate limited by the image provider — wait a moment and retry.'
        : response.status >= 500
          ? `Image provider error (${response.status}) — retrying may help.`
          : (message ?? `Image provider error (HTTP ${response.status}).`)
  throw new MiraiError('AI_PROVIDER_ERROR', friendly, { retryable, details: { status: response.status } })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
