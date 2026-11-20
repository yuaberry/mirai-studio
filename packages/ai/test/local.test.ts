/**
 * LOCAL generator adapter — the zero-cost anime path (A1111 / ComfyUI).
 *
 * What these tests defend, all of it measured against the real backends'
 * HTTP contracts:
 *
 *   1. SECURITY: the adapter refuses a remote baseUrl. The SD WebUI / ComfyUI
 *      APIs are UNAUTHENTICATED by design, so shipping them over the network
 *      would leak the user's GPU — loopback is the trust boundary.
 *   2. A DOWN service must say "is it running?" and be retryable, not crash.
 *   3. The A1111 payload carries the anime negative prompt, steps and cfg —
 *      without those the model drifts to live-action photography.
 *   4. The `data:image/png;base64,` prefix some A1111 builds prepend must be
 *      stripped before decoding (a naive Buffer.from corrupts the bytes).
 *   5. img2img sends the reference frame + a denoise that keeps the lock.
 *   6. ComfyUI: submit → poll the history → download; the poll waits for the
 *      output instead of reading an empty history as "no result".
 *   7. A malformed pasted workflow is a VALIDATION error, not a crash.
 *   8. The {{prompt}} / {{negative}} / {{seed}} placeholders are injected
 *      safely into the workflow's JSON strings.
 */
import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import { LocalImageProvider, parseLocalBaseUrl, LOCAL_A1111_DEFAULT_PORT, LOCAL_COMFYUI_DEFAULT_PORT } from '../src/local'
import { FakeResponse, makeFetch, type RecordedCall } from './fakes'

/** A 1x1 PNG (real bytes — the adapter validates the decoded length). */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function provider(
  responder: (call: RecordedCall) => FakeResponse,
  opts: { baseUrl?: string; flavor?: 'a1111' | 'comfyui' } = {},
) {
  const transport = makeFetch(responder)
  const instance = new LocalImageProvider({
    baseUrl: opts.baseUrl ?? 'http://127.0.0.1:7860',
    flavor: opts.flavor ?? 'a1111',
    fetchFn: transport.fetchFn,
    timeoutMs: 0,
    sleepFn: async () => undefined,
  })
  return { provider: instance, calls: transport.calls }
}

describe('LocalImageProvider security', () => {
  it('refuses a REMOTE baseUrl — the local APIs are unauthenticated', () => {
    expect(
      () =>
        new LocalImageProvider({
          baseUrl: 'http://192.168.1.50:7860',
          flavor: 'a1111',
          fetchFn: makeFetch(() => new FakeResponse({ text: '' })).fetchFn,
        }),
    ).toThrow(MiraiError)

    try {
      new LocalImageProvider({
        baseUrl: 'http://comfyui.example.com:8188',
        flavor: 'comfyui',
        fetchFn: makeFetch(() => new FakeResponse({ text: '' })).fetchFn,
      })
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toContain('127.0.0.1')
    }
  })

  it('accepts every loopback form', () => {
    for (const baseUrl of ['http://127.0.0.1:7860', 'http://localhost:7860', 'http://[::1]:8188']) {
      expect(
        () =>
          new LocalImageProvider({
            baseUrl,
            flavor: 'a1111',
            fetchFn: makeFetch(() => new FakeResponse({ text: '' })).fetchFn,
          }),
      ).not.toThrow()
    }
  })
})

describe('LocalImageProvider reachability', () => {
  it('a refused connection becomes an actionable AI_OFFLINE', async () => {
    const transport = makeFetch(() => {
      throw new Error('connect ECONNREFUSED')
    })
    const instance = new LocalImageProvider({
      baseUrl: 'http://127.0.0.1:7860',
      flavor: 'a1111',
      fetchFn: transport.fetchFn,
      timeoutMs: 0,
    })
    try {
      await instance.generate({ prompt: 'anime keyframe', width: 512, height: 512 })
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('AI_OFFLINE')
      expect(error.retryable).toBe(true)
      expect(error.message).toContain('running')
    }
  })

  it('a 5xx from the service is a retryable provider error, not a crash', async () => {
    const { provider: instance } = provider(() => new FakeResponse({ status: 503, text: 'busy' }))
    try {
      await instance.generate({ prompt: 'anime keyframe', width: 512, height: 512 })
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('AI_PROVIDER_ERROR')
      expect(error.retryable).toBe(true)
    }
  })
})

describe('LocalImageProvider — A1111', () => {
  it('sends the anime negative prompt, steps and cfg to txt2img', async () => {
    const { provider: instance, calls } = provider(() =>
      new FakeResponse({ json: { images: [PNG_B64] } }),
    )

    const result = await instance.generate({
      prompt: 'MEDIUM: 2D japanese anime keyframe',
      negativePrompt: 'photorealistic, 3d render',
      width: 1344,
      height: 768,
      steps: 30,
      cfgScale: 7.5,
      samplerName: 'Euler a',
      seed: 4242,
    })

    const call = calls.find((c) => c.url.endsWith('/sdapi/v1/txt2img'))
    expect(call).toBeDefined()
    const body = JSON.parse(String(call!.init.body))
    expect(body.prompt).toContain('2D japanese anime keyframe')
    expect(body.negative_prompt).toBe('photorealistic, 3d render')
    expect(body.steps).toBe(30)
    expect(body.cfg_scale).toBe(7.5)
    expect(body.sampler_name).toBe('Euler a')
    expect(body.seed).toBe(4242)
    expect(body.width).toBe(1344)
    // One image per call — a studio keyframe is never a batch grid.
    expect(body.n_iter).toBe(1)
    expect(body.batch_size).toBe(1)
    // Local generation never stamps a vendor logo.
    expect(result.watermarked).toBe(false)
    expect(result.mimeType).toBe('image/png')
  })

  it('decodes the "data:image/png;base64," prefix some builds prepend', async () => {
    const { provider: instance } = provider(() =>
      new FakeResponse({ json: { images: [`data:image/png;base64,${PNG_B64}`] } }),
    )

    const result = await instance.generate({ prompt: 'anime', width: 64, height: 64 })

    // The decoded bytes must be the REAL PNG, not the prefixed string.
    expect(result.bytes.byteLength).toBeGreaterThan(50)
    expect(result.bytes.subarray(0, 8).toString('hex')).toContain('89504e47')
  })

  it('img2img carries the reference frame and a design-preserving denoise', async () => {
    const { provider: instance, calls } = provider(() =>
      new FakeResponse({ json: { images: [PNG_B64] } }),
    )

    await instance.generate({
      prompt: 'anime keyframe',
      width: 768,
      height: 1344,
      imageB64: PNG_B64,
      denoise: 0.55,
    })

    const call = calls.find((c) => c.url.endsWith('/sdapi/v1/img2img'))
    expect(call).toBeDefined()
    const body = JSON.parse(String(call!.init.body))
    expect(body.init_images).toEqual([PNG_B64])
    expect(body.denoising_strength).toBe(0.55)
    // The model sheet is portrait — the size must not silently flip.
    expect(body.width).toBe(768)
    expect(body.height).toBe(1344)
  })

  it('an empty image list is reported, not silently accepted', async () => {
    const { provider: instance } = provider(() => new FakeResponse({ json: { images: [] } }))
    await expect(
      instance.generate({ prompt: 'anime', width: 512, height: 512 }),
    ).rejects.toThrow(/no image/i)
  })

  it('a non-ok answer keeps the status for diagnostics', async () => {
    const { provider: instance } = provider(() => new FakeResponse({ status: 500, text: 'CUDA OOM' }))
    try {
      await instance.generate({ prompt: 'anime', width: 512, height: 512 })
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('AI_PROVIDER_ERROR')
      expect(error.details).toMatchObject({ status: 500 })
    }
  })
})

describe('LocalImageProvider — ComfyUI', () => {
  const WORKFLOW = JSON.stringify({
    prompt: { '1': { inputs: { text: '{{prompt}}', seed: '{{seed}}' } } },
  })

  it('submits, polls the history, then downloads the output', async () => {
    let historyReads = 0
    const { provider: instance, calls } = provider(
      (call) => {
        if (call.url.endsWith('/prompt')) {
          return new FakeResponse({ json: { prompt_id: 'job-1' } })
        }
        if (call.url.includes('/history/job-1')) {
          historyReads += 1
          // First read is empty (still queued), the second has the result.
          if (historyReads < 2) return new FakeResponse({ json: {} })
          return new FakeResponse({
            json: { 'job-1': { outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } },
          })
        }
        if (call.url.includes('/view?')) {
          return new FakeResponse({ bytes: Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)) })
        }
        return new FakeResponse({ status: 200, text: 'comfyui' })
      },
      { baseUrl: 'http://127.0.0.1:8188', flavor: 'comfyui' },
    )

    const result = await instance.runComfyWorkflow({
      workflowJson: WORKFLOW,
      prompt: 'anime keyframe, cel-shaded',
      negativePrompt: 'photorealistic',
    })

    expect(historyReads).toBe(2)
    expect(result.bytes.byteLength).toBeGreaterThan(50)
    expect(result.mimeType).toBe('image/png')
    expect(result.watermarked).toBe(false)

    // The submitted body must carry the injected prompt and a numeric seed.
    const submit = calls.find((c) => c.url.endsWith('/prompt'))
    const body = JSON.parse(String(submit!.init.body))
    expect(body.prompt['1'].inputs.text).toBe('anime keyframe, cel-shaded')
    expect(String(body.prompt['1'].inputs.seed)).toMatch(/^\d+$/)
    // The view URL must address the file the history reported.
    const view = calls.find((c) => c.url.includes('/view?'))
    expect(decodeURIComponent(view!.url)).toContain('filename=out.png')
  })

  it('escapes quotes in the prompt so the workflow never breaks', async () => {
    const { provider: instance, calls } = provider(
      (call) => {
        if (call.url.endsWith('/prompt')) return new FakeResponse({ json: { prompt_id: 'j' } })
        if (call.url.includes('/history/')) {
          return new FakeResponse({ json: { j: { outputs: { '9': { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } } } } })
        }
        return new FakeResponse({ bytes: Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0)) })
      },
      { baseUrl: 'http://127.0.0.1:8188', flavor: 'comfyui' },
    )

    // A prompt with quotes and backslashes is a JSON-injection trap.
    await instance.runComfyWorkflow({ workflowJson: WORKFLOW, prompt: 'she said "hi" \\ end' })

    const submit = calls.find((c) => c.url.endsWith('/prompt'))
    // If the escaping were missing, JSON.parse would have thrown already.
    expect(() => JSON.parse(String(submit!.init.body))).not.toThrow()
    const body = JSON.parse(String(submit!.init.body))
    expect(body.prompt['1'].inputs.text).toBe('she said "hi" \\ end')
  })

  it('a malformed pasted workflow is a VALIDATION error with guidance', async () => {
    const { provider: instance } = provider(() => new FakeResponse({ text: 'comfyui' }), {
      baseUrl: 'http://127.0.0.1:8188',
      flavor: 'comfyui',
    })
    try {
      await instance.runComfyWorkflow({ workflowJson: 'not json at all', prompt: 'anime' })
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toContain('API Format')
    }
  })

  it('a timeout on a long video workflow is reported as retryable', async () => {
    const transport = makeFetch((call) => {
      if (call.url.endsWith('/prompt')) return new FakeResponse({ json: { prompt_id: 'slow' } })
      if (call.url.includes('/history/')) return new FakeResponse({ json: {} })
      return new FakeResponse({ text: 'comfyui' })
    })
    const instance = new LocalImageProvider({
      baseUrl: 'http://127.0.0.1:8188',
      flavor: 'comfyui',
      fetchFn: transport.fetchFn,
      timeoutMs: 0,
      sleepFn: async () => undefined,
      // A real budget, shrunk — the SAME code path runs in production.
      comfyTiming: { pollIntervalMs: 1, pollTimeoutMs: 5 },
    })
    try {
      await instance.runComfyWorkflow({ workflowJson: WORKFLOW, prompt: 'anime' })
      expect.unreachable()
    } catch (err) {
      const error = err as MiraiError
      expect(error.code).toBe('AI_PROVIDER_ERROR')
      expect(error.retryable).toBe(true)
      expect(error.message).toMatch(/did not finish/i)
    }
  })
})

describe('parseLocalBaseUrl', () => {
  it('maps the well-known ports to the right flavor', () => {
    expect(parseLocalBaseUrl('http://127.0.0.1:7860')).toEqual({
      baseUrl: 'http://127.0.0.1:7860',
      flavor: 'a1111',
    })
    expect(parseLocalBaseUrl('http://127.0.0.1:8188/').baseUrl).toBe('http://127.0.0.1:8188')
    expect(parseLocalBaseUrl('http://127.0.0.1:8188').flavor).toBe('comfyui')
  })

  it('publishes the default ports the installers use', () => {
    expect(LOCAL_A1111_DEFAULT_PORT).toBe(7860)
    expect(LOCAL_COMFYUI_DEFAULT_PORT).toBe(8188)
  })
})