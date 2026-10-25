import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import { OpenAIImagesProvider } from '../src/images'
import { FakeResponse, makeFetch } from './fakes'

const B64_PNG = Buffer.from('fake-png-bytes').toString('base64')

describe('OpenAIImagesProvider', () => {
  it('sends a proper Images API request and decodes b64 payload', async () => {
    const { fetchFn, calls } = makeFetch(
      () =>
        new FakeResponse({
          json: { data: [{ b64_json: B64_PNG }] },
        }),
    )
    const provider = new OpenAIImagesProvider({
      apiKey: 'img-key',
      baseUrl: 'https://images.example.com/v1/',
      fetchFn,
      timeoutMs: 0,
    })

    const result = await provider.generate({
      model: 'sd/xl',
      prompt: 'a sakura rooftop at dusk',
      size: '1344x768',
    })

    expect(result.bytes.toString()).toBe('fake-png-bytes')
    expect(result.mimeType).toBe('image/png')

    const call = calls[0]!
    expect(call.url).toBe('https://images.example.com/v1/images/generations')
    expect(call.init.headers['Authorization']).toBe('Bearer img-key')
    const body = JSON.parse(call.init.body ?? '{}') as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'sd/xl',
      prompt: 'a sakura rooftop at dusk',
      size: '1344x768',
      n: 1,
      response_format: 'b64_json',
    })
  })

  it('401 becomes a clear, non-retryable error', async () => {
    const { fetchFn } = makeFetch(
      () => new FakeResponse({ status: 401, json: { error: { message: 'bad key' } } }),
    )
    const provider = new OpenAIImagesProvider({
      apiKey: 'wrong',
      baseUrl: 'https://images.example.com/v1',
      fetchFn,
      timeoutMs: 0,
    })
    const err = await provider
      .generate({ model: 'm', prompt: 'p', size: '1024x1024' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MiraiError)
    const mirai = err as MiraiError
    expect(mirai.code).toBe('AI_PROVIDER_ERROR')
    expect(mirai.message).toMatch(/Invalid image provider key/)
    expect(mirai.retryable).toBe(false)
  })

  it('missing image data becomes a precise error (no silent fakes)', async () => {
    const { fetchFn } = makeFetch(() => new FakeResponse({ json: { data: [] } }))
    const provider = new OpenAIImagesProvider({
      apiKey: 'k',
      baseUrl: 'https://x.example/v1',
      fetchFn,
      timeoutMs: 0,
    })
    const err = await provider
      .generate({ model: 'm', prompt: 'p', size: '1024x1024' })
      .catch((e: unknown) => e)
    expect((err as MiraiError).message).toMatch(/no image data/i)
  })
})
