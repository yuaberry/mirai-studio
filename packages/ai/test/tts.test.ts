/**
 * v0.30 — OpenAITtsProvider: the AI voice-acting transport against any
 * OpenAI-audio-compatible endpoint (POST /audio/speech, binary response).
 * Offline, fully mocked — the images/video provider pattern.
 */
import { describe, expect, it } from 'vitest'
import { OpenAITtsProvider } from '../src/tts'
import type { FetchResponse } from '../src/types'

function fakeWav(bytes = 4_000): Buffer {
  const header = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAKoKCAA', 'base64')
  return Buffer.concat([header, Buffer.alloc(bytes, 1)])
}

function providerWith(responder: () => Promise<FetchResponse>) {
  const provider = new OpenAITtsProvider({
    apiKey: 'sk-tts',
    baseUrl: 'https://tts.example/v1/',
    fetchFn: async () => responder(),
    timeoutMs: 0,
  })
  return provider
}

describe('OpenAITtsProvider', () => {
  it('posts the documented request shape and returns REAL audio bytes', async () => {
    const wav = fakeWav()
    const ab = new ArrayBuffer(wav.length)
    new Uint8Array(ab).set(wav)
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const provider = new OpenAITtsProvider({
      apiKey: 'sk-tts',
      baseUrl: 'https://tts.example/v1/',
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
        const resp: FetchResponse = {
          ok: true,
          status: 200,
          text: async () => '',
          arrayBuffer: async () => ab,
        }
        return resp
      },
      timeoutMs: 0,
    })
    const result = await provider.speak({ model: 'tts-1', input: 'O lampião responde à lua.', voice: 'ayaka-soft' })

    expect(calls[0]!.url).toBe('https://tts.example/v1/audio/speech')
    expect(calls[0]!.body).toMatchObject({
      model: 'tts-1',
      input: 'O lampião responde à lua.',
      voice: 'ayaka-soft',
      response_format: 'wav',
    })
    expect(result.mimeType).toBe('audio/wav')
    expect(result.bytes.length).toBe(wav.length)
    expect(result.model).toBe('tts-1')
    expect(result.voice).toBe('ayaka-soft')
  })

  it('surfaces provider errors honestly (status + message) and marks retryables', async () => {
    const provider = providerWith(async () => {
      const resp: FetchResponse = {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'bad key' } }),
      }
      return resp
    })
    const err = await provider.speak({ model: 'tts-1', input: 'x', voice: 'v' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/bad key/)
    expect(err.retryable).toBe(false)

    const busy = providerWith(async () => {
      const resp: FetchResponse = { ok: false, status: 429, text: async () => '' }
      return resp
    })
    const retryErr = await busy.speak({ model: 'tts-1', input: 'x', voice: 'v' }).catch((e) => e)
    expect(retryErr.retryable).toBe(true)
  })

  it('rejects empty audio and transport failures honestly', async () => {
    const empty = providerWith(async () => {
      const resp: FetchResponse = {
        ok: true,
        status: 200,
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      }
      return resp
    })
    await expect(empty.speak({ model: 'tts-1', input: 'x', voice: 'v' })).rejects.toThrow(/empty/)

    const noBody = providerWith(async () => {
      const resp: FetchResponse = { ok: true, status: 200, text: async () => '' }
      return resp
    })
    await expect(noBody.speak({ model: 'tts-1', input: 'x', voice: 'v' })).rejects.toThrow(/audio body/)
  })
})
