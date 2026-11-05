/**
 * Pollinations adapter — the regressions we measured against the LIVE
 * endpoint, locked as unit tests (no network in the test itself):
 *
 *   1. `include_usage` style vendor quirks are not our problem here, but
 *      the FREE LIMIT is: the vendor answers HTTP 402 with a
 *      `Retry-After` header when the per-IP bucket is empty.
 *   2. A 402 is a RATE LIMIT, not "you are out of credits" — treating it
 *      as a fatal error made every batch of frames fail.
 *   3. A 404 from the same URL succeeds moments later — it is a
 *      vendor-side hiccup and must be retried, not surfaced.
 *   4. The prompt goes into the URL PATH: control characters (the studio
 *      prompt builder joins sections with "\n") must be normalized.
 *   5. The vendor tells us, through a header, that it stamped its logo.
 */
import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import {
  PollinationsImagesProvider,
  PollinationsVideoProvider,
  normalizePrompt,
} from '../src/pollinations'
import { FakeResponse, makeFetch, type RecordedCall } from './fakes'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

/**
 * The fake transport records the call BEFORE calling the responder, so the
 * index of the response is `calls.length` (1 for the first attempt).
 */
function imagesWith(responder: (call: RecordedCall, attempt: number) => FakeResponse) {
  const transport = makeFetch((call) => responder(call, transport.calls.length))
  const provider = new PollinationsImagesProvider({
    baseUrl: 'https://image.pollinations.ai',
    fetchFn: transport.fetchFn,
    timeoutMs: 0,
    // The waits are real seconds on the vendor side — the tests do not
    // pay for them.
    sleepFn: async () => undefined,
  })
  return { provider, calls: transport.calls }
}

describe('normalizePrompt', () => {
  it('turns line breaks into spaces (the endpoint 404s on %0A in the path)', () => {
    const prompt = 'FRAMING: medium\nSUBJECT: a duel\nSTYLE:\n- cel-shaded'
    const normalized = normalizePrompt(prompt)
    expect(normalized).not.toContain('\n')
    expect(normalized).toContain('FRAMING: medium SUBJECT: a duel')
    expect(normalized).toContain('STYLE: - cel-shaded')
  })

  it('removes control characters and squeezes the spaces', () => {
    expect(normalizePrompt('a\u0000b\tc\n\nd  e')).toBe('a b c d e')
  })

  it('keeps the prompt meaning intact (no content is dropped)', () => {
    const prompt = 'anime keyframe — café ✨ 日本語, "Haruka" / "Lin"'
    expect(normalizePrompt(prompt)).toBe(prompt)
  })
})

describe('PollinationsImagesProvider', () => {
  it('builds the REST URL the vendor actually serves', async () => {
    const { provider, calls } = imagesWith(
      () => new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } }),
    )

    const result = await provider.generate({
      model: 'flux',
      prompt: 'anime keyframe',
      width: 1344,
      height: 768,
    })

    const url = new URL(calls[0]!.url)
    expect(url.origin + url.pathname).toBe('https://image.pollinations.ai/prompt/anime%20keyframe')
    expect(url.searchParams.get('model')).toBe('flux')
    expect(url.searchParams.get('width')).toBe('1344')
    expect(url.searchParams.get('height')).toBe('768')
    expect(url.searchParams.get('nologo')).toBe('true')
    expect(url.searchParams.get('enhance')).toBe('false')
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.bytes.length).toBe(JPEG.length)
  })

  it('never puts a line break in the URL path', async () => {
    const { provider, calls } = imagesWith(
      () => new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } }),
    )

    await provider.generate({
      model: 'flux',
      prompt: 'FRAMING: medium\nSUBJECT: duel',
      width: 1024,
      height: 1024,
    })

    expect(calls[0]!.url).not.toContain('%0A')
    expect(decodeURIComponent(calls[0]!.url)).not.toContain('\n')
  })

  it('reports the vendor logo instead of pretending the frame is clean', async () => {
    const { provider } = imagesWith(
      () =>
        new FakeResponse({
          status: 200,
          bytes: JPEG,
          headers: {
            'content-type': 'image/jpeg',
            // The vendor stamps the logo on every classic-endpoint image.
            'x-pollinations-logo': 'https://example.test/logo.svg',
          },
        }),
    )

    const result = await provider.generate({
      model: 'flux',
      prompt: 'anime keyframe',
      width: 1024,
      height: 1024,
    })

    expect(result.watermarked).toBe(true)
  })

  it('waits out the free limit (HTTP 402 + Retry-After) and succeeds', async () => {
    const { provider, calls } = imagesWith((_call, attempt) =>
      attempt === 1
        ? new FakeResponse({
            status: 402,
            // The vendor answers the free limit with a JPEG notice.
            bytes: JPEG,
            headers: { 'content-type': 'image/jpeg', 'retry-after': '1' },
          })
        : new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } }),
    )

    const result = await provider.generate({
      model: 'flux',
      prompt: 'anime keyframe',
      width: 1024,
      height: 1024,
    })

    expect(calls.length).toBe(2)
    expect(result.bytes.length).toBe(JPEG.length)
  })

  it('retries a 404 — the same URL succeeds on the next attempt', async () => {
    const { provider, calls } = imagesWith((_call, attempt) =>
      attempt === 1
        ? new FakeResponse({ status: 404, text: '404 Not Found' })
        : new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } }),
    )

    const result = await provider.generate({
      model: 'flux',
      prompt: 'anime keyframe',
      width: 1024,
      height: 1024,
    })

    expect(calls.length).toBe(2)
    expect(result.bytes.length).toBe(JPEG.length)
  })

  it('reports a missing key instead of a generic error', async () => {
    const { provider } = imagesWith(
      () => new FakeResponse({ status: 401, json: { error: { message: 'no key' } } }),
    )

    const error = await provider
      .generate({ model: 'flux', prompt: 'anime keyframe', width: 1024, height: 1024 })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(MiraiError)
    expect((error as MiraiError).message).toMatch(/needs an API key/i)
    expect((error as MiraiError).retryable).toBe(false)
  })

  it('gives up with the vendor body when every attempt fails', async () => {
    const { provider, calls } = imagesWith(
      () => new FakeResponse({ status: 500, text: 'boom' }),
    )

    const error = await provider
      .generate({ model: 'flux', prompt: 'anime keyframe', width: 1024, height: 1024 })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(MiraiError)
    expect((error as MiraiError).retryable).toBe(true)
    // 1 initial attempt + the transient retries.
    expect(calls.length).toBeGreaterThan(1)
  })
})

describe('PollinationsVideoProvider', () => {
  it('calls the media endpoint with the duration and the no-logo flag', async () => {
    const transport = makeFetch(
      () =>
        new FakeResponse({
          status: 200,
          bytes: JPEG,
          headers: { 'content-type': 'video/mp4' },
        }),
    )
    const provider = new PollinationsVideoProvider({
      baseUrl: 'https://gen.pollinations.ai',
      fetchFn: transport.fetchFn,
      timeoutMs: 0,
    })

    await provider.generate({
      model: 'alibaba/wan-2.2-fast',
      prompt: 'two women sparring\nin a gym',
      seconds: 3,
      resolution: '720p',
    })

    const url = new URL(transport.calls[0]!.url)
    expect(url.pathname.startsWith('/video/')).toBe(true)
    expect(url.searchParams.get('model')).toBe('alibaba/wan-2.2-fast')
    expect(url.searchParams.get('duration')).toBe('3')
    expect(url.searchParams.get('resolution')).toBe('720p')
    expect(url.searchParams.get('nologo')).toBe('true')
    expect(transport.calls[0]!.url).not.toContain('%0A')
  })

  it('sends the key when there is one', async () => {
    const transport = makeFetch(
      () => new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'video/mp4' } }),
    )
    const provider = new PollinationsVideoProvider({
      baseUrl: 'https://gen.pollinations.ai',
      apiKey: 'pollen-test-key',
      fetchFn: transport.fetchFn,
      timeoutMs: 0,
    })

    await provider.generate({ model: 'alibaba/wan-2.2-fast', prompt: 'duel', seconds: 2 })

    expect(transport.calls[0]!.init.headers['Authorization']).toBe('Bearer pollen-test-key')
  })

  it('never inlines the reference frame in the URL (that was HTTP 414)', async () => {
    const transport = makeFetch(
      () => new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'video/mp4' } }),
    )
    const provider = new PollinationsVideoProvider({
      baseUrl: 'https://gen.pollinations.ai',
      fetchFn: transport.fetchFn,
      timeoutMs: 0,
    })

    // A 60 KB frame — exactly what a generated keyframe weighs.
    const frame = Buffer.alloc(60_000, 7).toString('base64')
    const result = await provider.generate({
      model: 'alibaba/wan-2.2-fast',
      prompt: 'duel',
      seconds: 2,
      imageB64: frame,
    })

    const call = transport.calls[0]!
    expect(call.url.length).toBeLessThan(2_000)
    expect(call.url).not.toContain('image=')
    // No key → no upload possible → the clip is text-to-video, and the
    // result says so instead of pretending the frame was used.
    expect(result.referenceUsed).toBe(false)
  })

  it('uploads the reference frame and sends its public URL', async () => {
    const transport = makeFetch((call) =>
      call.url.endsWith('/upload')
        ? new FakeResponse({ status: 200, json: { id: 'abc123', url: 'https://media.pollinations.ai/abc123' } })
        : new FakeResponse({ status: 200, bytes: JPEG, headers: { 'content-type': 'video/mp4' } }),
    )
    const provider = new PollinationsVideoProvider({
      baseUrl: 'https://gen.pollinations.ai',
      apiKey: 'pollen-test-key',
      fetchFn: transport.fetchFn,
      timeoutMs: 0,
    })

    const result = await provider.generate({
      model: 'alibaba/wan-2.2-fast',
      prompt: 'duel',
      seconds: 2,
      imageB64: Buffer.alloc(1_000, 7).toString('base64'),
      imageMimeType: 'image/jpeg',
      imageName: 'frame.jpg',
    })

    expect(transport.calls.length).toBe(2)
    const upload = transport.calls[0]!
    expect(upload.url).toBe('https://media.pollinations.ai/upload')
    expect(upload.init.method).toBe('POST')
    expect(upload.init.headers['Authorization']).toBe('Bearer pollen-test-key')
    expect(JSON.parse(upload.init.body ?? '{}')).toMatchObject({
      contentType: 'image/jpeg',
      name: 'frame.jpg',
    })

    const generation = transport.calls[1]!
    expect(new URL(generation.url).searchParams.get('image')).toBe(
      'https://media.pollinations.ai/abc123',
    )
    expect(result.referenceUsed).toBe(true)
  })
})
