/**
 * Google Translate speech — the KEYLESS dubbing leg.
 *
 * The tests lock the three behaviors the app depends on:
 *   1. the voice id is read as a locale (+ a speed hint);
 *   2. long text is split on sentence boundaries (the endpoint rejects
 *      very long inputs);
 *   3. the request looks like a browser request and returns REAL audio.
 */
import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import { GoogleTranslateTtsProvider, parseGoogleVoice, splitText } from '../src/googleTts'
import { FakeResponse, makeFetch } from './fakes'

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64])

function providerWith(responder: () => FakeResponse) {
  const transport = makeFetch(() => responder())
  const provider = new GoogleTranslateTtsProvider({
    baseUrl: 'https://translate.google.com',
    fetchFn: transport.fetchFn,
    timeoutMs: 0,
  })
  return { provider, calls: transport.calls }
}

describe('parseGoogleVoice', () => {
  it('reads a locale as-is', () => {
    expect(parseGoogleVoice('pt-BR')).toEqual({ lang: 'pt-BR', speed: 1 })
    expect(parseGoogleVoice('en-US')).toEqual({ lang: 'en-US', speed: 1 })
  })

  it('reads the trailing digit as a speed hint', () => {
    expect(parseGoogleVoice('pt-BR-2')).toEqual({ lang: 'pt-BR', speed: 2 })
    expect(parseGoogleVoice('en-US-0.5')).toEqual({ lang: 'en-US', speed: 0.5 })
  })

  it('falls back to Brazilian Portuguese for an unknown id', () => {
    expect(parseGoogleVoice(undefined)).toEqual({ lang: 'pt-BR', speed: 1 })
    expect(parseGoogleVoice('')).toEqual({ lang: 'pt-BR', speed: 1 })
    expect(parseGoogleVoice('Minimax')).toEqual({ lang: 'pt-BR', speed: 1 })
  })

  it('ignores a speed outside the accepted range', () => {
    expect(parseGoogleVoice('pt-BR-9')).toEqual({ lang: 'pt-BR', speed: 1 })
  })
})

describe('splitText', () => {
  it('keeps a short text whole', () => {
    expect(splitText('Uma frase curta.', 180)).toEqual(['Uma frase curta.'])
  })

  it('splits on sentence boundaries and keeps every word', () => {
    const text = `${'Palavra '.repeat(30)}. ${'Outra '.repeat(30)}. Fim.`
    const chunks = splitText(text, 180)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 180)).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '))
  })

  it('hard-splits a text with no punctuation', () => {
    const chunks = splitText('a'.repeat(400), 180)
    expect(chunks.length).toBe(3)
    expect(chunks.join('')).toBe('a'.repeat(400))
  })

  it('returns nothing for an empty text', () => {
    expect(splitText('   ', 180)).toEqual([])
  })
})

describe('GoogleTranslateTtsProvider.speak', () => {
  it('calls the real endpoint with the locale and returns MP3 bytes', async () => {
    const { provider, calls } = providerWith(
      () => new FakeResponse({ status: 200, bytes: MP3, headers: { 'content-type': 'audio/mpeg' } }),
    )

    const result = await provider.speak({ lang: 'pt-BR', text: 'Haruka, vamos treinar.' })

    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.bytes.length).toBe(MP3.length)

    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/translate_tts')
    expect(url.searchParams.get('tl')).toBe('pt-BR')
    expect(url.searchParams.get('q')).toBe('Haruka, vamos treinar.')
    // The endpoint only answers a browser-like client.
    expect(calls[0]!.init.headers['User-Agent']).toMatch(/Mozilla/)
  })

  it('sends the speed only when it differs from the default', async () => {
    const { provider, calls } = providerWith(
      () => new FakeResponse({ status: 200, bytes: MP3, headers: { 'content-type': 'audio/mpeg' } }),
    )

    await provider.speak({ lang: 'pt-BR', text: 'Oi', speed: 1 })
    expect(new URL(calls[0]!.url).searchParams.get('ttsspeed')).toBeNull()

    await provider.speak({ lang: 'pt-BR', text: 'Oi', speed: 1.5 })
    expect(new URL(calls[1]!.url).searchParams.get('ttsspeed')).toBe('1.5')
  })

  it('requests one chunk per sentence and concatenates the audio', async () => {
    const { provider, calls } = providerWith(
      () => new FakeResponse({ status: 200, bytes: MP3, headers: { 'content-type': 'audio/mpeg' } }),
    )

    const long = `${'Palavra '.repeat(30)}. ${'Outra '.repeat(30)}.`
    const result = await provider.speak({ lang: 'pt-BR', text: long })

    expect(calls.length).toBeGreaterThan(1)
    expect(result.bytes.length).toBe(MP3.length * calls.length)
  })

  it('refuses an empty text without hitting the network', async () => {
    const { provider, calls } = providerWith(
      () => new FakeResponse({ status: 200, bytes: MP3 }),
    )

    const error = await provider.speak({ lang: 'pt-BR', text: '   ' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MiraiError)
    expect((error as MiraiError).code).toBe('VALIDATION_ERROR')
    expect(calls.length).toBe(0)
  })

  it('reports a rate limit as retryable', async () => {
    const { provider } = providerWith(() => new FakeResponse({ status: 429, text: 'slow down' }))

    const error = await provider
      .speak({ lang: 'pt-BR', text: 'Oi' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MiraiError)
    expect((error as MiraiError).retryable).toBe(true)
    expect((error as MiraiError).message).toMatch(/rate-limiting/i)
  })
})
