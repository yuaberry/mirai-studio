/**
 * OpenAIVideoProvider (Phase 4 wrap-up) — sync b64, async job polling and
 * error surfaces, all against a mocked transport (real provider code).
 */
import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import { OpenAIVideoProvider } from '../src/video'
import type { FetchResponse } from '../src/types'

const videoBytes = Buffer.from('real-mp4-bytes-0123456789')

describe('OpenAIVideoProvider', () => {
  it('handles the synchronous b64 shape', async () => {
    const provider = new OpenAIVideoProvider({
      apiKey: 'k',
      baseUrl: 'https://video.test/v1',
      fetchFn: async (): Promise<FetchResponse> => ({
        ok: true,
        status: 200,
        body: null,
        text: async () => JSON.stringify({ data: [{ b64_json: videoBytes.toString('base64') }] }),
      }),
      timeoutMs: 0,
    })
    const result = await provider.generate({ model: 'v/model', prompt: 'a sky', seconds: 4, size: '1344x768' })
    expect(Buffer.compare(result.bytes, videoBytes)).toBe(0)
    expect(result.mimeType).toBe('video/mp4')
    expect(result.seconds).toBe(4)
  })

  it('handles the async job + polling shape until completion', async () => {
    let polls = 0
    const provider = new OpenAIVideoProvider({
      apiKey: 'k',
      baseUrl: 'https://video.test/v1',
      fetchFn: async (url: string): Promise<FetchResponse> => {
        if (url.endsWith('/videos/generations')) {
          return {
            ok: true,
            status: 200,
            body: null,
            text: async () => JSON.stringify({ id: 'job-1', status: 'processing' }),
          }
        }
        polls++
        return {
          ok: true,
          status: 200,
          body: null,
          text: async () =>
            polls < 2
              ? JSON.stringify({ id: 'job-1', status: 'processing' })
              : JSON.stringify({ status: 'completed', data: [{ b64_json: videoBytes.toString('base64') }] }),
        }
      },
      timeoutMs: 0,
      pollIntervalMs: 1,
    })
    const result = await provider.generate({ model: 'v/model', prompt: 'a sky', seconds: 2, size: '1344x768' })
    expect(Buffer.compare(result.bytes, videoBytes)).toBe(0)
    expect(polls).toBeGreaterThanOrEqual(2)
  })

  it('sends fps, quality and the reference frame (image-to-video) when provided', async () => {
    let capturedBody: Record<string, unknown> | null = null
    const provider = new OpenAIVideoProvider({
      apiKey: 'k',
      baseUrl: 'https://video.test/v1',
      fetchFn: async (_url: string, init?: { body?: string }): Promise<FetchResponse> => {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return {
          ok: true,
          status: 200,
          body: null,
          text: async () => JSON.stringify({ data: [{ b64_json: videoBytes.toString('base64') }] }),
        }
      },
      timeoutMs: 0,
    })
    await provider.generate({
      model: 'v/model',
      prompt: 'sky',
      seconds: 4,
      size: '1920x1080',
      fps: 24,
      quality: 'ultra',
      imageB64: 'cmVhbC1mcmFtZQ==',
    })
    expect(capturedBody).toMatchObject({
      fps: 24,
      quality: 'ultra',
      input_reference: 'cmVhbC1mcmFtZQ==',
    })
  })

  it('surfaces friendly 401 errors', async () => {
    const provider = new OpenAIVideoProvider({
      apiKey: 'bad',
      baseUrl: 'https://video.test/v1',
      fetchFn: async (): Promise<FetchResponse> => ({
        ok: false,
        status: 401,
        body: null,
        text: async () => JSON.stringify({ error: { message: 'nope' } }),
      }),
      timeoutMs: 0,
    })
    await expect(
      provider.generate({ model: 'v', prompt: 'x', seconds: 2, size: '1344x768' }),
    ).rejects.toThrow(MiraiError)
    await expect(
      provider.generate({ model: 'v', prompt: 'x', seconds: 2, size: '1344x768' }),
    ).rejects.toThrow(/Invalid video provider key/)
  })

  it('rejects responses with neither data nor job id', async () => {
    const provider = new OpenAIVideoProvider({
      apiKey: 'k',
      baseUrl: 'https://video.test/v1',
      fetchFn: async (): Promise<FetchResponse> => ({
        ok: true,
        status: 200,
        body: null,
        text: async () => JSON.stringify({ unrelated: true }),
      }),
      timeoutMs: 0,
    })
    await expect(
      provider.generate({ model: 'v', prompt: 'x', seconds: 2, size: '1344x768' }),
    ).rejects.toThrow(/no video data/)
  })
})
