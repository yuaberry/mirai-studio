/**
 * OpenAIVideoProvider — video generation against ANY OpenAI-video-compatible
 * endpoint (`POST {baseUrl}/videos/generations` + optional job polling).
 *
 * Two response shapes are handled transparently (spec §38/§39 — the user
 * owns the provider config, we never assume one specific vendor):
 *   1. synchronous: `{ data: [{ b64_json | video: <b64> }] }`
 *   2. asynchronous: `{ id, status }` → poll `GET {baseUrl}/videos/{id}`
 *      until `status` is completed/succeeded, with the payload embedded as
 *      b64 or referenced by a URL we then fetch.
 *
 * Transport is injected (FetchLike) — the whole pipeline is testable offline.
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike, FetchResponse } from './types'

export interface VideoOptions {
  model: string
  prompt: string
  /** Clip length in seconds (1–20). */
  seconds: number
  /** e.g. '1344x768' (wide). */
  size: string
  signal?: AbortSignal
}

export interface VideoResult {
  bytes: Buffer
  mimeType: string
  seconds: number
}

interface VideoApiResponse {
  id?: string
  status?: string
  data?: Array<{ b64_json?: string; video?: string; url?: string }>
  video?: string
  b64_json?: string
  url?: string
  error?: { message?: string }
}

const TERMINAL_OK = new Set(['completed', 'succeeded', 'success', 'done', 'ready'])
const TERMINAL_FAIL = new Set(['failed', 'error', 'cancelled', 'canceled'])

export class OpenAIVideoProvider {
  readonly id = 'openai-video'

  constructor(
    private readonly opts: {
      apiKey: string
      baseUrl: string
      fetchFn: FetchLike
      timeoutMs?: number
      /** Total wall-clock budget for polling (default 10 min). */
      pollBudgetMs?: number
      pollIntervalMs?: number
    },
  ) {}

  async generate(options: VideoOptions): Promise<VideoResult> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(`${base}/videos/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          prompt: options.prompt,
          seconds: options.seconds,
          size: options.size,
          n: 1,
        }),
        signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not reach the video provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
    if (!response.ok) throw await providerVideoError(response)

    let payload: VideoApiResponse
    try {
      payload = JSON.parse(await response.text()) as VideoApiResponse
    } catch {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Video provider returned invalid JSON.', {
        retryable: false,
      })
    }
    if (payload.error) {
      throw new MiraiError('AI_PROVIDER_ERROR', payload.error.message ?? 'Video provider error.', {
        retryable: false,
      })
    }

    // Shape 1: synchronous bytes.
    const b64 =
      payload.data?.[0]?.b64_json ??
      payload.data?.[0]?.video ??
      payload.b64_json ??
      payload.video
    if (typeof b64 === 'string' && b64.length > 0) {
      return {
        bytes: Buffer.from(b64, 'base64'),
        mimeType: 'video/mp4',
        seconds: options.seconds,
      }
    }

    // Shape 2: async job → poll.
    const jobId = payload.id ?? payload.data?.[0]?.url
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Video provider returned no video data or job id.', {
        retryable: false,
      })
    }
    // Some providers return a direct download URL as "id" — fetch it as bytes.
    if (/^https?:\/\//.test(jobId)) {
      const file = await this.fetchBytes(jobId, options)
      return { ...file, seconds: options.seconds }
    }
    return this.pollUntilDone(`${base}/videos/${encodeURIComponent(jobId)}`, options)
  }

  private async pollUntilDone(url: string, options: VideoOptions): Promise<VideoResult> {
    const budget = this.opts.pollBudgetMs ?? 600_000
    const interval = this.opts.pollIntervalMs ?? 4_000
    const deadline = Date.now() + budget
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new MiraiError('CANCELLED', 'Video generation cancelled.')
      }
      await new Promise((r) => setTimeout(r, interval))
      let response: FetchResponse
      try {
        response = await this.opts.fetchFn(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.opts.apiKey}` },
          signal: options.signal ?? AbortSignal.timeout(30_000),
        })
      } catch (err) {
        throw new MiraiError('AI_OFFLINE', `Video job poll failed: ${errorMessage(err)}`, {
          retryable: true,
        })
      }
      if (!response.ok) throw await providerVideoError(response)
      let payload: VideoApiResponse
      try {
        payload = JSON.parse(await response.text()) as VideoApiResponse
      } catch {
        throw new MiraiError('AI_PROVIDER_ERROR', 'Video job returned invalid JSON.', {
          retryable: false,
        })
      }
      const status = (payload.status ?? '').toLowerCase()
      if (TERMINAL_FAIL.has(status)) {
        throw new MiraiError('AI_PROVIDER_ERROR', payload.error?.message ?? `Video job ${status}.`, {
          retryable: false,
        })
      }
      const b64 =
        payload.data?.[0]?.b64_json ?? payload.data?.[0]?.video ?? payload.b64_json ?? payload.video
      const directUrl = payload.data?.[0]?.url ?? payload.url
      if (TERMINAL_OK.has(status)) {
        if (typeof b64 === 'string' && b64.length > 0) {
          return { bytes: Buffer.from(b64, 'base64'), mimeType: 'video/mp4', seconds: options.seconds }
        }
        if (typeof directUrl === 'string' && directUrl.length > 0) {
          const file = await this.fetchBytes(directUrl, options)
          return { ...file, seconds: options.seconds }
        }
        throw new MiraiError('AI_PROVIDER_ERROR', `Video job completed without data (${status}).`, {
          retryable: false,
        })
      }
      if (typeof b64 === 'string' && b64.length > 0) {
        return { bytes: Buffer.from(b64, 'base64'), mimeType: 'video/mp4', seconds: options.seconds }
      }
    }
    throw new MiraiError('AI_PROVIDER_ERROR', 'Video generation timed out while polling.', {
      retryable: true,
    })
  }

  /** Fetch raw bytes from a direct URL (download-link style providers). */
  private async fetchBytes(url: string, options: VideoOptions): Promise<{ bytes: Buffer; mimeType: string }> {
    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Video download failed: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
    if (!response.ok) throw await providerVideoError(response)
    const buffer = response.arrayBuffer
      ? Buffer.from(await response.arrayBuffer())
      : Buffer.from(await response.text(), 'utf8')
    if (buffer.length === 0) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'Video download returned empty bytes.', {
        retryable: false,
      })
    }
    return { bytes: buffer, mimeType: 'video/mp4' }
  }
}

async function providerVideoError(response: FetchResponse): Promise<never> {
  let message: string | null = null
  try {
    const payload = JSON.parse(await response.text()) as VideoApiResponse
    message = payload.error?.message ?? null
  } catch {
    // non-JSON body
  }
  const retryable = response.status === 429 || response.status >= 500
  const friendly =
    response.status === 401
      ? 'Invalid video provider key — check it in Settings → Providers.'
      : response.status === 429
        ? 'Rate limited by the video provider — wait a moment and retry.'
        : response.status >= 500
          ? `Video provider error (${response.status}) — retrying may help.`
          : (message ?? `Video provider error (HTTP ${response.status}).`)
  throw new MiraiError('AI_PROVIDER_ERROR', friendly, { retryable, details: { status: response.status } })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

