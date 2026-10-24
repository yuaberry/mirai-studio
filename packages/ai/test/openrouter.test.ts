import { describe, expect, it } from 'vitest'
import { MiraiError } from '@mirai/shared'
import { OpenRouterProvider } from '../src/openrouter'
import { FakeResponse, makeFetch, type RecordedCall } from './fakes'

function providerWith(
  responder: (call: RecordedCall) => FakeResponse,
  opts: Partial<ConstructorParameters<typeof OpenRouterProvider>[0]> = {},
) {
  const transport = makeFetch((call) => responder(call))
  const provider = new OpenRouterProvider({
    apiKey: 'sk-or-test-123',
    fetchFn: transport.fetchFn,
    timeoutMs: 0,
    appName: 'Mirai Studio',
    appUrl: 'https://mirai-studio.app',
    ...opts,
  })
  return { provider, calls: transport.calls }
}

describe('OpenRouterProvider.chat', () => {
  it('sends a correct OpenAI-compatible request and extracts the reply', async () => {
    const { provider, calls } = providerWith(
      () =>
        new FakeResponse({
          json: {
            choices: [{ message: { content: 'Once upon a sakura…' } }],
            usage: { prompt_tokens: 42, completion_tokens: 7 },
          },
        }),
    )

    const result = await provider.chat({
      model: 'test/model-a',
      temperature: 0.4,
      maxTokens: 512,
      messages: [
        { role: 'system', content: 'You are the Mirai assistant.' },
        { role: 'user', content: 'Write a premise.' },
      ],
    })

    expect(result.content).toBe('Once upon a sakura…')
    expect(result.usage).toEqual({ promptTokens: 42, completionTokens: 7 })

    const call = calls[0]!
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(call.init.headers['Authorization']).toBe('Bearer sk-or-test-123')
    expect(call.init.headers['HTTP-Referer']).toBe('https://mirai-studio.app')
    expect(call.init.headers['X-Title']).toBe('Mirai Studio')

    const body = JSON.parse(call.init.body ?? '{}') as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'test/model-a',
      stream: false,
      temperature: 0.4,
      max_tokens: 512,
      include_usage: true,
    })
    expect(body['messages']).toHaveLength(2)
  })

  it('401 becomes a clear, non-retryable MiraiError', async () => {
    const { provider } = providerWith(
      () => new FakeResponse({ status: 401, json: { error: { message: 'Invalid key' } } }),
    )
    const err = await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MiraiError)
    const mirai = err as MiraiError
    expect(mirai.code).toBe('AI_PROVIDER_ERROR')
    expect(mirai.message).toMatch(/Invalid API key/)
    expect(mirai.retryable).toBe(false)
  })

  it('429 and 5xx are retryable; transport failure is AI_OFFLINE', async () => {
    const rate = providerWith(() => new FakeResponse({ status: 429 }))
    const rateErr = (await rate.provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as MiraiError
    expect(rateErr.retryable).toBe(true)

    const server = providerWith(() => new FakeResponse({ status: 503 }))
    const serverErr = (await server.provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as MiraiError
    expect(serverErr.retryable).toBe(true)

    const failing = new OpenRouterProvider({
      apiKey: 'k',
      fetchFn: () => Promise.reject(new Error('ECONNREFUSED boom')),
      timeoutMs: 0,
    })
    const offline = (await failing
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as MiraiError
    expect(offline.code).toBe('AI_OFFLINE')
    expect(offline.retryable).toBe(true)
  })

  it('invalid JSON responses become a precise AI_PROVIDER_ERROR', async () => {
    const { provider } = providerWith(() => new FakeResponse({ status: 200, text: 'not-json' }))
    const err = (await provider
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e)) as MiraiError
    expect(err.code).toBe('AI_PROVIDER_ERROR')
    expect(err.message).toMatch(/invalid JSON/)
  })
})

describe('OpenRouterProvider.stream', () => {
  it('yields deltas, reports usage and stops at [DONE]', async () => {
    const { provider, calls } = providerWith(
      () =>
        new FakeResponse({
          sse: [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}',
            'data: {"choices":[{"delta":{"content":"lo "}}]}',
            'data: {"choices":[{"delta":{"content":"world"}}]}',
            'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":3}}',
            'data: [DONE]',
          ],
        }),
    )

    let text = ''
    let usage: { promptTokens: number; completionTokens: number } | null = null
    for await (const chunk of provider.stream({
      model: 'test/model-a',
      messages: [{ role: 'user', content: 'greet' }],
    })) {
      text += chunk.delta
      if (chunk.usage) usage = chunk.usage
    }

    expect(text).toBe('Hello world')
    expect(usage).toEqual({ promptTokens: 10, completionTokens: 3 })
    const body = JSON.parse(calls[0]!.init.body ?? '{}') as Record<string, unknown>
    expect(body['stream']).toBe(true)
    expect(body['include_usage']).toBe(true)
  })

  it('skips malformed SSE lines without breaking the stream', async () => {
    const { provider } = providerWith(
      () =>
        new FakeResponse({
          sse: [
            'data: not-json',
            'data: {"choices":[{"delta":{"content":"ok"}}]}',
            'data: [DONE]',
          ],
        }),
    )
    let text = ''
    for await (const chunk of provider.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      text += chunk.delta
    }
    expect(text).toBe('ok')
  })

  it('propagates user aborts as CANCELLED when transport throws on signal', async () => {
    const controller = new AbortController()
    const failing = new OpenRouterProvider({
      apiKey: 'k',
      fetchFn: () => {
        controller.abort()
        return Promise.reject(new DOMException('Aborted', 'AbortError'))
      },
      timeoutMs: 0,
    })
    const err = await failing
      .stream({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
        signal: controller.signal,
      })
      .next()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MiraiError)
    const mirai = err as MiraiError
    expect(mirai.code).toBe('CANCELLED')
  })
})

describe('OpenRouterProvider.listModels', () => {
  it('maps the public catalog, flagging free models and per-token prices', async () => {
    const { provider, calls } = providerWith(
      () =>
        new FakeResponse({
          json: {
            data: [
              { id: 'free/m1', name: 'Free Model 1', context_length: 32000, pricing: { prompt: '0', completion: '0' } },
              { id: 'paid/m2', name: 'Paid Model 2', context_length: 128000, pricing: { prompt: '0.0000015', completion: '0.000002' } },
              { id: 'odd/m3', name: 'No pricing', context_length: 8192 },
            ],
          },
        }),
    )

    const models = await provider.listModels()
    expect(models).toHaveLength(3)
    expect(models[0]).toMatchObject({ id: 'free/m1', isFree: true, promptPricePerToken: 0 })
    expect(models[1]).toMatchObject({
      id: 'paid/m2',
      isFree: false,
      promptPricePerToken: 0.0000015,
      completionPricePerToken: 0.000002,
    })
    expect(models[2]).toMatchObject({ isFree: false, contextLength: 8192 })
    expect(calls[0]!.url).toContain('/models')
  })
})
