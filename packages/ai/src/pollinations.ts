/**
 * Pollinations providers — image and video against Pollinations' REST API.
 *
 * WHY A SEPARATE ADAPTER
 * ----------------------
 * Pollinations does NOT speak the OpenAI Images/Video protocol for these two
 * capabilities. Its REST API is:
 *
 *   image: GET {base}/prompt/{url-encoded prompt}?model=&width=&height=&seed=&nologo=
 *   video: GET {base}/video/{url-encoded prompt}?model=&duration=&resolution=&image=
 *
 * The classic IMAGE endpoint (image.pollinations.ai) serves a real image
 * with NO API KEY at all — that is the free tier the app can use out of the
 * box. The VIDEO endpoint lives on gen.pollinations.ai and needs a key.
 *
 * WATERMARK
 * ---------
 * `nologo=true` is the vendor's own switch for "do not stamp the output".
 * The app sends it whenever the user leaves "no watermark" enabled, and the
 * prompt also states "no watermark" (belt and braces).
 *
 * The transport is injected (FetchLike) so the whole thing is testable
 * offline — exactly like the OpenAI-compatible providers.
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike, FetchResponse } from './types'

/** Pollinations' classic image endpoint — no key required. */
export const POLLINATIONS_IMAGE_BASE_URL = 'https://image.pollinations.ai'
/** Pollinations' media endpoint — key required for video. */
export const POLLINATIONS_MEDIA_BASE_URL = 'https://gen.pollinations.ai'

export interface PollinationsImageOptions {
  model: string
  prompt: string
  width: number
  height: number
  /** Reproducible seed (-1 = random). */
  seed?: number
  /** Ask the vendor NOT to stamp the output. */
  noWatermark?: boolean
  signal?: AbortSignal
}

export interface PollinationsVideoOptions {
  model: string
  prompt: string
  /** Clip length in seconds. */
  seconds: number
  /** e.g. '480p' | '720p' | '1080p'. */
  resolution?: string
  /** Base64 of the starting frame (image-to-video). */
  imageB64?: string
  /** Mime type of the starting frame (for the upload). */
  imageMimeType?: string
  /** File name of the starting frame (for the upload). */
  imageName?: string
  /** Reproducible seed (-1 = random). */
  seed?: number
  /** Ask the vendor NOT to stamp the output. */
  noWatermark?: boolean
  signal?: AbortSignal
}

export interface PollinationsMediaResult {
  bytes: Buffer
  mimeType: string
  /**
   * The vendor stamped its logo on the output (the classic image endpoint
   * does — `nologo=true` does NOT remove it, it only skips the paid
   * "no logo" pass). The app surfaces this instead of pretending.
   */
  watermarked?: boolean
  /** The start frame was uploaded and sent to the vendor. */
  referenceUsed?: boolean
}

/** Pollinations' free tier allows one image every 45 seconds per IP. */
const FREE_TIER_RETRY_ATTEMPTS = 3

/**
 * Backoff for the transient failures of the endpoint (a 404 from a URL
 * that worked minutes ago, a 5xx from the generation backend).
 */
const TRANSIENT_RETRY_DELAYS_MS = [2_000, 5_000, 12_000] as const

/**
 * Normalizes a prompt for the URL path.
 *
 * MEASURED: the endpoint answers **404 Not Found** when the prompt carries
 * a LINE FEED (`%0A`). The studio prompt builder joins its sections with
 * `\n`, so every frame would have failed with a mysterious 404.
 * A line break means nothing to an image model — it becomes a space.
 */
export function normalizePrompt(prompt: string): string {
  return prompt
    // CRLF / LF / CR / TAB → a single space.
    .replace(/[\r\n\t]+/g, ' ')
    // Other control characters have no place in a URL path.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // Squeeze the runs of spaces the replacements may have created.
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Pollinations image generation (REST). */
export class PollinationsImagesProvider {
  readonly id = 'pollinations-images'

  constructor(
    private readonly opts: {
      baseUrl: string
      fetchFn: FetchLike
      timeoutMs?: number
      /**
       * The wait between retries. Injected so the tests do not have to
       * spend real seconds waiting for a vendor's rate limit.
       */
      sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>
    },
  ) {}

  async generate(options: PollinationsImageOptions): Promise<PollinationsMediaResult> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const url = new URL(`${base}/prompt/${encodeURIComponent(normalizePrompt(options.prompt))}`)
    url.searchParams.set('model', options.model)
    url.searchParams.set('width', String(options.width))
    url.searchParams.set('height', String(options.height))
    url.searchParams.set('seed', String(options.seed ?? -1))
    url.searchParams.set('enhance', 'false')
    if (options.noWatermark !== false) url.searchParams.set('nologo', 'true')

    // The free tier serves ONE image every 45s per IP. The vendor answers
    // 402 with a `Retry-After` header — waiting it out is the difference
    // between a batch of frames and a batch of failures.
    const sleep = this.opts.sleepFn ?? delay
    let response = await this.rawRequest(url.toString(), options.signal)
    for (let attempt = 0; attempt < FREE_TIER_RETRY_ATTEMPTS; attempt++) {
      const waitMs = this.retryDelay(response, attempt)
      if (waitMs === null) break
      await sleep(waitMs, options.signal)
      response = await this.rawRequest(url.toString(), options.signal)
    }
    if (!response.ok) throw await pollinationsError(response, 'image')

    return {
      bytes: await binaryBody(response, 'image'),
      mimeType: mimeOf(response, 'image/jpeg'),
      watermarked: hasLogo(response),
    }
  }

  /**
   * How long to wait before the next attempt — or null when the failure
   * is final (a bad key, a bad model, a missing credit).
   *
   * MEASURED: the endpoint answers 404 Not Found for URLs that worked
   * minutes before (the generation backend bounces the request). The same
   * URL succeeds on the next try, so the app retries instead of dropping
   * the frame.
   */
  private retryDelay(response: FetchResponse, attempt: number): number | null {
    if (isFreeLimit(response)) return retryAfterMs(response)
    if (response.status === 404 || response.status >= 500) {
      return TRANSIENT_RETRY_DELAYS_MS[attempt] ?? null
    }
    return null
  }

  /**
   * The raw HTTP round-trip. It does NOT throw on a non-2xx status: the
   * caller must be able to inspect the response (the free tier answers
   * 402 with a `Retry-After` header) before deciding what to do.
   */
  private async rawRequest(url: string, signal?: AbortSignal): Promise<FetchResponse> {
    try {
      return await this.opts.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'image/*' },
        signal: signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not reach the image provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
  }
}

/** Pollinations' media storage — upload a file, get a public URL back. */
export const POLLINATIONS_MEDIA_STORAGE_URL = 'https://media.pollinations.ai'

/** Pollinations video generation (REST) — Wan 2.2 and friends. */
export class PollinationsVideoProvider {
  readonly id = 'pollinations-video'

  constructor(
    private readonly opts: {
      baseUrl: string
      apiKey?: string
      fetchFn: FetchLike
      timeoutMs?: number
      /** Where the reference frame is uploaded (media.pollinations.ai). */
      mediaBaseUrl?: string
    },
  ) {}

  async generate(options: PollinationsVideoOptions): Promise<PollinationsMediaResult> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const url = new URL(`${base}/video/${encodeURIComponent(normalizePrompt(options.prompt))}`)
    url.searchParams.set('model', options.model)
    url.searchParams.set('duration', String(options.seconds))
    if (options.resolution) url.searchParams.set('resolution', options.resolution)
    if (options.seed !== undefined) url.searchParams.set('seed', String(options.seed))
    if (options.noWatermark !== false) url.searchParams.set('nologo', 'true')

    // THE REFERENCE FRAME
    // ------------------
    // The vendor reads the start frame from the `image` PARAMETER, which
    // travels in the URL. A local frame is ~60 KB of base64 — inlining it
    // produced HTTP 414 (URI Too Long) on every image-to-video request.
    //
    // The documented way is to UPLOAD the file first (media.pollinations.ai
    // answers with a public URL). The upload needs a secret key; without
    // one the request is sent WITHOUT the reference (text-to-video) instead
    // of sending a broken URL.
    let referenceUsed = false
    if (options.imageB64) {
      const publicUrl = await this.uploadReference(options)
      if (publicUrl) {
        url.searchParams.set('image', publicUrl)
        referenceUsed = true
      }
    }

    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'video/mp4',
          ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 900_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not reach the video provider: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
    if (!response.ok) throw await pollinationsError(response, 'video')
    return {
      bytes: await binaryBody(response, 'video'),
      mimeType: mimeOf(response, 'video/mp4'),
      referenceUsed,
    }
  }

  /**
   * Uploads the start frame to the vendor's media storage and returns its
   * public URL — or null when the upload is impossible (no key).
   */
  private async uploadReference(options: PollinationsVideoOptions): Promise<string | null> {
    if (!this.opts.apiKey) return null
    const mediaBase = (this.opts.mediaBaseUrl ?? POLLINATIONS_MEDIA_STORAGE_URL).replace(/\/$/, '')
    const raw = options.imageB64!.replace(/^data:[^;]+;base64,/, '')
    const contentType = options.imageMimeType ?? 'image/jpeg'
    let response: FetchResponse
    try {
      response = await this.opts.fetchFn(`${mediaBase}/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          // The vendor's base64 JSON upload — the raw body upload would
          // need a binary transport the port does not have.
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: raw,
          contentType,
          name: options.imageName ?? 'frame.jpg',
        }),
        signal: options.signal ?? AbortSignal.timeout(this.opts.timeoutMs ?? 900_000),
      })
    } catch (err) {
      throw new MiraiError('AI_OFFLINE', `Could not upload the reference frame: ${errorMessage(err)}`, {
        retryable: true,
      })
    }
    if (!response.ok) {
      throw await pollinationsError(response, 'media upload')
    }
    let payload: { id?: string; url?: string } = {}
    try {
      payload = JSON.parse(await response.text()) as { id?: string; url?: string }
    } catch {
      /* the vendor answers with a Link header when the body is not JSON */
    }
    if (payload.url) return payload.url
    if (payload.id) return `${mediaBase}/${payload.id}`
    const link = response.headers?.get('link')
    const match = link?.match(/<(https?:\/\/[^>]+)>/)
    return match?.[1] ?? null
  }
}

/** Reads a binary body — a text fallback would corrupt the media. */
async function binaryBody(response: FetchResponse, what: string): Promise<Buffer> {
  if (!response.arrayBuffer) {
    throw new MiraiError(
      'AI_PROVIDER_ERROR',
      `The ${what} provider returned a body without binary support.`,
      { retryable: false },
    )
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) {
    throw new MiraiError('AI_PROVIDER_ERROR', `The ${what} provider returned empty bytes.`, {
      retryable: true,
    })
  }
  return buffer
}

function mimeOf(response: FetchResponse, fallback: string): string {
  const header = response.headers?.get('content-type')
  if (typeof header === 'string' && header.length > 0) return header.split(';')[0]!
  return fallback
}

async function pollinationsError(response: FetchResponse, what: string): Promise<never> {
  let message: string | null = null
  let code: string | null = null
  let body = ''
  const contentType = response.headers?.get('content-type') ?? ''
  try {
    body = await response.text()
    const payload = JSON.parse(body) as {
      error?: { message?: string; code?: string }
      message?: string
    }
    message = payload.error?.message ?? payload.message ?? null
    code = payload.error?.code ?? null
  } catch {
    /* non-JSON body — keep the raw text for the diagnostics */
  }
  const freeLimit = isFreeLimit(response) || code === 'FREE_LIMIT'
  const retryable = response.status === 429 || response.status >= 500 || freeLimit
  const friendly = freeLimit
    ? `The ${what} provider's free tier allows one image every 45 seconds — retry after ${retryAfterSec(response)}s.`
    : response.status === 401
      ? `The ${what} provider needs an API key — add one in Settings → Providers (or use the Marketplace).`
      : response.status === 402
        ? `The ${what} provider requires credits — the free tier covers images, not video.`
        : response.status === 429
          ? `Rate limited by the ${what} provider — wait a moment and retry.`
          : response.status === 404
            ? `The ${what} provider could not route the request (404) — a vendor-side hiccup; retry.`
            : response.status >= 500
              ? `${what} provider error (${response.status}) — retrying may help.`
              : (message ?? `${what} provider error (HTTP ${response.status}).`)
  throw new MiraiError('AI_PROVIDER_ERROR', friendly, {
    retryable,
    details: {
      status: response.status,
      vendorCode: code,
      retryAfterSec: retryAfterSec(response),
      contentType,
      // The raw body tells us WHAT the vendor (or the CDN in front of it)
      // answered — the free-limit notice is a JPEG, not a JSON error.
      body: body.slice(0, 300),
    },
  })
}

/**
 * The free tier refuses with HTTP 402 and a `Retry-After` header. The body
 * is sometimes a JSON `FREE_LIMIT` error and sometimes a JPEG that reads
 * "Free limit reached" — both mean the SAME thing: wait.
 *
 * That is a RATE LIMIT, not "you are out of credits" — the distinction
 * matters: one is worth waiting for, the other needs a key.
 */
function isFreeLimit(response: FetchResponse): boolean {
  if (response.status !== 402) return false
  // The video endpoint answers 402 for "not enough pollen" — no wait header.
  return retryAfterSec(response) > 0
}

/** The vendor's `Retry-After` header (seconds), 0 when absent. */
function retryAfterSec(response: FetchResponse): number {
  const raw = response.headers?.get('retry-after')
  if (typeof raw !== 'string') return 0
  const seconds = Number.parseInt(raw, 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

/** How long to wait before the free tier refills. */
function retryAfterMs(response: FetchResponse): number {
  const seconds = retryAfterSec(response)
  // The vendor's own number, with a safety margin and a sane floor.
  return Math.max(5_000, (seconds > 0 ? seconds + 3 : 46) * 1_000)
}

/** The vendor stamps its logo — the response says so in a header. */
function hasLogo(response: FetchResponse): boolean {
  const logo = response.headers?.get('x-pollinations-logo')
  return typeof logo === 'string' && logo.trim().length > 0
}

/** Abortable sleep. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (signal) {
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new MiraiError('AI_OFFLINE', 'The image generation was cancelled.', { retryable: true }))
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
