/**
 * LOCAL providers — image and video generated on the USER'S OWN GPU.
 *
 * WHY THIS ADAPTER EXISTS
 * -----------------------
 * The cloud free tier cannot deliver studio-grade anime: the keyless image
 * endpoint serves a GENERAL model (photorealistic, logo-stamped) and every
 * cloud video model is paid-only. The honest, zero-cost answer is to run the
 * models on the user's own machine and let the app call them over HTTP —
 * exactly like any cloud provider, with no API key and no invoice.
 *
 * Two backends are supported, and the app detects which one is running:
 *
 *   · Automatic1111 (Stable Diffusion WebUI) — default port 7860.
 *     Simple, stable REST API (`/sdapi/v1/txt2img`), the standard choice for
 *     anime checkpoints (Pony Diffusion, Illustrious, Anything V5, Counterfeit,
 *     Animagine XL). Returns base64 in one call — no polling.
 *
 *   · ComfyUI — default port 8188.
 *     Node-graph backend: the user pastes a COMPLETE workflow JSON into
 *     Settings and the adapter injects the prompt/seed/reference frame. This
 *     covers image, img2img, AnimateDiff and Wan 2.2 VIDEO generation without
 *     the app having to guess any vendor's node layout.
 *
 * SECURITY POSTURE
 * ----------------
 * `http://127.0.0.1` / `http://localhost` is the ONLY trust boundary — a local
 * service the user started themselves. The adapter REFUSES any baseUrl that is
 * not loopback: a remote address would mean shipping the (unauthenticated)
 * local API over the network, and this app will not do that silently.
 *
 * WATERMARK
 * ---------
 * Local generation has no vendor logo. `watermarked` is always `false` here —
 * a measured fact, not a promise.
 */
import { MiraiError } from '@mirai/shared'
import type { FetchLike } from './types'

export const LOCAL_A1111_DEFAULT_PORT = 7860
export const LOCAL_COMFYUI_DEFAULT_PORT = 8188

export type LocalFlavor = 'a1111' | 'comfyui'

export interface LocalImageOptions {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  /** A1111 sampling steps (20-30 is the anime sweet spot). */
  steps?: number
  cfgScale?: number
  samplerName?: string
  /** Reproducible seed (-1 = random). */
  seed?: number
  /** image-to-image: the reference frame, base64 WITHOUT the data: prefix. */
  imageB64?: string
  /** Denoising strength for img2img (0..1). 0.55 keeps the design lock. */
  denoise?: number
  /**
   * The anime checkpoint to generate with (A1111 `sd_model_checkpoint`).
   * When set, the adapter loads it before generating — so the user picks the
   * model in Mirai Studio and the app does the switching.
   */
  checkpoint?: string
  signal?: AbortSignal
}

export interface LocalMediaResult {
  bytes: Buffer
  mimeType: string
  /** Local generation never stamps a vendor logo — always false. */
  watermarked: false
}

/** ComfyUI video options — the workflow is user-supplied and fully generic. */
export interface LocalVideoOptions {
  /**
   * The COMPLETE ComfyUI workflow as a JSON string, pasted by the user into
   * Settings. Placeholders are replaced by the adapter before submission:
   *
   *   "{{prompt}}"  → the studio prompt (positive prompt)
   *   "{{negative}}"→ the negative prompt
   *   "{{seed}}"    → the resolved seed
   *   "{{image}}"   → the reference frame FILE NAME inside ComfyUI's input dir
   *
   * Anything not a placeholder is untouched, so ANY workflow (AnimateDiff,
   * Wan 2.2, SVD, LTXV, Hyper-SD…) works without the app knowing its nodes.
   */
  workflowJson: string
  prompt: string
  negativePrompt?: string
  seed?: number
  signal?: AbortSignal
}

/** The workflow output we could decode, as reported by ComfyUI's history. */
interface ComfyOutput {
  filename: string
  subfolder: string
  type: string
}

/** Time ComfyUI is given to finish one queue item (video is slow on a home GPU). */
const COMFY_POLL_INTERVAL_MS = 3_000
const COMFY_POLL_TIMEOUT_MS = 30 * 60_000

/**
 * Timeout budget for the workflow poll. Injected by the tests so they do not
 * have to wait half an hour to prove the timeout path.
 */
export interface ComfyTiming {
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

function stripDataPrefix(b64: string): string {
  const comma = b64.indexOf(',')
  return comma >= 0 && b64.slice(0, comma).includes('base64') ? b64.slice(comma + 1) : b64
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return (
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]'
    )
  } catch {
    return false
  }
}

async function assertReachable(
  baseUrl: string,
  fetchFn: FetchLike,
  signal?: AbortSignal,
): Promise<void> {
  let response
  try {
    response = await fetchFn(`${baseUrl.replace(/\/$/, '')}/`, {
      method: 'GET',
      headers: { Accept: '*/*' },
      signal,
    })
  } catch {
    throw new MiraiError(
      'AI_OFFLINE',
      'Could not reach the local generator. Is Automatic1111 / ComfyUI running ' +
        `on ${baseUrl}? Start it with --api and try again.`,
      { retryable: true },
    )
  }
  // Any HTTP answer proves the service is up; ComfyUI answers 200 on `/`,
  // some A1111 builds answer 404 for the root but 200 on /sdapi/v1/options.
  if (response.status >= 500) {
    // The service is REACHABLE but failing (a crashed CUDA context, an OOM,
    // a model that refuses to load). The status must survive into the error
    // details — it is the only clue the user has to diagnose it.
    throw new MiraiError(
      'AI_PROVIDER_ERROR',
      `The local generator on ${baseUrl} answered ${response.status} — it is running but failing ` +
        '(a crashed CUDA context, an out-of-memory GPU, a model that failed to load). Check its console.',
      { retryable: true, details: { status: response.status } },
    )
  }
}

/**
 * The local generator. One class, one HTTP surface, two flavors — the app
 * never branches on the vendor elsewhere, it just calls `generate`.
 */
export class LocalImageProvider {
  readonly id = 'local-image'

  constructor(
    private readonly opts: {
      /** e.g. 'http://127.0.0.1:7860' (A1111) or 'http://127.0.0.1:8188' (ComfyUI). */
      baseUrl: string
      flavor: LocalFlavor
      fetchFn: FetchLike
      timeoutMs?: number
      sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>
      /** ComfyUI poll timing — overridden by the tests. */
      comfyTiming?: ComfyTiming
    },
  ) {
    if (!isLoopbackBaseUrl(opts.baseUrl)) {
      throw new MiraiError(
        'VALIDATION_ERROR',
        `The local generator must run on this machine (127.0.0.1 / localhost). ` +
          `"${opts.baseUrl}" is a remote address and the app refuses to send it prompts.`,
      )
    }
  }

  // ------------------------------------------------------------------ A1111

  private async generateA1111(options: LocalImageOptions): Promise<LocalMediaResult> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    // The user picks the anime checkpoint in Settings; make sure the backend
    // is actually running it. The check is a GET first, so a warm backend is
    // not forced to reload the model on every single frame.
    if (options.checkpoint) {
      const current = await this.currentCheckpoint(options.signal)
      if (current !== options.checkpoint) {
        await this.setCheckpoint(options.checkpoint, options.signal)
      }
    }
    const endpoint = options.imageB64 ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img'
    const payload: Record<string, unknown> = {
      prompt: options.prompt,
      negative_prompt: options.negativePrompt ?? '',
      width: options.width,
      height: options.height,
      steps: options.steps ?? 28,
      cfg_scale: options.cfgScale ?? 7,
      sampler_name: options.samplerName ?? 'DPM++ 2M Karras',
      seed: options.seed ?? -1,
      n_iter: 1,
      batch_size: 1,
      // A1111 refuses non-multiple-of-8 dimensions in some builds.
      send_images: false,
      do_not_save_samples: true,
      do_not_save_grid: true,
    }
    if (options.imageB64) {
      payload.init_images = [options.imageB64]
      payload.denoising_strength = options.denoise ?? 0.55
    }

    const response = await this.opts.fetchFn(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal,
    })

    if (!response.ok) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        `The local generator answered ${response.status} for ${endpoint}.`,
        { retryable: response.status >= 500, details: { status: response.status } },
      )
    }

    const parsed = JSON.parse(await response.text()) as { images?: string[] }
    const first = parsed.images?.[0]
    if (!first) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'The local generator returned no image.')
    }
    const bytes = Buffer.from(stripDataPrefix(first), 'base64')
    if (bytes.byteLength === 0) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'The local generator returned an empty image.')
    }
    return { bytes, mimeType: 'image/png', watermarked: false }
  }

  // --------------------------------------------------------------- ComfyUI

  /**
   * Uploads a reference frame into ComfyUI's input directory and returns its
   * file name — the value a workflow's LoadImage node expects.
   *
   * Public because the host resolves the `{{image}}` placeholder itself: the
   * workflow is user-supplied, so only the caller knows which node consumes it.
   */
  async uploadImage(imageB64: string, signal?: AbortSignal): Promise<string> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const bytes = Buffer.from(stripDataPrefix(imageB64), 'base64')
    const form = new FormData()
    form.append('image', new Blob([bytes], { type: 'image/png' }), `mirai-ref-${Date.now()}.png`)
    const response = await this.opts.fetchFn(`${base}/upload/image`, {
      method: 'POST',
      headers: {}, // the UA sets multipart itself
      // FormData is body-shaped like a string for FetchLike's contract.
      body: form as unknown as string,
      signal,
    })
    if (!response.ok) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        `Could not upload the reference frame to ComfyUI (${response.status}).`,
        { retryable: response.status >= 500, details: { status: response.status } },
      )
    }
    const parsed = JSON.parse(await response.text()) as { name?: string }
    if (!parsed.name) throw new MiraiError('AI_PROVIDER_ERROR', 'ComfyUI upload returned no name.')
    return parsed.name
  }

  /**
   * Runs a user-supplied ComfyUI workflow to completion and returns the first
   * decoded output (image or video). The adapter never inspects the node
   * graph — it submits, polls the history, and downloads whatever the user's
   * workflow produced.
   */
  async runComfyWorkflow(options: LocalVideoOptions): Promise<LocalMediaResult> {
    await assertReachable(this.opts.baseUrl, this.opts.fetchFn, options.signal)
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31)

    const promptValue = options.workflowJson
      .replaceAll('{{prompt}}', options.prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
      .replaceAll('{{negative}}', (options.negativePrompt ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
      .replaceAll('{{seed}}', String(seed))

    let body: Record<string, unknown>
    try {
      const graph = JSON.parse(promptValue) as { prompt?: unknown }
      body = { prompt: graph.prompt ?? graph }
    } catch {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'The ComfyUI workflow in Settings is not valid JSON — paste the full ' +
          '“Save (API Format)” export from ComfyUI.',
      )
    }

    const submit = await this.opts.fetchFn(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    })
    if (!submit.ok) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        `ComfyUI refused the workflow (${submit.status}).`,
        { retryable: submit.status >= 500, details: { status: submit.status } },
      )
    }
    const queued = JSON.parse(await submit.text()) as { prompt_id?: string }
    if (!queued.prompt_id) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'ComfyUI returned no prompt id.')
    }

    const output = await this.pollComfy(queued.prompt_id, options.signal)
    const { bytes, mimeType } = await this.downloadComfyOutput(output)
    return { bytes, mimeType, watermarked: false }
  }

  private async pollComfy(promptId: string, signal?: AbortSignal): Promise<ComfyOutput> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const deadline = Date.now() + (this.opts.comfyTiming?.pollTimeoutMs ?? COMFY_POLL_TIMEOUT_MS)
    // The loop runs until a REAL OUTPUT appears — an empty history read is
    // "still queued", never "no result".
    let output: ComfyOutput | null = null
    while (!output) {
      if (signal?.aborted) {
        throw new MiraiError('AI_OFFLINE', 'The local generation was cancelled.', { retryable: true })
      }
      if (Date.now() > deadline) {
        throw new MiraiError(
          'AI_PROVIDER_ERROR',
          `The local workflow did not finish in ${Math.round(COMFY_POLL_TIMEOUT_MS / 60_000)} minutes. ` +
            'Long videos need a faster GPU or a smaller workflow.',
          { retryable: true },
        )
      }
      const response = await this.opts.fetchFn(`${base}/history/${promptId}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      })
      if (!response.ok) {
        throw new MiraiError(
          'AI_PROVIDER_ERROR',
          `ComfyUI history answered ${response.status}.`,
          { retryable: response.status >= 500, details: { status: response.status } },
        )
      }
      const history = JSON.parse(await response.text()) as Record<
        string,
        { outputs?: Record<string, { images?: ComfyOutput[]; gifs?: ComfyOutput[]; videos?: ComfyOutput[] }> } | undefined
      >
      const entry = history[promptId]
      const all: ComfyOutput[] = []
      if (entry?.outputs) {
        for (const node of Object.values(entry.outputs)) {
          for (const media of [...(node.images ?? []), ...(node.gifs ?? []), ...(node.videos ?? [])]) {
            all.push(media)
          }
        }
      }
      output = all[0] ?? null
      if (!output) {
        await (this.opts.sleepFn ?? defaultSleep)(
          this.opts.comfyTiming?.pollIntervalMs ?? COMFY_POLL_INTERVAL_MS,
          signal,
        )
      }
    }
    return output
  }

  private async downloadComfyOutput(output: ComfyOutput): Promise<{ bytes: Buffer; mimeType: string }> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const url = new URL(`${base}/view`)
    url.searchParams.set('filename', output.filename)
    url.searchParams.set('subfolder', output.subfolder ?? '')
    url.searchParams.set('type', output.type ?? 'output')
    const response = await this.opts.fetchFn(url.toString(), {
      method: 'GET',
      headers: { Accept: '*/*' },
    })
    if (!response.ok || !response.arrayBuffer) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        `Could not download the ComfyUI output (${response.status}).`,
        { retryable: response.status >= 500, details: { status: response.status } },
      )
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength === 0) {
      throw new MiraiError('AI_PROVIDER_ERROR', 'The ComfyUI output is empty.')
    }
    const mimeType = output.filename.endsWith('.webp')
      ? 'image/webp'
      : output.filename.endsWith('.mp4') || output.filename.endsWith('.webm')
        ? 'video/mp4'
        : 'image/png'
    return { bytes: buffer, mimeType }
  }

  /** The checkpoint the local backend has loaded RIGHT NOW (A1111). */
  private async currentCheckpoint(signal?: AbortSignal): Promise<string | null> {
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const response = await this.opts.fetchFn(`${base}/sdapi/v1/options`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok) return null
    const parsed = JSON.parse(await response.text()) as { sd_model_checkpoint?: string }
    return parsed.sd_model_checkpoint ?? null
  }

  // ---------------------------------------------------------------- checkpoints
  /**
   * Lists the checkpoints the local backend has INSTALLED.
   *
   * A1111 exposes `GET /sdapi/v1/sd-models`. This is how the app answers
   * "which anime checkpoints do I have?" with the truth instead of a guess —
   * the user's model folder is the source of truth, never a hardcoded list.
   */
  async listCheckpoints(signal?: AbortSignal): Promise<string[]> {
    await assertReachable(this.opts.baseUrl, this.opts.fetchFn, signal)
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const response = await this.opts.fetchFn(`${base}/sdapi/v1/sd-models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        `Could not list the local checkpoints (${response.status}).`,
        { retryable: response.status >= 500, details: { status: response.status } },
      )
    }
    const parsed = JSON.parse(await response.text()) as Array<{ title?: string; model_name?: string }>
    // `title` is the value the options endpoint expects back.
    return parsed.map((m) => m.title ?? m.model_name ?? '').filter((t) => t.length > 0)
  }

  /**
   * Switches the checkpoint the local backend uses.
   *
   * A1111 persists it through `POST /sdapi/v1/options` with
   * `sd_model_checkpoint`. This is what makes "every anime checkpoint work"
   * concrete: the user picks the model inside Mirai Studio and the app loads
   * it, instead of requiring them to change it in the WebUI every time.
   */
  async setCheckpoint(title: string, signal?: AbortSignal): Promise<void> {
    await assertReachable(this.opts.baseUrl, this.opts.fetchFn, signal)
    const base = this.opts.baseUrl.replace(/\/$/, '')
    const response = await this.opts.fetchFn(`${base}/sdapi/v1/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sd_model_checkpoint: title }),
      signal,
    })
    if (!response.ok) {
      throw new MiraiError(
        'AI_PROVIDER_ERROR',
        `Could not load the checkpoint "${title}" (${response.status}).`,
        { retryable: response.status >= 500, details: { status: response.status, checkpoint: title } },
      )
    }
  }

  // ---------------------------------------------------------------- unified

  /**
   * Generates an image through the running backend. The app calls ONE method;
   * the flavor is a construction detail.
   */
  async generate(options: LocalImageOptions): Promise<LocalMediaResult> {
    await assertReachable(this.opts.baseUrl, this.opts.fetchFn, options.signal)
    if (this.opts.flavor === 'comfyui') {
      throw new MiraiError(
        'VALIDATION_ERROR',
        'ComfyUI image generation goes through the workflow pipeline ' +
          '(“ComfyUI workflow” in Settings). A1111 is the plain-image backend.',
      )
    }
    return this.generateA1111(options)
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new MiraiError('AI_OFFLINE', 'The local generation was cancelled.', { retryable: true }))
      },
      { once: true },
    )
  })
}

/** Parses 'http://127.0.0.1:7860' style configs into a flavor + normalized URL. */
export function parseLocalBaseUrl(raw: string): { baseUrl: string; flavor: LocalFlavor } {
  const trimmed = raw.trim().replace(/\/$/, '')
  if (trimmed.includes('7860')) return { baseUrl: trimmed, flavor: 'a1111' }
  if (trimmed.includes('8188')) return { baseUrl: trimmed, flavor: 'comfyui' }
  // Default to the A1111 port family when the user typed a bare host.
  return { baseUrl: trimmed, flavor: 'a1111' }
}